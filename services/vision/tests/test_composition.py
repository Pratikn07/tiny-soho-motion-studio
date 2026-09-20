from __future__ import annotations

import importlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


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

    def test_adopts_composed_video_without_reading_the_output_into_memory(self) -> None:
        artifacts = load_module("services.vision.artifacts.manager")
        composition = load_module("services.vision.composition")
        with tempfile.TemporaryDirectory() as directory:
            manager = artifacts.ArtifactManager(
                Path(directory),
                ttl_seconds=60,
                max_upload_bytes=64,
                max_image_artifact_bytes=1024,
                max_video_artifact_bytes=1024,
            )
            source_path = manager.create_temp_output_path(suffix=".mp4")
            source_path.write_bytes(b"raw-video")
            source = manager.adopt_file(kind="raw-video", mime_type="video/mp4", source_path=source_path)
            overlay = manager.write_bytes(
                kind="typography-overlay",
                mime_type="image/png",
                data=(b"\x89PNG\r\n\x1a\n" + b"overlay"),
            )

            def fake_run(command, **_kwargs):
                Path(command[-1]).write_bytes(b"composed-video")

            def output_must_not_be_read(_artifact_id: str):
                raise AssertionError("Composition must adopt its FFmpeg output rather than read it into memory.")

            manager.read_bytes = output_must_not_be_read
            with patch.object(composition, "image_dimensions", return_value=(64, 64)), patch.object(composition, "video_dimensions", return_value=(64, 64)), patch.object(composition.subprocess, "run", side_effect=fake_run):
                result = composition.compose_typography_artifacts(
                    manager,
                    source.id,
                    overlay.id,
                    ffmpeg_path="ffmpeg",
                    ffprobe_path="ffprobe",
                )

            self.assertEqual(manager.metadata(result.artifactId).sizeBytes, len(b"composed-video"))
