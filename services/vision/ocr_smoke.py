"""Explicit local PaddleOCR smoke against textual fixtures; no provider calls or downloads."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from .adapters.paddle_ocr import default_paddle_ocr_adapter
from .config import VisionConfig
from .image_input import decode_image


FIXTURE_DIRECTORY = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "vision"
FIXTURE_NAMES = (
    "parenting-carousel-text.png",
    "food-carousel-text.png",
    "difficult-overlap-text.png",
)


async def run_smoke() -> dict[str, object]:
    config = VisionConfig.from_env()
    adapter = default_paddle_ocr_adapter(config.paddle_ocr)
    results = []
    for fixture_name in FIXTURE_NAMES:
        fixture = FIXTURE_DIRECTORY / fixture_name
        started = time.perf_counter()
        image = decode_image(
            fixture.read_bytes(),
            "image/png",
            max_bytes=config.max_upload_bytes,
            max_pixels=config.max_image_pixels,
        )
        recognized = await adapter.recognize(image)
        texts = [region.text for region in recognized.regions if region.text]
        results.append(
            {
                "fixture": fixture_name,
                "regions": len(recognized.regions),
                "recognizedText": texts,
                "latencyMilliseconds": round((time.perf_counter() - started) * 1000),
                "engine": recognized.engine.model_dump(),
            }
        )
    if any(not result["recognizedText"] for result in results):
        raise RuntimeError("PaddleOCR smoke found no recognized text in at least one required textual fixture.")
    return {"status": "passed", "results": results, "note": "Local CPU OCR only; no provider request or model download was made."}


def main() -> None:
    print(json.dumps(asyncio.run(run_smoke()), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
