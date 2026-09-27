"""Report local Vision OCR readiness without loading a model or downloading anything."""

from __future__ import annotations

import importlib.util
import json
import subprocess
from pathlib import Path
from urllib.parse import urlparse

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


def _directory_status(path: Path | None) -> dict[str, object]:
    if path is None:
        return {"configured": False, "present": False}
    return {"configured": True, "path": str(path), "present": path.is_dir()}


def _qwen_remote_status(url: str | None, token: str | None, allowed_hosts: tuple[str, ...]) -> dict[str, object]:
    if url is None:
        return {"configured": False, "tokenConfigured": bool(token), "allowedHosts": list(allowed_hosts)}
    parsed = urlparse(url)
    valid_endpoint = parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username and not parsed.password
    return {
        "configured": valid_endpoint and parsed.hostname.lower() in allowed_hosts,
        "host": parsed.hostname,
        "tokenConfigured": bool(token),
        "allowedHosts": list(allowed_hosts),
    }


def _media_tool_status(command: str, name: str) -> dict[str, object]:
    try:
        result = subprocess.run(
            [command, "-version"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=3,
        )
    except (FileNotFoundError, OSError, subprocess.SubprocessError):
        return {"available": False, "reason": f"{name} is not available."}

    version = result.stdout.splitlines()[0] if result.stdout else name
    return {"available": True, "version": version, "reason": None}


def report() -> dict[str, object]:
    config = VisionConfig.from_env()
    settings = config.paddle_ocr
    detection = _model_directory_status(settings.detection_model_dir)
    recognition = _model_directory_status(settings.recognition_model_dir)
    configured = bool(settings.enabled and detection["complete"] and recognition["complete"] and settings.language == "en")
    sam2_checkpoint = _checkpoint_status(config.sam2.checkpoint_path)
    sam2_configured = bool(config.sam2.enabled and sam2_checkpoint["present"])
    qwen_model = _directory_status(config.qwen_layers.model_path)
    qwen_remote = _qwen_remote_status(
        config.qwen_layers.remote_url,
        config.qwen_layers.remote_token,
        config.qwen_layers.remote_allowed_hosts,
    )
    qwen_configured = bool(
        config.qwen_layers.enabled
        and ((config.qwen_layers.backend == "local-cuda" and qwen_model["present"]) or (config.qwen_layers.backend == "remote-https" and qwen_remote["configured"] and qwen_remote["tokenConfigured"]))
    )
    return {
        "capability": "image.ocr",
        "baseDependencies": {
            "fastapi": importlib.util.find_spec("fastapi") is not None,
            "pillow": importlib.util.find_spec("PIL") is not None,
            "uvicorn": importlib.util.find_spec("uvicorn") is not None,
        },
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
        "qwenLayers": {
            "capability": "image.layers",
            "enabled": config.qwen_layers.enabled,
            "backend": config.qwen_layers.backend,
            "timeoutSeconds": config.qwen_layers.timeout_seconds,
            "minimumFreeVramBytes": config.qwen_layers.min_free_vram_bytes,
            "modelDirectory": qwen_model,
            "remote": qwen_remote,
            "runtime": "configured-not-verified" if qwen_configured else "unavailable",
            "note": "Enhanced mode requires a real CUDA or reviewed remote decomposition smoke; this command does not load Qwen.",
        },
        "mediaTools": {
            "ffmpeg": _media_tool_status(config.ffmpeg_path, "FFmpeg"),
            "ffprobe": _media_tool_status(config.ffprobe_path, "FFprobe"),
        },
        "hardware": detect_hardware(),
    }


if __name__ == "__main__":
    print(json.dumps(report(), indent=2, sort_keys=True))
