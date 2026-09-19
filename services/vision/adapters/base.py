from __future__ import annotations


class VisionCapabilityUnavailable(RuntimeError):
    """A capability has no configured, safe local backend."""
