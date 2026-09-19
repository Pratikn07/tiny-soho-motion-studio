from __future__ import annotations

from io import BytesIO
from typing import Sequence

from PIL import Image, ImageChops, ImageDraw

from .image_input import DecodedImage
from .schemas.layers import EvidenceOverlap, LayerPrediction, RecompositionDiagnostics


def alpha_coverage(image: Image.Image) -> float:
    alpha = image.getchannel("A")
    return sum(1 for value in alpha.get_flattened_data() if value > 0) / (image.width * image.height)


def encode_rgba(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.convert("RGBA").save(buffer, format="PNG")
    return buffer.getvalue()


def decoded_rgba(image: DecodedImage) -> Image.Image:
    with Image.open(BytesIO(image.data)) as source:
        return source.convert("RGBA")


def recomposition_diagnostics(image: DecodedImage, layers: Sequence[LayerPrediction]) -> RecompositionDiagnostics:
    composed = Image.new("RGBA", (image.width, image.height), (0, 0, 0, 0))
    for layer in sorted(layers, key=lambda value: value.zIndex):
        with Image.open(BytesIO(layer.png)) as overlay:
            if overlay.size != composed.size or overlay.mode != "RGBA":
                return RecompositionDiagnostics(
                    recompositionMatchesInput=False,
                    overlap=classify_evidence_overlap([], []),
                )
            composed.alpha_composite(overlay)
    return RecompositionDiagnostics(
        recompositionMatchesInput=ImageChops.difference(composed, decoded_rgba(image)).getbbox() is None,
        overlap=classify_evidence_overlap([], []),
    )


def classify_evidence_overlap(ocr_regions: Sequence[object], segmentation_bounds: Sequence[object]) -> EvidenceOverlap:
    if not ocr_regions and not segmentation_bounds:
        return EvidenceOverlap(classification="not-evaluated", nonAuthoritative=True)
    return EvidenceOverlap(classification="potential-overlap", nonAuthoritative=True)


def centered_subject_mask(width: int, height: int) -> Image.Image:
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).ellipse((width // 4, height // 4, width - width // 4, height - height // 4), fill=255)
    return mask
