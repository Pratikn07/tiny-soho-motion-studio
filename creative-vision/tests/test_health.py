from __future__ import annotations

import sys
import unittest
from pathlib import Path

from fastapi.testclient import TestClient


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CREATIVE_VISION_ROOT = REPOSITORY_ROOT / "creative-vision"
for path in (REPOSITORY_ROOT, CREATIVE_VISION_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from src.main import app  # noqa: E402


class VisionHealthTests(unittest.TestCase):
    def test_health_is_public_but_does_not_accept_media(self) -> None:
        response = TestClient(app).get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["service"], "tiny-soho-creative-vision")
        self.assertNotIn("DASHSCOPE_API_KEY", response.text)

