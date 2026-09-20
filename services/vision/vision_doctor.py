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


def report() -> dict[str, object]:
    settings = VisionConfig.from_env().paddle_ocr
    detection = _model_directory_status(settings.detection_model_dir)
    recognition = _model_directory_status(settings.recognition_model_dir)
    configured = bool(settings.enabled and detection["complete"] and recognition["complete"] and settings.language == "en")
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
        "hardware": detect_hardware(),
    }


if __name__ == "__main__":
    print(json.dumps(report(), indent=2, sort_keys=True))
