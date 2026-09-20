from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


RuntimeState = Literal["unloaded", "loading", "ready", "error"]


class RuntimeStatus(BaseModel):
    capabilityId: str
    backend: str
    state: RuntimeState
    available: bool
    reason: str | None = None
