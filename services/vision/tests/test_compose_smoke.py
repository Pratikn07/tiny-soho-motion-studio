from __future__ import annotations

import importlib
import sys
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))


class ComposeSmokeTests(unittest.TestCase):
    def test_compose_smoke_requires_an_exact_explicit_opt_in(self) -> None:
        smoke = importlib.import_module("services.vision.compose_smoke")

        result = smoke.run_smoke({"TINY_SOHO_RUN_COMPOSE_SMOKE": "true"})

        self.assertEqual(result["status"], "skipped")
        self.assertIn("TINY_SOHO_RUN_COMPOSE_SMOKE=1", result["reason"])
