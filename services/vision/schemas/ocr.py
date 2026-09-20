from __future__ import annotations

from typing import Self

from pydantic import BaseModel, Field, model_validator


class NormalizedPoint(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class NormalizedBoundingBox(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def stays_inside_canvas(self) -> Self:
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("Bounding boxes must stay inside normalized image coordinates.")
        return self


class OcrRegion(BaseModel):
    id: str = Field(min_length=1)
    text: str
    detectionConfidence: float | None = Field(default=None, ge=0, le=1)
    recognitionConfidence: float | None = Field(default=None, ge=0, le=1)
    polygon: list[NormalizedPoint] = Field(min_length=3)
    boundingBox: NormalizedBoundingBox
    angleDegrees: float | None = None


class OcrImage(BaseModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class OcrEngine(BaseModel):
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    version: str = Field(min_length=1)
    device: str | None = None
    runtimeStatus: str | None = None


class OcrResult(BaseModel):
    image: OcrImage
    regions: list[OcrRegion]
    engine: OcrEngine
    typographySafetyMaskArtifactId: str | None = None
