"""Explicit local SAM 2 smoke for point, negative-point, and box prompting."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from .adapters.sam2 import default_sam2_adapter
from .config import VisionConfig
from .image_input import decode_image
from .schemas.segmentation import SegmentationPrompts


FIXTURE_DIRECTORY = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "vision"
SMOKE_CASES = (
    ("parenting-carousel.png", {"positivePoints": [{"x": 0.55, "y": 0.5}]}),
    (
        "food-carousel.png",
        {
            "positivePoints": [{"x": 0.31, "y": 0.47}],
            "negativePoints": [{"x": 0.69, "y": 0.54}],
        },
    ),
    ("difficult-overlap.png", {"boundingBox": {"x": 0.28, "y": 0.12, "width": 0.48, "height": 0.70}}),
)


async def run_smoke() -> dict[str, object]:
    config = VisionConfig.from_env()
    adapter = default_sam2_adapter(config.sam2)
    results = []
    for fixture_name, raw_prompts in SMOKE_CASES:
        image_path = FIXTURE_DIRECTORY / fixture_name
        image = decode_image(
            image_path.read_bytes(),
            "image/png",
            max_bytes=config.max_upload_bytes,
            max_pixels=config.max_image_pixels,
        )
        started = time.perf_counter()
        prediction = (await adapter.segment(image, SegmentationPrompts.model_validate(raw_prompts)))[0]
        results.append(
            {
                "fixture": fixture_name,
                "boundingBox": prediction.boundingBox.model_dump(),
                "score": prediction.score,
                "maskBytes": len(prediction.png),
                "latencyMilliseconds": round((time.perf_counter() - started) * 1000),
            }
        )
    return {
        "status": "passed",
        "engine": adapter.engine.model_dump(),
        "results": results,
        "note": "Local SAM 2 inference only; no provider request or model download was made.",
    }


def main() -> None:
    print(json.dumps(asyncio.run(run_smoke()), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
