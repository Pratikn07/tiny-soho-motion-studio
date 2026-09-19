from __future__ import annotations

import importlib
import sys
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))


def load_module(module_name: str):
    try:
        return importlib.import_module(module_name)
    except ModuleNotFoundError as error:
        raise AssertionError(f"Expected {module_name} to provide local composition support.") from error


class CompositionTests(unittest.TestCase):
    def test_builds_argument_array_with_fixed_overlay_and_optional_source_audio(self) -> None:
        composition = load_module("services.vision.composition")

        command = composition.build_overlay_command(Path("/owned/input.mp4"), Path("/owned/overlay.png"), Path("/owned/output.mp4"), ffmpeg_path="/usr/local/bin/ffmpeg")

        self.assertIsInstance(command, list)
        self.assertEqual(command[0], "/usr/local/bin/ffmpeg")
        self.assertTrue(any("overlay=0:0:format=auto:shortest=1" in argument for argument in command))
        self.assertIn("0:a?", command)
        self.assertNotIn("shell", " ".join(command).lower())
        self.assertIn("-shortest", command)

    def test_rejects_dimension_mismatch_before_attempting_ffmpeg(self) -> None:
        composition = load_module("services.vision.composition")

        with self.assertRaises(composition.CompositionValidationError):
            composition.validate_overlay_dimensions(video_width=1080, video_height=1440, overlay_width=1080, overlay_height=1350)
