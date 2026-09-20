from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal


_UNCHANGED = object()


RuntimeState = Literal["unloaded", "loading", "ready", "error"]


@dataclass(frozen=True)
class CapabilityRuntimeStatus:
    capabilityId: str
    backend: str
    state: RuntimeState
    available: bool
    reason: str | None = None

    def as_dict(self) -> dict[str, str | bool | None]:
        return {
            "capabilityId": self.capabilityId,
            "backend": self.backend,
            "state": self.state,
            "available": self.available,
            "reason": self.reason,
        }


class RuntimeRegistry:
    def __init__(self) -> None:
        self._statuses: dict[str, CapabilityRuntimeStatus] = {}

    @classmethod
    def default(cls) -> "RuntimeRegistry":
        registry = cls()
        registry.register("image.ocr", backend="PaddleOcrAdapter", available=False, reason="PaddleOCR is not configured.")
        registry.register("image.segment", backend="Sam2Adapter", available=False, reason="SAM 2 is not configured.")
        registry.register("image.layers", backend="QwenLocalCudaBackend", available=False, reason="Qwen Image Layered is not configured.")
        registry.register("image.inpaint", backend="ReservedInpaintBackend", available=False, reason="Inpainting is reserved for a reviewed future backend.")
        registry.register("video.compose.typography", backend="FFmpeg", available=True, reason=None)
        return registry

    def register(self, capability_id: str, *, backend: str, available: bool, reason: str | None) -> None:
        self._statuses[capability_id] = CapabilityRuntimeStatus(
            capabilityId=capability_id,
            backend=backend,
            state="ready" if available else "unloaded",
            available=available,
            reason=reason,
        )

    def status(self, capability_id: str) -> CapabilityRuntimeStatus:
        try:
            return self._statuses[capability_id]
        except KeyError as error:
            raise KeyError(f"No runtime status is registered for {capability_id}.") from error

    def transition(
        self,
        capability_id: str,
        *,
        state: RuntimeState,
        reason: str | None | object = _UNCHANGED,
        available: bool | object = _UNCHANGED,
    ) -> CapabilityRuntimeStatus:
        current = self.status(capability_id)
        if available is _UNCHANGED:
            next_available = True if state == "ready" else False if state == "error" else current.available
        else:
            next_available = bool(available)
        next_status = replace(
            current,
            state=state,
            available=next_available,
            reason=current.reason if reason is _UNCHANGED else reason,
        )
        self._statuses[capability_id] = next_status
        return next_status

    def statuses(self) -> dict[str, CapabilityRuntimeStatus]:
        return dict(self._statuses)
