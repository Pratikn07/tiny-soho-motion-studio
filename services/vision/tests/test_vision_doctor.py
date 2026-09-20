from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))


class VisionDoctorTests(unittest.TestCase):
    def test_media_tool_preflight_reports_missing_commands_without_loading_any_model(self) -> None:
        doctor = importlib.import_module("services.vision.vision_doctor")
        with patch.dict(
            os.environ,
            {
                "FFMPEG_PATH": "/not-a-real/ffmpeg",
                "FFPROBE_PATH": "/not-a-real/ffprobe",
                "TINY_SOHO_PADDLE_OCR_ENABLED": "0",
                "TINY_SOHO_SAM2_ENABLED": "0",
                "TINY_SOHO_QWEN_LAYERS_ENABLED": "0",
            },
            clear=False,
        ):
            result = doctor.report()

        self.assertEqual(result["mediaTools"]["ffmpeg"]["available"], False)
        self.assertEqual(result["mediaTools"]["ffprobe"]["available"], False)
        self.assertIn("not available", result["mediaTools"]["ffmpeg"]["reason"])

    def test_disabled_ocr_is_reported_unavailable_without_loading_a_model(self) -> None:
        doctor = importlib.import_module("services.vision.vision_doctor")
        with patch.dict(os.environ, {"TINY_SOHO_PADDLE_OCR_ENABLED": "0"}, clear=False):
            result = doctor.report()

        self.assertEqual(result["capability"], "image.ocr")
        self.assertEqual(result["runtime"], "unavailable")
        self.assertFalse(result["enabled"])
        self.assertIn("does not load a model", result["note"])

    def test_qwen_remote_token_is_never_returned_by_the_doctor(self) -> None:
        doctor = importlib.import_module("services.vision.vision_doctor")
        with patch.dict(
            os.environ,
            {
                "TINY_SOHO_QWEN_LAYERS_ENABLED": "1",
                "TINY_SOHO_QWEN_LAYERS_BACKEND": "remote-https",
                "TINY_SOHO_QWEN_LAYERS_REMOTE_URL": "https://layers.example.test/v1/decompose",
                "TINY_SOHO_QWEN_LAYERS_REMOTE_TOKEN": "must-not-appear",
                "TINY_SOHO_QWEN_LAYERS_REMOTE_ALLOWED_HOSTS": "layers.example.test",
            },
            clear=False,
        ):
            result = doctor.report()

        self.assertEqual(result["qwenLayers"]["remote"]["host"], "layers.example.test")
        self.assertTrue(result["qwenLayers"]["remote"]["tokenConfigured"])
        self.assertEqual(result["qwenLayers"]["remote"]["allowedHosts"], ["layers.example.test"])
        self.assertNotIn("must-not-appear", json.dumps(result))

    def test_qwen_local_directory_is_configuration_not_a_successful_inference(self) -> None:
        doctor = importlib.import_module("services.vision.vision_doctor")
        with tempfile.TemporaryDirectory() as temporary_directory, patch.dict(
            os.environ,
            {
                "TINY_SOHO_QWEN_LAYERS_ENABLED": "1",
                "TINY_SOHO_QWEN_LAYERS_BACKEND": "local-cuda",
                "TINY_SOHO_QWEN_LAYERS_MODEL_PATH": temporary_directory,
            },
            clear=False,
        ):
            result = doctor.report()

        self.assertTrue(result["qwenLayers"]["modelDirectory"]["present"])
        self.assertEqual(result["qwenLayers"]["runtime"], "configured-not-verified")
