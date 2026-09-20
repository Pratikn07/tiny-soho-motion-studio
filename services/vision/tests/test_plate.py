from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))


def png_bytes(image: Image.Image) -> bytes:
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def region():
    from services.vision.schemas.ocr import OcrRegion

    return OcrRegion.model_validate(
        {
            "id": "headline",
            "text": "Original headline",
            "detectionConfidence": 0.99,
            "recognitionConfidence": 0.99,
            "polygon": [{"x": 0.3, "y": 0.35}, {"x": 0.7, "y": 0.35}, {"x": 0.7, "y": 0.55}, {"x": 0.3, "y": 0.55}],
            "boundingBox": {"x": 0.3, "y": 0.35, "width": 0.4, "height": 0.2},
        }
    )


class GenerationPlateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        from services.vision.artifacts.manager import ArtifactManager

        self.manager = ArtifactManager(
            Path(self.temporary_directory.name),
            ttl_seconds=3600,
            max_upload_bytes=1024 * 1024,
            max_image_artifact_bytes=1024 * 1024,
            max_video_artifact_bytes=1024 * 1024,
        )
        self.region = region()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_original_plate_reuses_the_source_and_requires_a_covering_trusted_overlay(self) -> None:
        from services.vision.overlay import create_overlay_artifact
        from services.vision.plate import GenerationPlateBuildRequest, build_generation_plate

        source = self.manager.write_bytes(kind="source-image", mime_type="image/png", data=png_bytes(self._source_image()))
        overlay = create_overlay_artifact(self.manager, source.id, [self.region], max_pixels=10_000)
        result = asyncio.run(
            build_generation_plate(
                self.manager,
                GenerationPlateBuildRequest(
                    sourceArtifactId=source.id,
                    typographyOverlayArtifactId=overlay.artifactId,
                    regions=[self.region],
                    mode="original-with-protected-text",
                ),
                max_pixels=10_000,
            )
        )

        self.assertEqual(result.artifactId, source.id)
        self.assertEqual(result.mode, "original-with-protected-text")
        self.assertFalse(result.textRemoved)
        self.assertEqual(result.provenance["source"]["sha256"], result.provenance["plate"]["sha256"])

    def test_layers_plate_excludes_text_like_layers_and_verifies_with_a_second_ocr_pass(self) -> None:
        from services.vision.overlay import create_overlay_artifact
        from services.vision.plate import GenerationPlateBuildRequest, build_generation_plate
        from services.vision.schemas.ocr import OcrEngine, OcrImage, OcrResult

        background, text_layer, source_image = self._layered_source()
        source = self.manager.write_bytes(kind="source-image", mime_type="image/png", data=png_bytes(source_image))
        overlay = create_overlay_artifact(self.manager, source.id, [self.region], max_pixels=10_000)
        layer_ids = [
            self.manager.write_bytes(kind="rgba-layer", mime_type="image/png", data=png_bytes(layer)).id
            for layer in (background, text_layer)
        ]

        async def no_text(image):
            return OcrResult(image=OcrImage(width=image.width, height=image.height), regions=[], engine=OcrEngine(provider="PaddleOCR", model="test", version="test"))

        result = asyncio.run(
            build_generation_plate(
                self.manager,
                GenerationPlateBuildRequest(
                    sourceArtifactId=source.id,
                    typographyOverlayArtifactId=overlay.artifactId,
                    regions=[self.region],
                    mode="layers-text-removed",
                    layerArtifactIds=layer_ids,
                ),
                max_pixels=10_000,
                second_pass_recognizer=no_text,
            )
        )

        self.assertEqual(result.mode, "layers-text-removed")
        self.assertTrue(result.textRemoved)
        self.assertNotEqual(result.artifactId, source.id)
        with Image.open(BytesIO(self.manager.read_bytes(result.artifactId))) as plate:
            self.assertEqual(plate.convert("RGBA").getpixel((50, 36)), (28, 66, 120, 255))

    def test_remaining_text_from_second_pass_downgrades_to_the_original_protected_plate(self) -> None:
        from services.vision.overlay import create_overlay_artifact
        from services.vision.plate import GenerationPlateBuildRequest, build_generation_plate
        from services.vision.schemas.ocr import OcrEngine, OcrImage, OcrResult

        background, text_layer, source_image = self._layered_source()
        source = self.manager.write_bytes(kind="source-image", mime_type="image/png", data=png_bytes(source_image))
        overlay = create_overlay_artifact(self.manager, source.id, [self.region], max_pixels=10_000)
        layer_ids = [
            self.manager.write_bytes(kind="rgba-layer", mime_type="image/png", data=png_bytes(layer)).id
            for layer in (background, text_layer)
        ]

        async def still_text(image):
            return OcrResult(image=OcrImage(width=image.width, height=image.height), regions=[self.region], engine=OcrEngine(provider="PaddleOCR", model="test", version="test"))

        result = asyncio.run(
            build_generation_plate(
                self.manager,
                GenerationPlateBuildRequest(
                    sourceArtifactId=source.id,
                    typographyOverlayArtifactId=overlay.artifactId,
                    regions=[self.region],
                    mode="layers-text-removed",
                    layerArtifactIds=layer_ids,
                ),
                max_pixels=10_000,
                second_pass_recognizer=still_text,
            )
        )

        self.assertEqual(result.artifactId, source.id)
        self.assertFalse(result.textRemoved)
        self.assertEqual(result.mode, "original-with-protected-text")
        self.assertTrue(any("remaining typography" in warning for warning in result.warnings))

    def test_rejects_an_overlay_that_does_not_cover_all_protected_source_pixels(self) -> None:
        from services.vision.adapters.base import VisionCapabilityUnavailable
        from services.vision.plate import GenerationPlateBuildRequest, build_generation_plate

        source = self.manager.write_bytes(kind="source-image", mime_type="image/png", data=png_bytes(self._source_image()))
        empty_overlay = self.manager.write_bytes(kind="typography-overlay", mime_type="image/png", data=png_bytes(Image.new("RGBA", (100, 80), (0, 0, 0, 0))))
        with self.assertRaisesRegex(VisionCapabilityUnavailable, "does not cover"):
            asyncio.run(
                build_generation_plate(
                    self.manager,
                    GenerationPlateBuildRequest(
                        sourceArtifactId=source.id,
                        typographyOverlayArtifactId=empty_overlay.id,
                        regions=[self.region],
                        mode="original-with-protected-text",
                    ),
                    max_pixels=10_000,
                )
            )

    def test_rejects_an_overlay_with_covered_but_altered_source_pixels(self) -> None:
        from services.vision.adapters.base import VisionCapabilityUnavailable
        from services.vision.overlay import create_overlay_artifact
        from services.vision.plate import GenerationPlateBuildRequest, build_generation_plate

        source = self.manager.write_bytes(kind="source-image", mime_type="image/png", data=png_bytes(self._source_image()))
        trusted_overlay = create_overlay_artifact(self.manager, source.id, [self.region], max_pixels=10_000)
        with Image.open(BytesIO(self.manager.read_bytes(trusted_overlay.artifactId))) as image:
            altered = image.convert("RGBA")
        altered.putpixel((50, 36), (255, 0, 0, 255))
        altered_overlay = self.manager.write_bytes(kind="typography-overlay", mime_type="image/png", data=png_bytes(altered))

        with self.assertRaisesRegex(VisionCapabilityUnavailable, "exactly preserve"):
            asyncio.run(
                build_generation_plate(
                    self.manager,
                    GenerationPlateBuildRequest(
                        sourceArtifactId=source.id,
                        typographyOverlayArtifactId=altered_overlay.id,
                        regions=[self.region],
                        mode="original-with-protected-text",
                    ),
                    max_pixels=10_000,
                )
            )

    def _source_image(self) -> Image.Image:
        image = Image.new("RGBA", (100, 80), (28, 66, 120, 255))
        ImageDraw.Draw(image).rectangle((30, 28, 70, 44), fill=(242, 230, 190, 255))
        return image

    def _layered_source(self) -> tuple[Image.Image, Image.Image, Image.Image]:
        background = Image.new("RGBA", (100, 80), (28, 66, 120, 255))
        text = Image.new("RGBA", (100, 80), (0, 0, 0, 0))
        ImageDraw.Draw(text).rectangle((30, 28, 70, 44), fill=(242, 230, 190, 255))
        source = Image.alpha_composite(background, text)
        return background, text, source
