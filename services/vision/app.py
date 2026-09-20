from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl, TypeAdapter, model_validator

from .artifacts.manager import ArtifactManager, ArtifactNotFound
from .schemas.artifacts import ArtifactMetadata
from .adapters.base import VisionCapabilityUnavailable
from .adapters.paddle_ocr import PaddleOcrAdapter, default_paddle_ocr_adapter
from .adapters.qwen_layers import QwenLocalCudaBackend, QwenRemoteHttpsBackend, default_qwen_layers_backend
from .adapters.sam2 import Sam2Adapter, default_sam2_adapter
from .config import VisionConfig
from .hardware import detect_hardware
from .image_input import ImageInputError, decode_upload
from .runtime.registry import RuntimeRegistry
from .runtime.locks import InferenceLocks
from .schemas.common import RuntimeStatus
from .schemas.ocr import OcrRegion, OcrResult
from .schemas.segmentation import SegmentationMask, SegmentationPrompts, SegmentationResult
from .schemas.layers import LayerArtifact, LayerOptions, LayerResult
from .layers import recomposition_diagnostics
from .overlay import OverlayArtifact, create_typography_overlay
from .plate import GenerationPlateBuildRequest, GenerationPlateResult, build_generation_plate
from .composition import CompositionArtifact, CompositionError, CompositionRequest, CompositionUnavailable, compose_typography_artifacts
from .typography import create_typography_safety_mask


SERVICE_NAME = "tiny-soho-vision"
SERVICE_VERSION = "0.1.0"
BIND_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
MANIFEST_PATH = Path(__file__).resolve().parents[2] / "lib" / "capabilities" / "manifest.json"


class HardwareRequirements(BaseModel):
    cpu: Literal["required", "optional", "not-required"]
    mps: Literal["recommended", "optional", "not-supported", "not-required"]
    cuda: Literal["recommended", "optional", "not-supported", "not-required"]
    notes: str | None = None


class Upstream(BaseModel):
    repository: HttpUrl
    pinnedRef: str
    codeLicense: str
    modelLicense: str


class Capability(BaseModel):
    id: str
    name: str
    status: Literal["available", "planned", "unavailable"]
    runtime: Literal["python-fastapi", "ffmpeg", "reserved"]
    provider: str
    version: str
    hardwareRequirements: HardwareRequirements
    inputs: list[str]
    outputs: list[str]
    upstream: Upstream | None
    unavailableReason: str | None = None
    runtimeStatus: RuntimeStatus | None = None

    @model_validator(mode="after")
    def unavailable_capabilities_have_a_reason(self) -> "Capability":
        if self.status == "unavailable" and not self.unavailableReason:
            raise ValueError("Unavailable capabilities require an unavailable reason.")
        return self


class AcceleratorStatus(BaseModel):
    available: bool
    reason: str | None


class CudaStatus(AcceleratorStatus):
    deviceCount: int


class CpuStatus(BaseModel):
    available: Literal[True]
    cores: int
    architecture: str


class HardwareStatus(BaseModel):
    cpu: CpuStatus
    mps: AcceleratorStatus
    cuda: CudaStatus


class Binding(BaseModel):
    host: Literal["127.0.0.1"]
    port: int


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: Literal["tiny-soho-vision"]
    version: str
    bind: Binding
    hardware: HardwareStatus


class CapabilitiesResponse(BaseModel):
    capabilities: list[Capability]
    hardware: HardwareStatus


@lru_cache(maxsize=1)
def load_capabilities() -> list[Capability]:
    return TypeAdapter(list[Capability]).validate_json(MANIFEST_PATH.read_text(encoding="utf-8"))


def sidecar_port() -> int:
    configured_port = os.environ.get("TINY_SOHO_VISION_PORT", str(DEFAULT_PORT))
    try:
        port = int(configured_port)
    except ValueError as error:
        raise RuntimeError("TINY_SOHO_VISION_PORT must be an integer between 1 and 65535.") from error
    if not 1 <= port <= 65535:
        raise RuntimeError("TINY_SOHO_VISION_PORT must be an integer between 1 and 65535.")
    return port


app = FastAPI(title="Tiny Soho Vision", version=SERVICE_VERSION, docs_url=None, redoc_url=None)
vision_config = VisionConfig.from_env()
artifact_manager = ArtifactManager(
    vision_config.cache_dir,
    ttl_seconds=vision_config.artifact_ttl_seconds,
    max_upload_bytes=vision_config.max_upload_bytes,
    max_image_artifact_bytes=vision_config.max_image_artifact_bytes,
    max_video_artifact_bytes=vision_config.max_video_artifact_bytes,
)
runtime_registry = RuntimeRegistry.default()
inference_locks = InferenceLocks()
ocr_adapter = default_paddle_ocr_adapter(vision_config.paddle_ocr)
ocr_configuration_reason = ocr_adapter.configuration_reason()
runtime_registry.transition(
    "image.ocr",
    state="unloaded",
    reason=ocr_configuration_reason or "PaddleOCR is configured; awaiting a real local inference.",
    available=ocr_configuration_reason is None,
)
segmentation_adapter = default_sam2_adapter(vision_config.sam2)
segmentation_configuration_reason = segmentation_adapter.configuration_reason()
runtime_registry.transition(
    "image.segment",
    state="unloaded",
    reason=segmentation_configuration_reason or "SAM 2 is configured; awaiting a real local inference.",
    available=segmentation_configuration_reason is None,
)
layers_backend = default_qwen_layers_backend(vision_config.qwen_layers)
layers_configuration_reason = layers_backend.configuration_reason()
runtime_registry.transition(
    "image.layers",
    state="unloaded",
    reason=layers_configuration_reason or "Qwen Image Layered is configured; awaiting a real backend inference.",
    available=layers_configuration_reason is None,
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service=SERVICE_NAME,
        version=SERVICE_VERSION,
        bind=Binding(host=BIND_HOST, port=sidecar_port()),
        hardware=HardwareStatus.model_validate(detect_hardware()),
    )


@app.get("/v1/capabilities", response_model=CapabilitiesResponse)
def capabilities() -> CapabilitiesResponse:
    return CapabilitiesResponse(
        capabilities=[
            capability.model_copy(update={"runtimeStatus": RuntimeStatus.model_validate(runtime_registry.status(capability.id).as_dict())})
            for capability in load_capabilities()
        ],
        hardware=HardwareStatus.model_validate(detect_hardware()),
    )


@app.get("/v1/artifacts/{artifact_id}")
def artifact(artifact_id: str) -> FileResponse:
    try:
        metadata = artifact_manager.metadata(artifact_id)
        return FileResponse(artifact_manager.file_path(metadata.id), media_type=metadata.mimeType, filename=f"{metadata.id}.bin")
    except ArtifactNotFound as error:
        raise HTTPException(status_code=404, detail="Unknown artifact.") from error


@app.get("/v1/artifacts/{artifact_id}/metadata", response_model=ArtifactMetadata)
def artifact_metadata(artifact_id: str) -> ArtifactMetadata:
    try:
        return artifact_manager.metadata(artifact_id)
    except ArtifactNotFound as error:
        raise HTTPException(status_code=404, detail="Unknown artifact.") from error


@app.post("/v1/ocr", response_model=OcrResult)
async def ocr(image: UploadFile = File(...)) -> OcrResult:
    try:
        decoded = await decode_upload(
            image,
            max_bytes=vision_config.max_upload_bytes,
            max_pixels=vision_config.max_image_pixels,
        )
    except ImageInputError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    is_real_adapter = isinstance(ocr_adapter, PaddleOcrAdapter)
    try:
        async with inference_locks.get("image.ocr"):
            if is_real_adapter:
                runtime_registry.transition("image.ocr", state="loading")
            result = await ocr_adapter.recognize(decoded)
    except VisionCapabilityUnavailable as error:
        if is_real_adapter:
            runtime_registry.transition("image.ocr", state="error", reason=str(error))
        raise HTTPException(status_code=503, detail=str(error)) from error
    if is_real_adapter:
        runtime_registry.transition("image.ocr", state="ready", reason=None)
    mask = create_typography_safety_mask(decoded.width, decoded.height, result.regions)
    metadata = artifact_manager.write_bytes(kind="typography-safety-mask", mime_type="image/png", data=mask.png)
    return result.model_copy(update={"typographySafetyMaskArtifactId": metadata.id})


@app.post("/v1/segment", response_model=SegmentationResult)
async def segment(image: UploadFile = File(...), prompts: str = Form(...)) -> SegmentationResult:
    try:
        decoded = await decode_upload(
            image,
            max_bytes=vision_config.max_upload_bytes,
            max_pixels=vision_config.max_image_pixels,
        )
        parsed_prompts = SegmentationPrompts.model_validate(json.loads(prompts))
    except (ImageInputError, ValueError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    is_real_adapter = isinstance(segmentation_adapter, Sam2Adapter)
    try:
        async with inference_locks.get("image.segment"):
            if is_real_adapter:
                runtime_registry.transition("image.segment", state="loading")
            predictions = await segmentation_adapter.segment(decoded, parsed_prompts)
    except VisionCapabilityUnavailable as error:
        if is_real_adapter:
            runtime_registry.transition("image.segment", state="error", reason=str(error))
        raise HTTPException(status_code=503, detail=str(error)) from error
    if is_real_adapter:
        runtime_registry.transition("image.segment", state="ready", reason=None)
    masks = []
    for prediction in predictions:
        metadata = artifact_manager.write_bytes(kind="segmentation-mask", mime_type="image/png", data=prediction.png)
        masks.append(SegmentationMask(
            id=prediction.id,
            artifactId=metadata.id,
            boundingBox=prediction.boundingBox,
            score=prediction.score,
        ))
    return SegmentationResult(
        image={"width": decoded.width, "height": decoded.height},
        masks=masks,
        engine=segmentation_adapter.engine,
    )


@app.post("/v1/layers", response_model=LayerResult)
async def layers(
    image: UploadFile = File(...),
    prompt: str | None = Form(default=None),
    requestedLayerCount: int = Form(default=4),
    seed: int | None = Form(default=None),
) -> LayerResult:
    try:
        options = LayerOptions(prompt=prompt, requestedLayerCount=requestedLayerCount, seed=seed)
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Layer options are invalid.") from error
    try:
        decoded = await decode_upload(
            image,
            max_bytes=vision_config.max_upload_bytes,
            max_pixels=vision_config.max_image_pixels,
        )
    except ImageInputError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    is_real_backend = isinstance(layers_backend, (QwenLocalCudaBackend, QwenRemoteHttpsBackend))
    try:
        async with inference_locks.get("image.layers"):
            if is_real_backend:
                runtime_registry.transition("image.layers", state="loading")
            predictions = await layers_backend.decompose(decoded, options)
    except VisionCapabilityUnavailable as error:
        if is_real_backend:
            runtime_registry.transition("image.layers", state="error", reason=str(error))
        raise HTTPException(status_code=503, detail=str(error)) from error
    if is_real_backend:
        runtime_registry.transition("image.layers", state="ready", reason=None)
    persisted_layers = []
    for prediction in predictions:
        metadata = artifact_manager.write_bytes(kind="rgba-layer", mime_type="image/png", data=prediction.png)
        persisted_layers.append(LayerArtifact(
            id=prediction.id,
            artifactId=metadata.id,
            zIndex=prediction.zIndex,
            alphaCoverage=prediction.alphaCoverage,
            width=decoded.width,
            height=decoded.height,
        ))
    return LayerResult(
        image={"width": decoded.width, "height": decoded.height},
        layers=persisted_layers,
        diagnostics=recomposition_diagnostics(decoded, predictions),
        backend=layers_backend.backend,
        options=options,
    )


@app.post("/v1/overlay", response_model=OverlayArtifact)
async def overlay(image: UploadFile = File(...), regions: str = Form(...)) -> OverlayArtifact:
    try:
        decoded = await decode_upload(
            image,
            max_bytes=vision_config.max_upload_bytes,
            max_pixels=vision_config.max_image_pixels,
        )
        parsed_regions = TypeAdapter(list[OcrRegion]).validate_python(json.loads(regions))
    except (ImageInputError, ValueError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    result = create_typography_overlay(decoded, parsed_regions)
    source_metadata = artifact_manager.write_bytes(kind="source-image", mime_type=decoded.mimeType, data=decoded.data)
    metadata = artifact_manager.write_bytes(kind="typography-overlay", mime_type="image/png", data=result.png)
    return OverlayArtifact(
        artifactId=metadata.id,
        sourceArtifactId=source_metadata.id,
        width=result.width,
        height=result.height,
        protectedRegionIds=result.protectedRegionIds,
        paddingPixels=result.paddingPixels,
    )


@app.post("/v1/plates", response_model=GenerationPlateResult)
async def generation_plate(request: GenerationPlateBuildRequest) -> GenerationPlateResult:
    recognizer = _generation_plate_second_pass if isinstance(ocr_adapter, PaddleOcrAdapter) else None
    try:
        return await build_generation_plate(
            artifact_manager,
            request,
            max_pixels=vision_config.max_image_pixels,
            second_pass_recognizer=recognizer,
        )
    except VisionCapabilityUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (ArtifactNotFound, ImageInputError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


async def _generation_plate_second_pass(image):
    """Run plate verification through the same serialized, observable OCR runtime."""
    try:
        async with inference_locks.get("image.ocr"):
            runtime_registry.transition("image.ocr", state="loading")
            result = await ocr_adapter.recognize(image)
    except VisionCapabilityUnavailable as error:
        runtime_registry.transition("image.ocr", state="error", reason=str(error))
        raise
    runtime_registry.transition("image.ocr", state="ready", reason=None)
    return result


@app.post("/v1/compose", response_model=CompositionArtifact)
def compose(request: CompositionRequest) -> CompositionArtifact:
    try:
        return compose_typography_artifacts(
            artifact_manager,
            request.videoArtifactId,
            request.overlayArtifactId,
            ffmpeg_path=vision_config.ffmpeg_path,
            ffprobe_path=vision_config.ffprobe_path,
        )
    except CompositionUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except CompositionError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


def main() -> None:
    """Run only on loopback. Do not use an externally supplied host."""
    uvicorn.run(app, host=BIND_HOST, port=sidecar_port(), log_level="info")


if __name__ == "__main__":
    main()
