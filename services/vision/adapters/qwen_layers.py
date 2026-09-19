from __future__ import annotations

import importlib.util
from pathlib import Path

from PIL import ImageChops

from .base import VisionCapabilityUnavailable
from ..image_input import DecodedImage
from ..layers import alpha_coverage, centered_subject_mask, decoded_rgba, encode_rgba
from ..schemas.layers import LayerBackend, LayerPrediction


class FakeQwenLayersBackend:
    """Deterministic alpha-layer contract adapter; it is not Qwen inference."""

    backend = LayerBackend(provider="FakeQwenLayersBackend", model="deterministic-rgba", version="1")

    async def decompose(self, image: DecodedImage, prompt: str | None = None) -> list[LayerPrediction]:
        source = decoded_rgba(image)
        subject_alpha = centered_subject_mask(source.width, source.height)
        background_alpha = ImageChops.invert(subject_alpha)

        background = source.copy()
        background.putalpha(background_alpha)
        subject = source.copy()
        subject.putalpha(subject_alpha)
        return [
            LayerPrediction(id="background", png=encode_rgba(background), zIndex=0, alphaCoverage=alpha_coverage(background)),
            LayerPrediction(id="subject", png=encode_rgba(subject), zIndex=1, alphaCoverage=alpha_coverage(subject)),
        ]


class QwenLocalCudaBackend:
    """Configured-only boundary. It never imports a model or downloads weights by itself."""

    def __init__(self, reason: str) -> None:
        self._reason = reason

    async def decompose(self, image: DecodedImage, prompt: str | None = None) -> list[LayerPrediction]:
        raise VisionCapabilityUnavailable(self._reason)


def default_qwen_layers_backend(enabled: bool, model_path: Path | None) -> QwenLocalCudaBackend:
    if not enabled:
        return QwenLocalCudaBackend("Qwen Image Layered is not configured.")
    if importlib.util.find_spec("torch") is None or importlib.util.find_spec("transformers") is None:
        return QwenLocalCudaBackend("Qwen Image Layered is enabled but its optional CUDA runtime is not installed.")
    if model_path is None:
        return QwenLocalCudaBackend("Qwen Image Layered is enabled, but TINY_SOHO_QWEN_LAYERS_MODEL_PATH is not configured.")
    if not model_path.is_dir():
        return QwenLocalCudaBackend("Qwen Image Layered is enabled, but the configured model path is not a readable directory.")
    return QwenLocalCudaBackend("Qwen Image Layered requires an operator-reviewed CUDA runtime configuration.")
