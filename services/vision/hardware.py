from __future__ import annotations

import importlib
import os
import platform
from typing import Any


def _load_torch() -> Any | None:
    try:
        return importlib.import_module("torch")
    except ModuleNotFoundError:
        return None


def _accelerator_status(torch_module: Any | None, accelerator: str) -> dict[str, Any]:
    if torch_module is None:
        return {
            "available": False,
            "reason": f"PyTorch is not installed; {accelerator.upper()} cannot be checked.",
        }

    try:
        if accelerator == "mps":
            available = bool(torch_module.backends.mps.is_available())
        else:
            available = bool(torch_module.cuda.is_available())
    except (AttributeError, RuntimeError):
        available = False

    return {
        "available": available,
        "reason": None if available else f"{accelerator.upper()} is not available.",
    }


def detect_hardware(torch_module: Any | None = None) -> dict[str, Any]:
    """Report CPU/MPS/CUDA readiness without installing packages or downloading weights."""
    torch_module = _load_torch() if torch_module is None else torch_module
    mps = _accelerator_status(torch_module, "mps")
    cuda = _accelerator_status(torch_module, "cuda")

    device_count = 0
    if cuda["available"]:
        try:
            device_count = int(torch_module.cuda.device_count())
        except (AttributeError, RuntimeError):
            cuda = {"available": False, "reason": "CUDA device count could not be read."}

    return {
        "cpu": {
            "available": True,
            "cores": max(1, os.cpu_count() or 1),
            "architecture": platform.machine() or "unknown",
        },
        "mps": mps,
        "cuda": {**cuda, "deviceCount": device_count},
    }
