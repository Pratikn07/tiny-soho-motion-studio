from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class HostedVisionConfig:
    supabase_url: str
    service_role_key: str
    poll_seconds: float
    service_version: str = "0.1.0"

    @classmethod
    def from_env(cls) -> "HostedVisionConfig":
        supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not supabase_url or not service_role_key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the hosted Vision worker.")
        try:
            poll_seconds = float(os.environ.get("CREATIVE_VISION_POLL_SECONDS", "1"))
        except ValueError as error:
            raise ValueError("CREATIVE_VISION_POLL_SECONDS must be numeric.") from error
        if not 0.2 <= poll_seconds <= 60:
            raise ValueError("CREATIVE_VISION_POLL_SECONDS must be between 0.2 and 60.")
        return cls(supabase_url=supabase_url, service_role_key=service_role_key, poll_seconds=poll_seconds)
