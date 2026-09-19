from __future__ import annotations

from io import BytesIO
from dataclasses import dataclass
from typing import Sequence

from PIL import Image, ImageChops, ImageDraw

from .image_input import DecodedImage
from .schemas.layers import EvidenceOverlap, LayerClassification, LayerPrediction, RecompositionDiagnostics


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
                    classifications=classify_layers(layers),
                )
            composed.alpha_composite(overlay)
    return RecompositionDiagnostics(
        recompositionMatchesInput=ImageChops.difference(composed, decoded_rgba(image)).getbbox() is None,
        overlap=classify_evidence_overlap([], []),
        classifications=classify_layers(layers),
    )


def classify_evidence_overlap(ocr_regions: Sequence[object], segmentation_bounds: Sequence[object]) -> EvidenceOverlap:
    if not ocr_regions and not segmentation_bounds:
        return EvidenceOverlap(classification="not-evaluated", nonAuthoritative=True)
    return EvidenceOverlap(classification="potential-overlap", nonAuthoritative=True)


@dataclass(frozen=True)
class LayerClassificationThresholds:
    text_like: float = 0.6
    subject_like: float = 0.6
    background_like_coverage: float = 0.95


def classify_layers(
    layers: Sequence[LayerPrediction],
    *,
    typography_mask: Image.Image | None = None,
    subject_mask: Image.Image | None = None,
    thresholds: LayerClassificationThresholds = LayerClassificationThresholds(),
) -> list[LayerClassification]:
    """Classify alpha evidence conservatively; z-order is never layer semantics."""
    return [classify_layer(layer, typography_mask=typography_mask, subject_mask=subject_mask, thresholds=thresholds) for layer in layers]


def classify_layer(
    layer: LayerPrediction,
    *,
    typography_mask: Image.Image | None,
    subject_mask: Image.Image | None,
    thresholds: LayerClassificationThresholds,
) -> LayerClassification:
    with Image.open(BytesIO(layer.png)) as image:
        alpha = image.convert("RGBA").getchannel("A")
    text_overlap = alpha_overlap_ratio(alpha, typography_mask)
    subject_overlap = alpha_overlap_ratio(alpha, subject_mask)
    coverage = alpha_coverage(Image.merge("RGBA", (alpha, alpha, alpha, alpha)))
    if typography_mask is not None and text_overlap >= thresholds.text_like:
        role, confidence = "text-like", text_overlap
    elif subject_mask is not None and subject_overlap >= thresholds.subject_like:
        role, confidence = "subject-like", subject_overlap
    elif typography_mask is None and subject_mask is None:
        role, confidence = "unknown", 0.0
    elif coverage >= thresholds.background_like_coverage:
        role, confidence = "background-like", coverage
    elif coverage > 0:
        role, confidence = "visual", coverage
    else:
        role, confidence = "unknown", 0.0
    return LayerClassification(
        layerId=layer.id,
        textOverlap=text_overlap,
        subjectOverlap=subject_overlap,
        inferredRole=role,
        confidence=confidence,
        nonAuthoritative=True,
    )


def alpha_overlap_ratio(alpha: Image.Image, evidence: Image.Image | None) -> float:
    if evidence is None:
        return 0.0
    if alpha.size != evidence.size:
        raise ValueError("Evidence masks must match layer dimensions.")
    alpha_values = alpha.get_flattened_data()
    evidence_values = evidence.convert("L").get_flattened_data()
    covered = sum(1 for value in alpha_values if value > 0)
    if covered == 0:
        return 0.0
    return sum(1 for alpha_value, evidence_value in zip(alpha_values, evidence_values, strict=True) if alpha_value > 0 and evidence_value > 0) / covered


def centered_subject_mask(width: int, height: int) -> Image.Image:
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).ellipse((width // 4, height // 4, width - width // 4, height - height // 4), fill=255)
    return mask
