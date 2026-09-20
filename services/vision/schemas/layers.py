from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field


class LayerImage(BaseModel):
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class LayerBackend(BaseModel):
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    version: str = Field(min_length=1)


class LayerOptions(BaseModel):
    prompt: str | None = Field(default=None, max_length=1000)
    requestedLayerCount: Literal[4, 6, 8] = 4
    seed: int | None = None


class LayerArtifact(BaseModel):
    id: str = Field(min_length=1)
    artifactId: str = Field(pattern=r"^[0-9a-f]{8}-[0-9a-f-]{27}$")
    zIndex: int = Field(ge=0)
    alphaCoverage: float = Field(ge=0, le=1)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class EvidenceOverlap(BaseModel):
    classification: Literal["not-evaluated", "potential-overlap", "no-overlap"]
    nonAuthoritative: Literal[True]


class LayerClassification(BaseModel):
    layerId: str = Field(min_length=1)
    textOverlap: float = Field(ge=0, le=1)
    subjectOverlap: float = Field(ge=0, le=1)
    inferredRole: Literal["text-like", "subject-like", "background-like", "visual", "unknown"]
    confidence: float = Field(ge=0, le=1)
    nonAuthoritative: Literal[True]


class RecompositionDiagnostics(BaseModel):
    recompositionMatchesInput: bool
    overlap: EvidenceOverlap
    classifications: list[LayerClassification]


class LayerResult(BaseModel):
    image: LayerImage
    layers: list[LayerArtifact] = Field(min_length=1)
    diagnostics: RecompositionDiagnostics
    backend: LayerBackend
    options: LayerOptions


@dataclass(frozen=True)
class LayerPrediction:
    id: str
    png: bytes
    zIndex: int
    alphaCoverage: float
