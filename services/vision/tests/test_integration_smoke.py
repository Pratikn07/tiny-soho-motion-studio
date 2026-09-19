from __future__ import annotations

import importlib
import sys
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))


class IntegrationSmokeTests(unittest.TestCase):
    def test_smoke_skips_without_the_exact_opt_in_flag(self) -> None:
        smoke = importlib.import_module("services.vision.integration_smoke")
        calls: list[str] = []

        result = smoke.run_smoke({"TINY_SOHO_RUN_VISION_INTEGRATION": "true"}, lambda url: calls.append(url) or {})

        self.assertEqual(result["status"], "skipped")
        self.assertEqual(calls, [])

    def test_smoke_records_health_without_requesting_model_inference(self) -> None:
        smoke = importlib.import_module("services.vision.integration_smoke")
        calls: list[str] = []

        result = smoke.run_smoke(
            {"TINY_SOHO_RUN_VISION_INTEGRATION": "1", "TINY_SOHO_VISION_SMOKE_URL": "http://127.0.0.1:8765"},
            lambda url: calls.append(url) or {"service": "tiny-soho-vision", "hardware": {"cpu": {"architecture": "arm64"}}},
        )

        self.assertEqual(result["status"], "checked")
        self.assertEqual(result["service"], "tiny-soho-vision")
        self.assertEqual(calls, ["http://127.0.0.1:8765/health"])
