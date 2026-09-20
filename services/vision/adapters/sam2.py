from __future__ import annotations

import importlib.util
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw

from .base import VisionCapabilityUnavailable
from ..image_input import DecodedImage
from ..schemas.ocr import NormalizedBoundingBox
from ..schemas.segmentation import SegmentationEngine, SegmentationPrediction, SegmentationPrompts


class FakeSegmentationAdapter:
    """Deterministic contract adapter; it is not a semantic segmentation model."""

    engine = SegmentationEngine(provider="FakeSegmentationAdapter", model="deterministic-mask", version="1")

    async def segment(self, image: DecodedImage, prompts: SegmentationPrompts) -> list[SegmentationPrediction]:
        mask = Image.new("L", (image.width, image.height), 0)
        draw = ImageDraw.Draw(mask)
        radius = max(2, round(min(image.width, image.height) / 8))

        if prompts.boundingBox is not None:
            bounding_box = prompts.boundingBox
            draw.rectangle(_pixel_box(bounding_box, image.width, image.height), fill=255)
        else:
            first_point = prompts.positivePoints[0]
            center_x = round(first_point.x * image.width)
            center_y = round(first_point.y * image.height)
            bounding_box = _normalized_box(center_x, center_y, radius, image.width, image.height)

        for point in prompts.positivePoints:
            center_x = round(point.x * image.width)
            center_y = round(point.y * image.height)
            draw.ellipse((center_x - radius, center_y - radius, center_x + radius, center_y + radius), fill=255)
        for point in prompts.negativePoints:
            center_x = round(point.x * image.width)
            center_y = round(point.y * image.height)
            draw.ellipse((center_x - radius, center_y - radius, center_x + radius, center_y + radius), fill=0)

        buffer = BytesIO()
        mask.save(buffer, format="PNG")
        return [SegmentationPrediction(id="foreground", png=buffer.getvalue(), boundingBox=bounding_box, score=1.0)]


class Sam2Adapter:
    """Lazy, explicit SAM 2 boundary. It never downloads a package or checkpoint."""

    def __init__(self, reason: str) -> None:
        self._reason = reason

    async def segment(self, image: DecodedImage, prompts: SegmentationPrompts) -> list[SegmentationPrediction]:
        raise VisionCapabilityUnavailable(self._reason)


def default_sam2_adapter(enabled: bool, checkpoint_path: Path | None) -> Sam2Adapter:
    if not enabled:
        return Sam2Adapter("SAM 2 is not configured.")
    if importlib.util.find_spec("sam2") is None:
        return Sam2Adapter("SAM 2 is enabled but its optional runtime is not installed.")
    if checkpoint_path is None:
        return Sam2Adapter("SAM 2 is enabled, but TINY_SOHO_SAM2_CHECKPOINT_PATH is not configured.")
    if not checkpoint_path.is_file():
        return Sam2Adapter("SAM 2 is enabled, but the configured checkpoint path is not a readable file.")
    return Sam2Adapter("SAM 2 checkpoint use requires an operator-reviewed runtime configuration.")


def _pixel_box(box: NormalizedBoundingBox, width: int, height: int) -> tuple[int, int, int, int]:
    return (
        round(box.x * width),
        round(box.y * height),
        round((box.x + box.width) * width),
        round((box.y + box.height) * height),
    )


def _normalized_box(center_x: int, center_y: int, radius: int, width: int, height: int) -> NormalizedBoundingBox:
    left = max(0, center_x - radius)
    top = max(0, center_y - radius)
    right = min(width, center_x + radius)
    bottom = min(height, center_y + radius)
    return NormalizedBoundingBox(x=left / width, y=top / height, width=(right - left) / width, height=(bottom - top) / height)
