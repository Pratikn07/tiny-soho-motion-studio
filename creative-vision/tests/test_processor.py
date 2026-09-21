from __future__ import annotations

import sys
import unittest
from io import BytesIO
from pathlib import Path

from PIL import Image


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CREATIVE_VISION_ROOT = REPOSITORY_ROOT / "creative-vision"
for path in (REPOSITORY_ROOT, CREATIVE_VISION_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from src.processor import VisionJob, VisionProcessor, process_vision_job  # noqa: E402


OWNER = "11111111-1111-4111-8111-111111111111"
PROJECT = "22222222-2222-4222-8222-222222222222"
SOURCE = "33333333-3333-4333-8333-333333333333"
JOB = "44444444-4444-4444-8444-444444444444"
SOURCE_SIGNED_URL = "https://storage.example/signed/source.png"


def source_png() -> bytes:
    image = Image.new("RGB", (24, 18), "#224466")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class FakeStorage:
    def __init__(self) -> None:
        self.signed_urls: list[str] = []
        self.uploads: list[tuple[str, bytes, str]] = []

    def download_owned_source(self, owner_user_id: str, project_id: str, asset_id: str) -> tuple[bytes, str, str]:
        self.signed_urls.append(SOURCE_SIGNED_URL)
        assert (owner_user_id, project_id, asset_id) == (OWNER, PROJECT, SOURCE)
        return source_png(), "image/png", SOURCE_SIGNED_URL

    def upload_derived(self, object_path: str, data: bytes, mime_type: str, kind: str) -> str:
        self.uploads.append((object_path, data, mime_type))
        return "55555555-5555-4555-8555-555555555555"


class VisionProcessorTests(unittest.TestCase):
    def test_processor_writes_only_project_scoped_derived_assets(self) -> None:
        storage = FakeStorage()
        job = VisionJob(
            id=JOB,
            owner_user_id=OWNER,
            project_id=PROJECT,
            source_asset_id=SOURCE,
            operation="overlay",
            options={"regions": []},
            input_asset_ids=[],
        )

        result = process_vision_job(job, storage, VisionProcessor(ffmpeg_path="ffmpeg", ffprobe_path="ffprobe"))

        self.assertEqual(result.status, "completed")
        self.assertEqual(result.object_paths, [f"owners/{OWNER}/projects/{PROJECT}/vision/{JOB}/overlay.png"])
        self.assertEqual(storage.signed_urls, [SOURCE_SIGNED_URL])
        self.assertEqual(storage.uploads[0][2], "image/png")

    def test_unconfigured_ocr_records_needs_attention_without_importing_weights(self) -> None:
        storage = FakeStorage()
        job = VisionJob(
            id=JOB,
            owner_user_id=OWNER,
            project_id=PROJECT,
            source_asset_id=SOURCE,
            operation="ocr",
            options={},
            input_asset_ids=[],
        )

        result = process_vision_job(job, storage, VisionProcessor(ffmpeg_path="ffmpeg", ffprobe_path="ffprobe"))

        self.assertEqual(result.status, "needs_attention")
        self.assertIn("not configured", result.error_message or "")
