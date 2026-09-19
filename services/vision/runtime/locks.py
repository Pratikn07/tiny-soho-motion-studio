from __future__ import annotations

import asyncio


class InferenceLocks:
    """Per-capability locks prevent concurrent heavy model initialization."""

    def __init__(self) -> None:
        self._locks: dict[str, asyncio.Lock] = {}

    def get(self, capability_id: str) -> asyncio.Lock:
        if capability_id not in self._locks:
            self._locks[capability_id] = asyncio.Lock()
        return self._locks[capability_id]
