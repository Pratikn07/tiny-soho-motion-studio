from __future__ import annotations

import subprocess
import tempfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Protocol

from PIL import Image

from services.vision.composition import build_overlay_command, validate_overlay_dimensions, video_dimensions
from services.vision.image_input import decode_image
from services.vision.overlay import create_typography_overlay
from services.vision.schemas.ocr import OcrRegion


CPU_SAFE_OPERATIONS = {"inspect", "overlay", "plate", "compose"}
OPTIONAL_OPERATIONS = {"ocr", "segment", "layers"}


@dataclass(frozen=True)
class VisionJob:
    id: str
    owner_user_id: str
    project_id: str
    source_asset_id: str
    operation: str
    options: dict[str, object]
    input_asset_ids: list[str]
    worker_lease_id: str | None = None


@dataclass(frozen=True)
class VisionResult:
    status: str
    asset_ids: list[str]
    object_paths: list[str]
    width: int | None
    height: int | None
    error_code: str | None = None
    error_message: str | None = None


class VisionStorage(Protocol):
    def download_owned_source(self, owner_user_id: str, project_id: str, asset_id: str) -> tuple[bytes, str, str]: ...

    def download_owned_input(self, owner_user_id: str, project_id: str, asset_id: str) -> tuple[bytes, str, str]: ...

    def upload_derived(self, object_path: str, data: bytes, mime_type: str, kind: str) -> str: ...


@dataclass(frozen=True)
class VisionProcessor:
    ffmpeg_path: str
    ffprobe_path: str

    def unavailable(self, operation: str) -> VisionResult:
        return VisionResult(
            status="needs_attention",
            asset_ids=[],
            object_paths=[],
            width=None,
            height=None,
            error_code="vision_operation_not_configured",
            error_message=f"{operation} is not configured in the CPU-safe hosted Vision service.",
        )


def _png_dimensions(data: bytes) -> tuple[int, int]:
    with Image.open(BytesIO(data)) as image:
        return image.size


def _regions(value: object) -> list[OcrRegion]:
    if not isinstance(value, list):
        raise ValueError("Vision overlay regions must be a list.")
    return [OcrRegion.model_validate(region) for region in value]


def _png_bytes(data: bytes) -> bytes:
    with Image.open(BytesIO(data)) as image:
        buffer = BytesIO()
        image.convert("RGBA").save(buffer, format="PNG")
    return buffer.getvalue()


def _compose_video(source: bytes, overlay: bytes, processor: VisionProcessor) -> bytes:
    with tempfile.TemporaryDirectory(prefix="tiny-soho-vision-") as directory:
        temporary = Path(directory)
        video_path = temporary / "source.mp4"
        overlay_path = temporary / "overlay.png"
        output_path = temporary / "composed.mp4"
        video_path.write_bytes(source)
        overlay_path.write_bytes(overlay)
        overlay_width, overlay_height = _png_dimensions(overlay)
        video_width, video_height = video_dimensions(video_path, ffprobe_path=processor.ffprobe_path)
        validate_overlay_dimensions(
            video_width=video_width,
            video_height=video_height,
            overlay_width=overlay_width,
            overlay_height=overlay_height,
        )
        subprocess.run(
            build_overlay_command(video_path, overlay_path, output_path, ffmpeg_path=processor.ffmpeg_path),
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=120,
        )
        return output_path.read_bytes()


def process_vision_job(job: VisionJob, storage: VisionStorage, processor: VisionProcessor) -> VisionResult:
    if job.operation in OPTIONAL_OPERATIONS:
        return processor.unavailable(job.operation)
    if job.operation not in CPU_SAFE_OPERATIONS:
        return VisionResult(
            status="failed",
            asset_ids=[],
            object_paths=[],
            width=None,
            height=None,
            error_code="vision_operation_invalid",
            error_message="Vision operation is not supported by this service.",
        )

    source, source_mime, _ = storage.download_owned_source(job.owner_user_id, job.project_id, job.source_asset_id)
    if job.operation == "inspect":
        if not source_mime.startswith("image/"):
            return VisionResult("needs_attention", [], [], None, None, "vision_source_invalid", "Inspect requires an image source asset.")
        width, height = _png_dimensions(source)
        return VisionResult("completed", [], [], width, height)

    if job.operation == "overlay":
        if not source_mime.startswith("image/"):
            return VisionResult("needs_attention", [], [], None, None, "vision_source_invalid", "Overlay requires an image source asset.")
        decoded = decode_image(source, source_mime, max_bytes=25 * 1024 * 1024, max_pixels=40_000_000)
        overlay = create_typography_overlay(decoded, _regions(job.options.get("regions", [])))
        object_path = f"owners/{job.owner_user_id}/projects/{job.project_id}/vision/{job.id}/overlay.png"
        asset_id = storage.upload_derived(object_path, overlay.png, "image/png", "derived-image")
        return VisionResult("completed", [asset_id], [object_path], overlay.width, overlay.height)

    if job.operation == "plate":
        if not source_mime.startswith("image/"):
            return VisionResult("needs_attention", [], [], None, None, "vision_source_invalid", "Plate requires an image source asset.")
        plate = _png_bytes(source)
        width, height = _png_dimensions(plate)
        object_path = f"owners/{job.owner_user_id}/projects/{job.project_id}/vision/{job.id}/plate.png"
        asset_id = storage.upload_derived(object_path, plate, "image/png", "derived-image")
        return VisionResult("completed", [asset_id], [object_path], width, height)

    if source_mime != "video/mp4" or not job.input_asset_ids:
        return VisionResult("needs_attention", [], [], None, None, "vision_compose_inputs_invalid", "Compose requires an MP4 source video and an overlay image.")
    overlay, overlay_mime, _ = storage.download_owned_input(job.owner_user_id, job.project_id, job.input_asset_ids[0])
    if overlay_mime != "image/png":
        return VisionResult("needs_attention", [], [], None, None, "vision_compose_inputs_invalid", "Compose requires a PNG overlay image.")
    try:
        composed = _compose_video(source, overlay, processor)
    except (OSError, subprocess.SubprocessError, RuntimeError):
        return VisionResult("needs_attention", [], [], None, None, "vision_compose_unavailable", "CPU-safe video composition is unavailable for this input.")
    object_path = f"owners/{job.owner_user_id}/projects/{job.project_id}/vision/{job.id}/composed.mp4"
    asset_id = storage.upload_derived(object_path, composed, "video/mp4", "derived-video")
    return VisionResult("completed", [asset_id], [object_path], None, None)
