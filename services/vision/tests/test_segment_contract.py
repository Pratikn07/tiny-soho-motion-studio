from __future__ import annotations

import asyncio
import importlib
import os
import sys
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw


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
    def test_auto_device_uses_cpu_when_mps_has_not_been_runtime_validated(self) -> None:
        adapter_module = load_module("services.vision.adapters.sam2")

        class TorchWithUnvalidatedMps:
            class cuda:
                @staticmethod
                def is_available() -> bool:
                    return False

            class backends:
                class mps:
                    @staticmethod
                    def is_available() -> bool:
                        return True

        self.assertEqual(adapter_module._select_device(TorchWithUnvalidatedMps(), "auto"), "cpu")

    def test_sam2_configuration_requires_explicit_checkpoint_model_device_and_timeout(self) -> None:
        config_module = load_module("services.vision.config")
        with patch.dict(
            os.environ,
            {
                "TINY_SOHO_SAM2_ENABLED": "1",
                "TINY_SOHO_SAM2_CHECKPOINT_PATH": "/opt/tiny-soho/models/sam2.1_hiera_tiny.pt",
                "TINY_SOHO_SAM2_MODEL_CONFIG": "configs/sam2.1/sam2.1_hiera_t.yaml",
                "TINY_SOHO_SAM2_DEVICE": "auto",
                "TINY_SOHO_SAM2_TIMEOUT_SECONDS": "45",
            },
            clear=False,
        ):
            config = config_module.VisionConfig.from_env()

        self.assertTrue(config.sam2.enabled)
        self.assertEqual(config.sam2.checkpoint_path, Path("/opt/tiny-soho/models/sam2.1_hiera_tiny.pt"))
        self.assertEqual(config.sam2.model_config, "configs/sam2.1/sam2.1_hiera_t.yaml")
        self.assertEqual(config.sam2.device, "auto")
        self.assertEqual(config.sam2.timeout_seconds, 45)

    def test_real_adapter_contract_returns_a_source_sized_binary_mask_and_engine_metadata(self) -> None:
        adapter_module = load_module("services.vision.adapters.sam2")
        config_module = load_module("services.vision.config")
        image_module = load_module("services.vision.image_input")
        schema_module = load_module("services.vision.schemas.segmentation")

        class FakeEngine:
            def predict(self, image, prompts):
                mask = Image.new("L", (image.width, image.height), 0)
                ImageDraw.Draw(mask).rectangle((20, 10, 59, 39), fill=255)
                return mask, 0.87

        with tempfile.TemporaryDirectory() as temporary_directory:
            checkpoint = Path(temporary_directory) / "sam2.1_hiera_tiny.pt"
            checkpoint.touch()
            settings = config_module.Sam2Settings(
                enabled=True,
                checkpoint_path=checkpoint,
                model_config="configs/sam2.1/sam2.1_hiera_t.yaml",
                device="auto",
                timeout_seconds=45,
            )
            adapter = adapter_module.Sam2Adapter(
                settings,
                engine_factory=lambda _: (FakeEngine(), "2b90b9f", "mps"),
            )
            decoded = image_module.decode_image(image_bytes(), "image/png", max_bytes=4096, max_pixels=10_000)
            prompts = schema_module.SegmentationPrompts(positivePoints=[{"x": 0.5, "y": 0.5}])
            prediction = asyncio.run(adapter.segment(decoded, prompts))[0]

        with Image.open(BytesIO(prediction.png)) as mask:
            self.assertEqual(mask.mode, "L")
            self.assertEqual(mask.size, (100, 80))
            self.assertEqual(set(mask.get_flattened_data()), {0, 255})
        self.assertEqual(prediction.boundingBox.model_dump(), {"x": 0.2, "y": 0.125, "width": 0.4, "height": 0.375})
        self.assertEqual(prediction.score, 0.87)
        self.assertEqual(adapter.engine.provider, "SAM 2")
        self.assertEqual(adapter.engine.model, "sam2.1_hiera_tiny")
        self.assertEqual(adapter.engine.device, "mps")
        self.assertEqual(adapter.engine.runtimeStatus, "ready")

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
