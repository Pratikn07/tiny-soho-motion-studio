from __future__ import annotations

import base64
import importlib
import sys
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="
)


def load_module(module_name: str):
    try:
        return importlib.import_module(module_name)
    except ModuleNotFoundError as error:
        raise AssertionError(f"Expected {module_name} to provide the artifact contract.") from error


class ArtifactManagerTests(unittest.TestCase):
    def test_writes_an_opaque_artifact_and_returns_only_metadata(self) -> None:
        manager_module = load_module("services.vision.artifacts.manager")
        with tempfile.TemporaryDirectory() as directory:
            manager = manager_module.ArtifactManager(Path(directory), ttl_seconds=60, max_bytes=1024)

            metadata = manager.write_bytes(kind="mask", mime_type="image/png", data=ONE_PIXEL_PNG)

            self.assertRegex(metadata.id, r"^[0-9a-f]{8}-[0-9a-f-]{27}$")
            self.assertEqual(metadata.kind, "mask")
            self.assertEqual(metadata.mimeType, "image/png")
            self.assertEqual(metadata.sizeBytes, len(ONE_PIXEL_PNG))
            self.assertFalse(Path(metadata.id).is_absolute())
            self.assertEqual(manager.read_bytes(metadata.id), ONE_PIXEL_PNG)

    def test_rejects_path_like_identifiers_and_oversized_artifacts(self) -> None:
        manager_module = load_module("services.vision.artifacts.manager")
        with tempfile.TemporaryDirectory() as directory:
            manager = manager_module.ArtifactManager(Path(directory), ttl_seconds=60, max_bytes=3)

            with self.assertRaises(manager_module.ArtifactNotFound):
                manager.read_bytes("../../etc/passwd")
            with self.assertRaises(manager_module.ArtifactTooLarge):
                manager.write_bytes(kind="mask", mime_type="image/png", data=b"four")

    def test_expires_artifacts_without_scanning_user_paths(self) -> None:
        manager_module = load_module("services.vision.artifacts.manager")
        with tempfile.TemporaryDirectory() as directory:
            manager = manager_module.ArtifactManager(Path(directory), ttl_seconds=1, max_bytes=1024)
            metadata = manager.write_bytes(kind="mask", mime_type="image/png", data=ONE_PIXEL_PNG)

            removed = manager.cleanup_expired(now=metadata.expiresAt + timedelta(seconds=1))

            self.assertEqual(removed, [metadata.id])
            with self.assertRaises(manager_module.ArtifactNotFound):
                manager.read_bytes(metadata.id)


class ImageInputTests(unittest.TestCase):
    def test_decodes_a_supported_image_and_reports_dimensions(self) -> None:
        image_module = load_module("services.vision.image_input")

        decoded = image_module.decode_image(ONE_PIXEL_PNG, "image/png", max_bytes=1024, max_pixels=16)

        self.assertEqual((decoded.width, decoded.height, decoded.mimeType), (1, 1, "image/png"))

    def test_rejects_unknown_mime_empty_or_malformed_image_bytes(self) -> None:
        image_module = load_module("services.vision.image_input")

        for data, mime_type in [(ONE_PIXEL_PNG, "application/octet-stream"), (b"", "image/png"), (b"not an image", "image/png")]:
            with self.assertRaises(image_module.ImageInputError):
                image_module.decode_image(data, mime_type, max_bytes=1024, max_pixels=16)
