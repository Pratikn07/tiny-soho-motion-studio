from __future__ import annotations

import importlib
import sys
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

from PIL import Image


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))


def load_module(module_name: str):
    try:
        return importlib.import_module(module_name)
    except ModuleNotFoundError as error:
        raise AssertionError(f"Expected {module_name} to provide typography overlay support.") from error


def source_png() -> bytes:
    image = Image.new("RGBA", (100, 80), "#224466")
    image.putpixel((50, 40), (255, 128, 0, 255))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class TrustedOverlayTests(unittest.TestCase):
    def test_overlay_keeps_original_pixels_only_inside_protected_regions(self) -> None:
        image_module = load_module("services.vision.image_input")
        overlay_module = load_module("services.vision.overlay")
        schema_module = load_module("services.vision.schemas.ocr")
        source = image_module.decode_image(source_png(), "image/png", max_bytes=4096, max_pixels=10_000)
        region = schema_module.OcrRegion(
            id="headline",
            text="headline",
            polygon=[{"x": 0.4, "y": 0.4}, {"x": 0.6, "y": 0.4}, {"x": 0.6, "y": 0.6}, {"x": 0.4, "y": 0.6}],
            boundingBox={"x": 0.4, "y": 0.4, "width": 0.2, "height": 0.2},
        )

        overlay = overlay_module.create_typography_overlay(source, [region])

        with Image.open(BytesIO(overlay.png)) as image:
            self.assertEqual(image.mode, "RGBA")
            self.assertEqual(image.size, (100, 80))
            self.assertEqual(image.getpixel((50, 40)), (255, 128, 0, 255))
            self.assertEqual(image.getpixel((5, 5))[3], 0)
            self.assertGreater(image.getpixel((38, 40))[3], 0)
        self.assertEqual(overlay.paddingPixels, 2)

    def test_overlay_artifact_uses_an_owned_source_artifact_id_not_a_browser_path(self) -> None:
        artifacts_module = load_module("services.vision.artifacts.manager")
        overlay_module = load_module("services.vision.overlay")
        schema_module = load_module("services.vision.schemas.ocr")
        with tempfile.TemporaryDirectory() as directory:
            manager = artifacts_module.ArtifactManager(Path(directory), ttl_seconds=60, max_bytes=4096)
            source = manager.write_bytes(kind="source-image", mime_type="image/png", data=source_png())
            region = schema_module.OcrRegion(
                id="headline", text="headline",
                polygon=[{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}],
                boundingBox={"x": 0, "y": 0, "width": 1, "height": 1},
            )

            overlay = overlay_module.create_overlay_artifact(manager, source.id, [region], max_pixels=10_000)

            self.assertRegex(overlay.artifactId, r"^[0-9a-f-]{36}$")
            self.assertNotEqual(overlay.artifactId, source.id)
            self.assertEqual(overlay.sourceArtifactId, source.id)
            self.assertEqual(overlay.mode, "original-region-patch")
            self.assertEqual(manager.metadata(overlay.artifactId).kind, "typography-overlay")
