from __future__ import annotations

import importlib.util
from pathlib import Path

from PIL import Image, ImageDraw

from .base import VisionCapabilityUnavailable
from ..image_input import DecodedImage
from ..layers import alpha_coverage, decoded_rgba, encode_rgba
from ..schemas.layers import LayerBackend, LayerOptions, LayerPrediction


class FakeQwenLayersBackend:
    """Deterministic alpha-layer contract adapter; it is not Qwen inference."""

    backend = LayerBackend(provider="FakeQwenLayersBackend", model="deterministic-rgba", version="1")

    async def decompose(self, image: DecodedImage, options: LayerOptions = LayerOptions()) -> list[LayerPrediction]:
        source = decoded_rgba(image)
        columns = options.requestedLayerCount // 2
        predictions = []
        for index in range(options.requestedLayerCount):
            column, row = index % columns, index // columns
            left, right = (column * source.width) // columns, ((column + 1) * source.width) // columns
            top, bottom = (row * source.height) // 2, ((row + 1) * source.height) // 2
            alpha = Image.new("L", source.size, 0)
            if right > left and bottom > top:
                ImageDraw.Draw(alpha).rectangle((left, top, right - 1, bottom - 1), fill=255)
            layer = source.copy()
            layer.putalpha(alpha)
            predictions.append(LayerPrediction(
                id=f"layer-{index + 1}",
                png=encode_rgba(layer),
                zIndex=index,
                alphaCoverage=alpha_coverage(layer),
            ))
        return predictions


class QwenLocalCudaBackend:
    """Configured-only boundary. It never imports a model or downloads weights by itself."""

    def __init__(self, reason: str) -> None:
        self._reason = reason

    async def decompose(self, image: DecodedImage, options: LayerOptions = LayerOptions()) -> list[LayerPrediction]:
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
