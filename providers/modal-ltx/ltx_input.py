"""Input checks and transfers for the LTX Modal app. Plain Python (no Modal, no torch), so it is unit-tested locally.

The worker sends T0's `GenerationInput`: a short-lived signed URL for the background layer only, a signed upload
URL for the take's raw.mp4, the prompt and the generation settings. Nothing else reaches Modal: no text layer, no
Supabase keys. URLs carry tokens, so they are never logged or returned.
"""
from __future__ import annotations

import math
import os
import re
import urllib.request
from dataclasses import dataclass
from urllib.parse import urlsplit

FPS, FRAMES = 24, 121  # 121 frames at 24 fps is 5.04 s; finishing trims to exactly 5 s.
MIN_SIDE, MAX_SIDE = 256, 1536
MAX_PIXELS = 1_000_000  # The benchmark's 768x960 is 737k; every B2 size keeps about that many pixels.
MAX_PROMPT = 5000  # T0 generationInputSchema.
MAX_BACKGROUND_BYTES = 40 * 1024 * 1024
TRANSFER_TIMEOUT = 60
KEY = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class InputError(ValueError):
    """A request the app refuses before any GPU work. `code` goes back to the worker as the error code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Generation:
    idempotency_key: str
    model_id: str
    background_url: str
    output_upload_url: str
    prompt: str
    seed: int
    width: int
    height: int
    frames: int
    fps: int
    end_strength: float | None


def allowed_hosts() -> set[str]:
    """Optional allowlist (deploy-time env LTX_ALLOWED_URL_HOSTS, comma separated), e.g. the Supabase host."""
    return {host.strip().lower() for host in os.environ.get("LTX_ALLOWED_URL_HOSTS", "").split(",") if host.strip()}


def check_url(value: object, name: str) -> str:
    if not isinstance(value, str) or len(value) > 4096:
        raise InputError("ltx_input_invalid", f"{name} is missing.")
    parts = urlsplit(value)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        raise InputError("ltx_input_invalid", f"{name} must be an https URL.")
    hosts = allowed_hosts()
    if hosts and parts.hostname.lower() not in hosts:
        raise InputError("ltx_input_invalid", f"{name} points at a host this app does not accept.")
    return value


def whole(value: object, name: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise InputError("ltx_input_invalid", f"{name} must be a whole number between {low} and {high}.")
    return value


def parse(payload: object) -> Generation:
    """Validate T0 `GenerationInput`. Sizes must be multiples of 64 (the two-stage pipeline upsamples x2)."""
    if not isinstance(payload, dict):
        raise InputError("ltx_input_invalid", "The request must be an object.")
    key = payload.get("idempotencyKey")
    if not isinstance(key, str) or not KEY.match(key):
        raise InputError("ltx_input_invalid", "idempotencyKey must be the take id.")
    prompt = payload.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT:
        raise InputError("ltx_input_invalid", "The prompt is empty or too long.")
    width = whole(payload.get("width"), "width", MIN_SIDE, MAX_SIDE)
    height = whole(payload.get("height"), "height", MIN_SIDE, MAX_SIDE)
    if width % 64 or height % 64 or width * height > MAX_PIXELS:
        raise InputError("model_unsupported_for_slide", "LTX needs a size in multiples of 64 of about 0.74 megapixels.")
    frames = whole(payload.get("frames", FRAMES), "frames", 9, 257)
    if (frames - 1) % 8:
        raise InputError("ltx_input_invalid", "frames must be 8k+1 (for example 121).")
    fps = whole(payload.get("fps", FPS), "fps", 8, 60)
    end = payload.get("endFrame")
    strength = None
    if end is not None:
        raw = end.get("strength") if isinstance(end, dict) else None
        if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw) or not 0 <= raw <= 1:
            raise InputError("ltx_input_invalid", "endFrame.strength must be between 0 and 1.")
        strength = float(raw) or None  # T0 allows 0: a keyframe with no pull is the same as none.
    model_id = payload.get("modelId")
    if not isinstance(model_id, str) or not model_id:
        raise InputError("ltx_input_invalid", "modelId is missing.")
    return Generation(key, model_id, check_url(payload.get("backgroundUrl"), "backgroundUrl"),
                      check_url(payload.get("outputUploadUrl"), "outputUploadUrl"), prompt.strip(),
                      whole(payload.get("seed"), "seed", 0, 2**31 - 1), width, height, frames, fps, strength)


def download(url: str, *, limit: int = MAX_BACKGROUND_BYTES, opener=urllib.request.urlopen) -> bytes:
    try:
        with opener(urllib.request.Request(url, method="GET"), timeout=TRANSFER_TIMEOUT) as response:
            data = response.read(limit + 1)
    except OSError as error:
        raise InputError("ltx_background_unavailable", "The background could not be downloaded.") from None
    if not data:
        raise InputError("ltx_background_unavailable", "The background download was empty.")
    if len(data) > limit:
        raise InputError("ltx_input_invalid", "The background is too large.")
    return data


def upload(url: str, data: bytes, *, opener=urllib.request.urlopen) -> None:
    """PUT the clip to the signed upload URL for owners/{uid}/projects/{pid}/takes/{takeId}/raw.mp4."""
    request = urllib.request.Request(url, data=data, method="PUT", headers={"Content-Type": "video/mp4",
                                                                            "x-upsert": "true"})
    try:
        with opener(request, timeout=TRANSFER_TIMEOUT) as response:
            if response.status >= 300:
                raise OSError(response.status)
    except OSError:
        raise InputError("ltx_upload_failed", "The clip could not be uploaded.") from None
