from __future__ import annotations

import importlib
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))


class VisionDoctorTests(unittest.TestCase):
    def test_disabled_ocr_is_reported_unavailable_without_loading_a_model(self) -> None:
        doctor = importlib.import_module("services.vision.vision_doctor")
        with patch.dict(os.environ, {"TINY_SOHO_PADDLE_OCR_ENABLED": "0"}, clear=False):
            result = doctor.report()

        self.assertEqual(result["capability"], "image.ocr")
        self.assertEqual(result["runtime"], "unavailable")
        self.assertFalse(result["enabled"])
        self.assertIn("does not load a model", result["note"])
