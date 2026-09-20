from __future__ import annotations

import importlib.util

from .base import VisionCapabilityUnavailable
from ..image_input import DecodedImage
from ..schemas.ocr import OcrEngine, OcrImage, OcrRegion, OcrResult


class FakeOcrAdapter:
    def __init__(self, regions: list[OcrRegion]) -> None:
        self._regions = regions

    async def recognize(self, image: DecodedImage) -> OcrResult:
        return OcrResult(
            image=OcrImage(width=image.width, height=image.height),
            regions=[region.model_copy(deep=True) for region in self._regions],
            engine=OcrEngine(provider="FakeOcrAdapter", model="deterministic-fake", version="1"),
        )


class PaddleOcrAdapter:
    """Explicitly configured boundary for a future licensed PaddleOCR runtime."""

    def __init__(self, reason: str) -> None:
        self._reason = reason

    async def recognize(self, image: DecodedImage) -> OcrResult:
        raise VisionCapabilityUnavailable(self._reason)


def default_paddle_ocr_adapter(enabled: bool) -> PaddleOcrAdapter:
    if not enabled:
        return PaddleOcrAdapter("PaddleOCR is not configured.")
    if importlib.util.find_spec("paddleocr") is None:
        return PaddleOcrAdapter("PaddleOCR is enabled but its optional runtime is not installed.")
    return PaddleOcrAdapter("PaddleOCR is installed, but no verified checkpoint is configured.")
