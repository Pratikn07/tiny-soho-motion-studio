from __future__ import annotations

import json
import os
import urllib.request
from collections.abc import Callable, Mapping
from typing import Any
from urllib.parse import urlparse


def run_smoke(env: Mapping[str, str] | None = None, get_json: Callable[[str], dict[str, Any]] | None = None) -> dict[str, Any]:
    environment = env or os.environ
    if environment.get("TINY_SOHO_RUN_VISION_INTEGRATION") != "1":
        return {"status": "skipped", "reason": "Set TINY_SOHO_RUN_VISION_INTEGRATION=1 to run the local health probe."}
    base_url = environment.get("TINY_SOHO_VISION_SMOKE_URL", "http://127.0.0.1:8765").rstrip("/")
    _validate_loopback_url(base_url)
    health = (get_json or _get_json)(f"{base_url}/health")
    return {
        "status": "checked",
        "service": health.get("service"),
        "hardware": health.get("hardware"),
        "note": "Health-only probe; no model inference or download was requested.",
    }


def _validate_loopback_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.username or parsed.password or parsed.path not in ("", "/"):
        raise RuntimeError("TINY_SOHO_VISION_SMOKE_URL must be an http://127.0.0.1 loopback URL.")


def _get_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=3) as response:  # noqa: S310 - URL is validated as loopback above.
        return json.loads(response.read().decode("utf-8"))


if __name__ == "__main__":
    print(json.dumps(run_smoke(), sort_keys=True))
