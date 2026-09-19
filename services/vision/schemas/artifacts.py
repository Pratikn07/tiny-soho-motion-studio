from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class ArtifactMetadata(BaseModel):
    id: str
    kind: str
    mimeType: str
    createdAt: datetime
    expiresAt: datetime
    sizeBytes: int
