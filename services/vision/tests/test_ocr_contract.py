from __future__ import annotations

import asyncio
import base64
import importlib
import sys
import unittest
from io import BytesIO
from pathlib import Path

from PIL import Image


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="
)


def load_module(module_name: str):
    try:
        return importlib.import_module(module_name)
    except ModuleNotFoundError as error:
        raise AssertionError(f"Expected {module_name} to provide the OCR contract.") from error


class OcrContractTests(unittest.TestCase):
    def test_fake_ocr_preserves_a_low_confidence_region_for_typography_protection(self) -> None:
        ocr_module = load_module("services.vision.adapters.paddle_ocr")
        schema_module = load_module("services.vision.schemas.ocr")
        image_module = load_module("services.vision.image_input")
        image = image_module.decode_image(ONE_PIXEL_PNG, "image/png", max_bytes=1024, max_pixels=16)
        region = schema_module.OcrRegion(
            id="headline",
            text="possibly wrong",
            detectionConfidence=0.99,
            recognitionConfidence=0.12,
            polygon=[
                {"x": 0.10, "y": 0.10},
                {"x": 0.90, "y": 0.10},
                {"x": 0.90, "y": 0.30},
                {"x": 0.10, "y": 0.30},
            ],
            boundingBox={"x": 0.10, "y": 0.10, "width": 0.80, "height": 0.20},
        )

        result = asyncio.run(ocr_module.FakeOcrAdapter([region]).recognize(image))

        self.assertEqual(result.image.width, 1)
        self.assertEqual(result.regions[0].id, "headline")
        self.assertEqual(result.regions[0].recognitionConfidence, 0.12)

    def test_rejects_polygon_coordinates_outside_the_normalized_canvas(self) -> None:
        schema_module = load_module("services.vision.schemas.ocr")

        with self.assertRaises(ValueError):
            schema_module.OcrRegion(
                id="invalid",
                text="x",
                detectionConfidence=1,
                recognitionConfidence=1,
                polygon=[{"x": -0.01, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}],
                boundingBox={"x": 0, "y": 0, "width": 1, "height": 1},
            )

    def test_typography_mask_uses_dimension_relative_padding_and_dilates_regions(self) -> None:
        schema_module = load_module("services.vision.schemas.ocr")
        typography_module = load_module("services.vision.typography")
        region = schema_module.OcrRegion(
            id="copy",
            text="copy",
            detectionConfidence=1,
            recognitionConfidence=None,
            polygon=[{"x": 0.40, "y": 0.40}, {"x": 0.60, "y": 0.40}, {"x": 0.60, "y": 0.60}, {"x": 0.40, "y": 0.60}],
            boundingBox={"x": 0.40, "y": 0.40, "width": 0.20, "height": 0.20},
        )

        mask = typography_module.create_typography_safety_mask(100, 50, [region])
        with Image.open(BytesIO(mask.png)) as image:
            self.assertEqual(image.size, (100, 50))
            self.assertEqual(mask.paddingPixels, 2)
            self.assertEqual(image.getpixel((37, 50 // 2)), 0)
            self.assertGreater(image.getpixel((38, 50 // 2)), 0)
