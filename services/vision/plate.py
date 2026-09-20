"""Build truthfully classified generation plates from sidecar-owned image artifacts."""

from __future__ import annotations

import hashlib
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from io import BytesIO
from typing import Literal

from PIL import Image, ImageChops
from pydantic import BaseModel, Field

from .adapters.base import VisionCapabilityUnavailable
from .artifacts.manager import ArtifactManager
from .image_input import DecodedImage, decode_image
from .layers import alpha_coverage, classify_layers, encode_rgba, recomposition_diagnostics
from .overlay import create_typography_overlay
from .schemas.layers import LayerPrediction
from .schemas.ocr import OcrRegion, OcrResult
from .typography import create_typography_safety_mask


PlateMode = Literal["original-with-protected-text", "layers-text-removed", "inpainted-text-removed"]
SecondPassRecognizer = Callable[[DecodedImage], Awaitable[OcrResult]]


class GenerationPlateBuildRequest(BaseModel):
    sourceArtifactId: str = Field(min_length=1)
    typographyOverlayArtifactId: str = Field(min_length=1)
    regions: list[OcrRegion]
    mode: PlateMode
    layerArtifactIds: list[str] = Field(default_factory=list, max_length=8)


class GenerationPlateResult(BaseModel):
    artifactId: str
    sourceArtifactId: str
    typographyOverlayArtifactId: str
    mode: PlateMode
    textRemoved: bool
    protectedRegionIds: list[str]
    width: int
    height: int
    warnings: list[str]
    provenance: dict[str, object]


async def build_generation_plate(
    manager: ArtifactManager,
    request: GenerationPlateBuildRequest,
    *,
    max_pixels: int,
    second_pass_recognizer: SecondPassRecognizer | None = None,
) -> GenerationPlateResult:
    source_metadata = manager.metadata(request.sourceArtifactId)
    if source_metadata.kind != "source-image" or source_metadata.mimeType not in {"image/png", "image/jpeg", "image/webp"}:
        raise VisionCapabilityUnavailable("Generation plate source must be a decoded image artifact.")
    source = decode_image(
        manager.read_bytes(source_metadata.id),
        source_metadata.mimeType,
        max_bytes=manager.max_image_artifact_bytes,
        max_pixels=max_pixels,
    )
    overlay_metadata = manager.metadata(request.typographyOverlayArtifactId)
    if overlay_metadata.kind != "typography-overlay" or overlay_metadata.mimeType != "image/png":
        raise VisionCapabilityUnavailable("Trusted typography overlay must be a PNG artifact.")
    _validate_overlay_coverage(
        source,
        manager.read_bytes(overlay_metadata.id),
        request.regions,
    )

    source_hash = _sha256(source.data)
    common = {
        "sourceArtifactId": source_metadata.id,
        "typographyOverlayArtifactId": overlay_metadata.id,
        "protectedRegionIds": [region.id for region in request.regions],
        "width": source.width,
        "height": source.height,
    }
    if request.mode == "original-with-protected-text":
        return _fallback_result(
            source_metadata.id,
            source_hash,
            overlay_metadata.id,
            common,
            warnings=[],
            layer_artifact_ids=[],
        )
    if request.mode == "inpainted-text-removed":
        raise VisionCapabilityUnavailable("Inpainted generation plates remain unavailable until a reviewed inpainting adapter is implemented.")
    if not request.layerArtifactIds:
        return _fallback_result(
            source_metadata.id,
            source_hash,
            overlay_metadata.id,
            common,
            warnings=["No Qwen layers were supplied; using the original image with protected typography."],
            layer_artifact_ids=[],
        )

    predictions = _load_layer_predictions(manager, request.layerArtifactIds, source)
    diagnostics = recomposition_diagnostics(source, predictions)
    if diagnostics.warning or not diagnostics.recompositionMatchesInput:
        return _fallback_result(
            source_metadata.id,
            source_hash,
            overlay_metadata.id,
            common,
            warnings=["Layer recomposition did not pass safety diagnostics; using the original image with protected typography."],
            layer_artifact_ids=request.layerArtifactIds,
            diagnostics=diagnostics.model_dump(),
        )
    typography_mask = _typography_mask(source.width, source.height, request.regions)
    classifications = classify_layers(predictions, typography_mask=typography_mask)
    text_layer_ids = {classification.layerId for classification in classifications if classification.inferredRole == "text-like"}
    if not text_layer_ids:
        return _fallback_result(
            source_metadata.id,
            source_hash,
            overlay_metadata.id,
            common,
            warnings=["No text-like Qwen layer was identified with sufficient OCR overlap; using the original image with protected typography."],
            layer_artifact_ids=request.layerArtifactIds,
            diagnostics=diagnostics.model_dump(),
        )

    plate_png = _compose_non_text_layers(source, predictions, text_layer_ids)
    plate = decode_image(
        plate_png,
        "image/png",
        max_bytes=manager.max_image_artifact_bytes,
        max_pixels=max_pixels,
    )
    if second_pass_recognizer is None:
        return _fallback_result(
            source_metadata.id,
            source_hash,
            overlay_metadata.id,
            common,
            warnings=["No real OCR second-pass recognizer is available; using the original image with protected typography."],
            layer_artifact_ids=request.layerArtifactIds,
            diagnostics=diagnostics.model_dump(),
            classifications=[classification.model_dump() for classification in classifications],
        )
    try:
        second_pass = await second_pass_recognizer(plate)
    except VisionCapabilityUnavailable as error:
        return _fallback_result(
            source_metadata.id,
            source_hash,
            overlay_metadata.id,
            common,
            warnings=[f"OCR second-pass verification was unavailable ({error}); using the original image with protected typography."],
            layer_artifact_ids=request.layerArtifactIds,
            diagnostics=diagnostics.model_dump(),
            classifications=[classification.model_dump() for classification in classifications],
        )
    if _has_remaining_protected_typography(second_pass.regions, request.regions):
        return _fallback_result(
            source_metadata.id,
            source_hash,
            overlay_metadata.id,
            common,
            warnings=["OCR second pass detected remaining typography in a protected region; using the original image with protected typography."],
            layer_artifact_ids=request.layerArtifactIds,
            diagnostics=diagnostics.model_dump(),
            classifications=[classification.model_dump() for classification in classifications],
            second_pass=second_pass,
        )
    plate_metadata = manager.write_bytes(kind="generation-plate", mime_type="image/png", data=plate_png)
    provenance = _provenance(
        source_artifact_id=source_metadata.id,
        source_hash=source_hash,
        plate_artifact_id=plate_metadata.id,
        plate_hash=_sha256(plate_png),
        source=source,
        overlay_artifact_id=overlay_metadata.id,
        mode="layers-text-removed",
        layer_artifact_ids=request.layerArtifactIds,
        diagnostics=diagnostics.model_dump(),
        classifications=[classification.model_dump() for classification in classifications],
        second_pass=second_pass,
    )
    return GenerationPlateResult(
        artifactId=plate_metadata.id,
        mode="layers-text-removed",
        textRemoved=True,
        warnings=[],
        provenance=provenance,
        **common,
    )


def _fallback_result(
    source_artifact_id: str,
    source_hash: str,
    overlay_artifact_id: str,
    common: dict[str, object],
    *,
    warnings: list[str],
    layer_artifact_ids: list[str],
    diagnostics: dict[str, object] | None = None,
    classifications: list[dict[str, object]] | None = None,
    second_pass: OcrResult | None = None,
) -> GenerationPlateResult:
    source = DecodedImage(data=b"", mimeType="image/png", width=int(common["width"]), height=int(common["height"]))
    provenance = _provenance(
        source_artifact_id=source_artifact_id,
        source_hash=source_hash,
        plate_artifact_id=source_artifact_id,
        plate_hash=source_hash,
        source=source,
        overlay_artifact_id=overlay_artifact_id,
        mode="original-with-protected-text",
        layer_artifact_ids=layer_artifact_ids,
        diagnostics=diagnostics,
        classifications=classifications,
        second_pass=second_pass,
    )
    return GenerationPlateResult(
        artifactId=source_artifact_id,
        mode="original-with-protected-text",
        textRemoved=False,
        warnings=warnings,
        provenance=provenance,
        **common,
    )


def _validate_overlay_coverage(source: DecodedImage, overlay_png: bytes, regions: list[OcrRegion]) -> None:
    expected = create_typography_overlay(source, regions)
    with Image.open(BytesIO(expected.png)) as expected_image, Image.open(BytesIO(overlay_png)) as overlay_image:
        if overlay_image.mode != "RGBA" or overlay_image.size != (source.width, source.height):
            raise VisionCapabilityUnavailable("Trusted typography overlay dimensions must match the generation source.")
        missing = ImageChops.subtract(expected_image.getchannel("A"), overlay_image.getchannel("A"))
        pixels_changed = ImageChops.difference(expected_image.convert("RGB"), overlay_image.convert("RGB")).getbbox() is not None
    if missing.getbbox() is not None:
        raise VisionCapabilityUnavailable("Trusted typography overlay does not cover every protected source pixel with its safety margin.")
    if pixels_changed:
        raise VisionCapabilityUnavailable("Trusted typography overlay must exactly preserve the original protected source pixels.")


def _load_layer_predictions(manager: ArtifactManager, artifact_ids: list[str], source: DecodedImage) -> list[LayerPrediction]:
    predictions = []
    for index, artifact_id in enumerate(artifact_ids):
        metadata = manager.metadata(artifact_id)
        if metadata.kind != "rgba-layer" or metadata.mimeType != "image/png":
            raise VisionCapabilityUnavailable("Qwen generation layers must be PNG artifacts.")
        raw_png = manager.read_bytes(metadata.id)
        try:
            with Image.open(BytesIO(raw_png)) as layer:
                layer.load()
                rgba = layer.convert("RGBA")
        except (OSError, ValueError) as error:
            raise VisionCapabilityUnavailable("A Qwen generation layer could not be decoded.") from error
        if rgba.size != (source.width, source.height):
            raise VisionCapabilityUnavailable("Qwen generation layers must match the source canvas dimensions.")
        if alpha_coverage(rgba) <= 0:
            raise VisionCapabilityUnavailable("Qwen generation layers must have non-empty alpha coverage.")
        predictions.append(LayerPrediction(id=metadata.id, png=raw_png, zIndex=index, alphaCoverage=alpha_coverage(rgba)))
    return predictions


def _typography_mask(width: int, height: int, regions: list[OcrRegion]) -> Image.Image:
    mask = create_typography_safety_mask(width, height, regions)
    with Image.open(BytesIO(mask.png)) as image:
        return image.convert("L")


def _compose_non_text_layers(source: DecodedImage, predictions: list[LayerPrediction], text_layer_ids: set[str]) -> bytes:
    composite = Image.new("RGBA", (source.width, source.height), (0, 0, 0, 0))
    for prediction in predictions:
        if prediction.id in text_layer_ids:
            continue
        with Image.open(BytesIO(prediction.png)) as layer:
            composite.alpha_composite(layer.convert("RGBA"))
    return encode_rgba(composite)


def _has_remaining_protected_typography(detected: list[OcrRegion], protected: list[OcrRegion]) -> bool:
    return any(_bounds_intersect(region.boundingBox, protected_region.boundingBox) for region in detected for protected_region in protected)


def _bounds_intersect(left: object, right: object) -> bool:
    return bool(
        left.x < right.x + right.width
        and left.x + left.width > right.x
        and left.y < right.y + right.height
        and left.y + left.height > right.y
    )


def _provenance(
    *,
    source_artifact_id: str,
    source_hash: str,
    plate_artifact_id: str,
    plate_hash: str,
    source: DecodedImage,
    overlay_artifact_id: str,
    mode: PlateMode,
    layer_artifact_ids: list[str],
    diagnostics: dict[str, object] | None,
    classifications: list[dict[str, object]] | None,
    second_pass: OcrResult | None,
) -> dict[str, object]:
    analysis: dict[str, object] = {"layerArtifactIds": layer_artifact_ids}
    if diagnostics is not None:
        analysis["layerDiagnostics"] = diagnostics
    if classifications is not None:
        analysis["layerClassifications"] = classifications
    if second_pass is not None:
        analysis["secondPassOcr"] = second_pass.engine.model_dump()
    return {
        "source": {"artifactId": source_artifact_id, "sha256": source_hash},
        "plate": {"artifactId": plate_artifact_id, "sha256": plate_hash},
        "typographyOverlayArtifactId": overlay_artifact_id,
        "analysis": analysis,
        "buildMode": mode,
        "dimensions": {"width": source.width, "height": source.height},
        "builtAt": datetime.now(UTC).isoformat(),
    }


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
