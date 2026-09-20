"""Report local Vision OCR readiness without loading a model or downloading anything."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from .config import VisionConfig
from .hardware import detect_hardware


def _model_directory_status(path: Path | None) -> dict[str, object]:
    if path is None:
        return {"configured": False, "complete": False}
    required = ("inference.yml", "inference.pdiparams")
    return {
        "configured": True,
        "path": str(path),
        "complete": path.is_dir() and all((path / filename).is_file() for filename in required),
    }


def _checkpoint_status(path: Path | None) -> dict[str, object]:
    if path is None:
        return {"configured": False, "present": False}
    return {"configured": True, "path": str(path), "present": path.is_file()}


def report() -> dict[str, object]:
    config = VisionConfig.from_env()
    settings = config.paddle_ocr
    detection = _model_directory_status(settings.detection_model_dir)
    recognition = _model_directory_status(settings.recognition_model_dir)
    configured = bool(settings.enabled and detection["complete"] and recognition["complete"] and settings.language == "en")
    sam2_checkpoint = _checkpoint_status(config.sam2.checkpoint_path)
    sam2_configured = bool(config.sam2.enabled and sam2_checkpoint["present"])
    return {
        "capability": "image.ocr",
        "profile": settings.profile,
        "enabled": settings.enabled,
        "language": settings.language,
        "timeoutSeconds": settings.timeout_seconds,
        "optionalRuntimeInstalled": importlib.util.find_spec("paddleocr") is not None,
        "modelDirectories": {"detection": detection, "recognition": recognition},
        "runtime": "configured-not-verified" if configured else "unavailable",
        "note": "Run vision:smoke for a real local inference. This command does not load a model or download files.",
        "sam2": {
            "capability": "image.segment",
            "enabled": config.sam2.enabled,
            "modelConfig": config.sam2.model_config,
            "requestedDevice": config.sam2.device,
            "timeoutSeconds": config.sam2.timeout_seconds,
            "optionalRuntimeInstalled": importlib.util.find_spec("sam2") is not None,
            "checkpoint": sam2_checkpoint,
            "runtime": "configured-not-verified" if sam2_configured else "unavailable",
            "note": "Run vision:sam2:smoke for real prompted local segmentation. This command does not load SAM 2.",
        },
        "hardware": detect_hardware(),
    }


if __name__ == "__main__":
    print(json.dumps(report(), indent=2, sort_keys=True))
