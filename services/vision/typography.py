from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageDraw, ImageFilter

from .schemas.ocr import OcrRegion


@dataclass(frozen=True)
class TypographySafetyMask:
    png: bytes
    paddingPixels: int


def default_padding_pixels(width: int, height: int) -> int:
    return max(2, min(64, round(min(width, height) * 0.01)))


def create_typography_safety_mask(width: int, height: int, regions: list[OcrRegion], padding_pixels: int | None = None) -> TypographySafetyMask:
    padding = default_padding_pixels(width, height) if padding_pixels is None else padding_pixels
    if width < 1 or height < 1 or padding < 0:
        raise ValueError("Mask dimensions and padding must be valid.")
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    for region in regions:
        polygon = [(round(point.x * (width - 1)), round(point.y * (height - 1))) for point in region.polygon]
        draw.polygon(polygon, fill=255)
    if regions and padding:
        mask = mask.filter(ImageFilter.MaxFilter(size=padding * 2 + 1))
    output = BytesIO()
    mask.save(output, format="PNG")
    return TypographySafetyMask(png=output.getvalue(), paddingPixels=padding)
