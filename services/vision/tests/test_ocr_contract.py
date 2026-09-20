from __future__ import annotations

import asyncio
import base64
import importlib
import os
import sys
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

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
    def test_paddle_ocr_configuration_requires_explicit_external_model_directories(self) -> None:
        config_module = load_module("services.vision.config")
        with patch.dict(
            os.environ,
            {
                "TINY_SOHO_PADDLE_OCR_ENABLED": "1",
                "TINY_SOHO_PADDLE_OCR_PROFILE": "v5-mobile",
                "TINY_SOHO_PADDLE_OCR_DET_MODEL_DIR": "/opt/tiny-soho/models/det",
                "TINY_SOHO_PADDLE_OCR_REC_MODEL_DIR": "/opt/tiny-soho/models/rec",
                "TINY_SOHO_PADDLE_OCR_LANGUAGE": "en",
                "TINY_SOHO_PADDLE_OCR_TIMEOUT_SECONDS": "30",
            },
            clear=False,
        ):
            config = config_module.VisionConfig.from_env()

        self.assertTrue(config.paddle_ocr.enabled)
        self.assertEqual(config.paddle_ocr.profile, "v5-mobile")
        self.assertEqual(config.paddle_ocr.detection_model_dir, Path("/opt/tiny-soho/models/det"))
        self.assertEqual(config.paddle_ocr.recognition_model_dir, Path("/opt/tiny-soho/models/rec"))
        self.assertEqual(config.paddle_ocr.language, "en")
        self.assertEqual(config.paddle_ocr.timeout_seconds, 30)

    def test_paddle_ocr_normalizes_real_engine_output_without_dropping_low_recognition_text(self) -> None:
        ocr_module = load_module("services.vision.adapters.paddle_ocr")
        config_module = load_module("services.vision.config")
        image_module = load_module("services.vision.image_input")

        class FakePipeline:
            received_image = None

            def predict(self, image):
                self.received_image = image
                return [
                    {
                        "dt_polys": [[[0, 0], [10, 0], [10, 4], [0, 4]]],
                        "dt_scores": [0.95],
                        "rec_texts": ["Tiny Soho"],
                        "rec_scores": [0.01],
                    }
                ]

        with tempfile.TemporaryDirectory() as temporary_directory:
            model_root = Path(temporary_directory)
            detection_model_dir = model_root / "detection"
            recognition_model_dir = model_root / "recognition"
            for model_dir in (detection_model_dir, recognition_model_dir):
                model_dir.mkdir()
                (model_dir / "inference.yml").touch()
                (model_dir / "inference.pdiparams").touch()

            settings = config_module.PaddleOcrSettings(
                enabled=True,
                profile="v5-mobile",
                detection_model_dir=detection_model_dir,
                recognition_model_dir=recognition_model_dir,
                language="en",
                timeout_seconds=30,
            )
            pipeline = FakePipeline()
            adapter = ocr_module.PaddleOcrAdapter(
                settings,
                engine_factory=lambda _: (pipeline, "3.7.0", "cpu"),
            )
            image_bytes = BytesIO()
            Image.new("RGB", (10, 4), "white").save(image_bytes, format="PNG")
            image = image_module.decode_image(image_bytes.getvalue(), "image/png", max_bytes=1024, max_pixels=100)
            result = asyncio.run(adapter.recognize(image))

        self.assertEqual(result.engine.provider, "PaddleOCR")
        self.assertEqual(result.engine.model, "PP-OCRv5_mobile_det + en_PP-OCRv5_mobile_rec")
        self.assertEqual(result.engine.version, "3.7.0")
        self.assertEqual(result.engine.device, "cpu")
        self.assertEqual(result.engine.runtimeStatus, "ready")
        self.assertEqual(result.regions[0].text, "Tiny Soho")
        self.assertEqual(result.regions[0].detectionConfidence, 0.95)
        self.assertEqual(result.regions[0].recognitionConfidence, 0.01)
        self.assertEqual(result.regions[0].polygon[-1].x, 0.0)
        self.assertEqual(result.regions[0].polygon[-1].y, 1.0)
        self.assertFalse(isinstance(pipeline.received_image, (str, Path)))

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
