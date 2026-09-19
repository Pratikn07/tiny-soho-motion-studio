from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl, TypeAdapter, model_validator

from .artifacts.manager import ArtifactManager, ArtifactNotFound
from .config import VisionConfig
from .hardware import detect_hardware
from .runtime.registry import RuntimeRegistry
from .schemas.common import RuntimeStatus


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
    max_bytes=vision_config.max_upload_bytes,
)
runtime_registry = RuntimeRegistry.default()


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


def main() -> None:
    """Run only on loopback. Do not use an externally supplied host."""
    uvicorn.run(app, host=BIND_HOST, port=sidecar_port(), log_level="info")


if __name__ == "__main__":
    main()
