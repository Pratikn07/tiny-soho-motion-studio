from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, Field, model_validator

from .ocr import NormalizedBoundingBox, NormalizedPoint


class SegmentationPrompts(BaseModel):
    positivePoints: list[NormalizedPoint] = Field(default_factory=list, max_length=20)
    negativePoints: list[NormalizedPoint] = Field(default_factory=list, max_length=20)
    boundingBox: NormalizedBoundingBox | None = None

    @model_validator(mode="after")
    def has_a_foreground_hint(self) -> "SegmentationPrompts":
        if not self.positivePoints and self.boundingBox is None:
            raise ValueError("Segmentation requires a positive point or a bounding box.")
        return self


class SegmentationImage(BaseModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class SegmentationEngine(BaseModel):
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    version: str = Field(min_length=1)
    device: str | None = None
    runtimeStatus: str | None = None


class SegmentationMask(BaseModel):
    id: str = Field(min_length=1)
    artifactId: str = Field(pattern=r"^[0-9a-f]{8}-[0-9a-f-]{27}$")
    boundingBox: NormalizedBoundingBox
    score: float = Field(ge=0, le=1)


class SegmentationResult(BaseModel):
    image: SegmentationImage
    masks: list[SegmentationMask] = Field(min_length=1)
    engine: SegmentationEngine


@dataclass(frozen=True)
class SegmentationPrediction:
    id: str
    png: bytes
    boundingBox: NormalizedBoundingBox
    score: float
