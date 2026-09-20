from __future__ import annotations

import asyncio
import importlib
import sys
import unittest
from io import BytesIO
from pathlib import Path

from PIL import Image


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))


def load_module(module_name: str):
    try:
        return importlib.import_module(module_name)
    except ModuleNotFoundError as error:
        raise AssertionError(f"Expected {module_name} to provide the segmentation contract.") from error


def image_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (100, 80), "white").save(buffer, format="PNG")
    return buffer.getvalue()


class SegmentationContractTests(unittest.TestCase):
    def test_requires_a_positive_point_or_a_bounding_box_and_rejects_out_of_range_coordinates(self) -> None:
        schema_module = load_module("services.vision.schemas.segmentation")

        with self.assertRaises(ValueError):
            schema_module.SegmentationPrompts(negativePoints=[{"x": 0.5, "y": 0.5}])
        with self.assertRaises(ValueError):
            schema_module.SegmentationPrompts(positivePoints=[{"x": 1.01, "y": 0.5}])
        with self.assertRaises(ValueError):
            schema_module.SegmentationPrompts(boundingBox={"x": 0.9, "y": 0.9, "width": 0.2, "height": 0.2})

    def test_fake_segmentation_produces_a_binary_mask_with_positive_and_negative_prompts(self) -> None:
        adapter_module = load_module("services.vision.adapters.sam2")
        image_module = load_module("services.vision.image_input")
        schema_module = load_module("services.vision.schemas.segmentation")
        decoded = image_module.decode_image(image_bytes(), "image/png", max_bytes=4096, max_pixels=10_000)
        prompts = schema_module.SegmentationPrompts(
            positivePoints=[{"x": 0.5, "y": 0.5}],
            negativePoints=[{"x": 0.1, "y": 0.1}],
        )

        prediction = asyncio.run(adapter_module.FakeSegmentationAdapter().segment(decoded, prompts))[0]

        with Image.open(BytesIO(prediction.png)) as mask:
            self.assertEqual(mask.mode, "L")
            self.assertEqual(mask.size, (100, 80))
            self.assertEqual(mask.getpixel((50, 40)), 255)
            self.assertEqual(mask.getpixel((10, 8)), 0)
        self.assertEqual(prediction.boundingBox.model_dump(), {"x": 0.4, "y": 0.375, "width": 0.2, "height": 0.25})
