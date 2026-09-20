"""Explicit Qwen Image Layered smoke; it never provisions packages or weights."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from .adapters.qwen_layers import QwenLocalCudaBackend, QwenRemoteHttpsBackend, default_qwen_layers_backend
from .config import VisionConfig
from .image_input import decode_image
from .layers import recomposition_diagnostics
from .schemas.layers import LayerOptions


FIXTURE_PATH = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "vision" / "parenting-carousel.png"


async def run_smoke() -> dict[str, object]:
    config = VisionConfig.from_env()
    backend = default_qwen_layers_backend(config.qwen_layers)
    if not isinstance(backend, (QwenLocalCudaBackend, QwenRemoteHttpsBackend)):
        raise RuntimeError("Configure an explicit Qwen local-cuda or remote-https backend before running this smoke.")
    image = decode_image(
        FIXTURE_PATH.read_bytes(),
        "image/png",
        max_bytes=config.max_upload_bytes,
        max_pixels=config.max_image_pixels,
    )
    options = LayerOptions(requestedLayerCount=4, seed=777)
    started = time.perf_counter()
    layers = await backend.decompose(image, options)
    diagnostics = recomposition_diagnostics(image, layers)
    return {
        "status": "warning" if diagnostics.warning else "passed",
        "backend": backend.backend.model_dump(),
        "fixture": FIXTURE_PATH.name,
        "layerCount": len(layers),
        "latencyMilliseconds": round((time.perf_counter() - started) * 1000),
        "diagnostics": diagnostics.model_dump(),
        "note": "Explicit Qwen decomposition only; no provider request or model download was made by this command.",
    }


def main() -> None:
    print(json.dumps(asyncio.run(run_smoke()), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
