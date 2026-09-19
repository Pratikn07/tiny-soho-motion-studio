from __future__ import annotations

import unittest
from pathlib import Path

from PIL import Image


FIXTURE_DIRECTORY = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "vision"
FIXTURE_NAMES = ["parenting-carousel.png", "food-carousel.png", "difficult-overlap.png"]


class VisionFixtureTests(unittest.TestCase):
    def test_fixture_set_is_small_synthetic_png_content(self) -> None:
        for name in FIXTURE_NAMES:
            with Image.open(FIXTURE_DIRECTORY / name) as image:
                self.assertEqual(image.format, "PNG")
                self.assertLessEqual(image.width * image.height, 640 * 640)
                self.assertGreater(image.width, 1)
                self.assertGreater(image.height, 1)
