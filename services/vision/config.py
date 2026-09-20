from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path


def _positive_int(value: str, name: str) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise RuntimeError(f"{name} must be a positive integer.") from error
    if parsed < 1:
        raise RuntimeError(f"{name} must be a positive integer.")
    return parsed


@dataclass(frozen=True)
class VisionConfig:
    cache_dir: Path
    artifact_ttl_seconds: int
    max_upload_bytes: int
    max_image_artifact_bytes: int
    max_video_artifact_bytes: int
    max_image_pixels: int
    paddle_ocr_enabled: bool
    sam2_enabled: bool
    sam2_checkpoint_path: Path | None
    qwen_layers_enabled: bool
    qwen_layers_model_path: Path | None
    ffmpeg_path: str
    ffprobe_path: str

    @classmethod
    def from_env(cls) -> "VisionConfig":
        cache_dir = Path(os.environ.get("TINY_SOHO_VISION_CACHE_DIR", Path(tempfile.gettempdir()) / "tiny-soho-vision"))
        return cls(
            cache_dir=cache_dir.expanduser(),
            artifact_ttl_seconds=_positive_int(os.environ.get("TINY_SOHO_VISION_ARTIFACT_TTL_SECONDS", "86400"), "TINY_SOHO_VISION_ARTIFACT_TTL_SECONDS"),
            max_upload_bytes=_positive_int(os.environ.get("TINY_SOHO_VISION_MAX_UPLOAD_BYTES", str(16 * 1024 * 1024)), "TINY_SOHO_VISION_MAX_UPLOAD_BYTES"),
            max_image_artifact_bytes=_positive_int(os.environ.get("TINY_SOHO_VISION_MAX_IMAGE_ARTIFACT_BYTES", str(64 * 1024 * 1024)), "TINY_SOHO_VISION_MAX_IMAGE_ARTIFACT_BYTES"),
            max_video_artifact_bytes=_positive_int(os.environ.get("TINY_SOHO_VISION_MAX_VIDEO_ARTIFACT_BYTES", str(1024 * 1024 * 1024)), "TINY_SOHO_VISION_MAX_VIDEO_ARTIFACT_BYTES"),
            max_image_pixels=_positive_int(os.environ.get("TINY_SOHO_VISION_MAX_IMAGE_PIXELS", "40000000"), "TINY_SOHO_VISION_MAX_IMAGE_PIXELS"),
            paddle_ocr_enabled=os.environ.get("TINY_SOHO_PADDLE_OCR_ENABLED") == "1",
            sam2_enabled=os.environ.get("TINY_SOHO_SAM2_ENABLED") == "1",
            sam2_checkpoint_path=_optional_path(os.environ.get("TINY_SOHO_SAM2_CHECKPOINT_PATH")),
            qwen_layers_enabled=os.environ.get("TINY_SOHO_QWEN_LAYERS_ENABLED") == "1",
            qwen_layers_model_path=_optional_path(os.environ.get("TINY_SOHO_QWEN_LAYERS_MODEL_PATH")),
            ffmpeg_path=os.environ.get("FFMPEG_PATH", "ffmpeg"),
            ffprobe_path=os.environ.get("FFPROBE_PATH", "ffprobe"),
        )


def _optional_path(value: str | None) -> Path | None:
    return Path(value).expanduser() if value else None
