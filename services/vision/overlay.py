from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageDraw
from PIL import ImageFilter

from .artifacts.manager import ArtifactManager
from .image_input import DecodedImage, decode_image
from .schemas.ocr import OcrRegion
from .typography import default_padding_pixels


@dataclass(frozen=True)
class TypographyOverlay:
    png: bytes
    width: int
    height: int
    protectedRegionIds: list[str]
    paddingPixels: int


@dataclass(frozen=True)
class OverlayArtifact:
    artifactId: str
    sourceArtifactId: str
    width: int
    height: int
    protectedRegionIds: list[str]
    paddingPixels: int
    mode: str = "original-region-patch"


def create_typography_overlay(source: DecodedImage, regions: list[OcrRegion], *, padding_pixels: int | None = None) -> TypographyOverlay:
    with Image.open(BytesIO(source.data)) as original:
        source_rgba = original.convert("RGBA")
    mask = Image.new("L", source_rgba.size, 0)
    draw = ImageDraw.Draw(mask)
    for region in regions:
        points = [(round(point.x * source_rgba.width), round(point.y * source_rgba.height)) for point in region.polygon]
        draw.polygon(points, fill=255)
    padding = default_padding_pixels(source_rgba.width, source_rgba.height) if padding_pixels is None else padding_pixels
    if padding > 0:
        mask = mask.filter(ImageFilter.MaxFilter(size=padding * 2 + 1))
    overlay = Image.new("RGBA", source_rgba.size, (0, 0, 0, 0))
    overlay.paste(source_rgba, (0, 0), mask)
    buffer = BytesIO()
    overlay.save(buffer, format="PNG")
    return TypographyOverlay(
        png=buffer.getvalue(),
        width=source_rgba.width,
        height=source_rgba.height,
        protectedRegionIds=[region.id for region in regions],
        paddingPixels=padding,
    )


def create_overlay_artifact(manager: ArtifactManager, source_artifact_id: str, regions: list[OcrRegion], *, max_pixels: int) -> OverlayArtifact:
    source_metadata = manager.metadata(source_artifact_id)
    source = decode_image(
        manager.read_bytes(source_metadata.id),
        source_metadata.mimeType,
        max_bytes=manager.max_bytes,
        max_pixels=max_pixels,
    )
    overlay = create_typography_overlay(source, regions)
    metadata = manager.write_bytes(kind="typography-overlay", mime_type="image/png", data=overlay.png)
    return OverlayArtifact(
        artifactId=metadata.id,
        sourceArtifactId=source_metadata.id,
        width=overlay.width,
        height=overlay.height,
        protectedRegionIds=overlay.protectedRegionIds,
        paddingPixels=overlay.paddingPixels,
    )
