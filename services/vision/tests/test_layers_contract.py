from __future__ import annotations

import asyncio
import importlib
import sys
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
        raise AssertionError(f"Expected {module_name} to provide the layered image contract.") from error


def image_bytes() -> bytes:
    image = Image.new("RGB", (100, 80), "#336699")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class LayersContractTests(unittest.TestCase):
    def test_fake_backend_returns_ordered_rgba_layers_that_recompose_to_the_source(self) -> None:
        adapter_module = load_module("services.vision.adapters.qwen_layers")
        image_module = load_module("services.vision.image_input")
        layers_module = load_module("services.vision.layers")
        decoded = image_module.decode_image(image_bytes(), "image/png", max_bytes=4096, max_pixels=10_000)

        schema_module = load_module("services.vision.schemas.layers")
        options = schema_module.LayerOptions(prompt="separate the product", requestedLayerCount=4, seed=17)
        layers = asyncio.run(adapter_module.FakeQwenLayersBackend().decompose(decoded, options))
        diagnostics = layers_module.recomposition_diagnostics(decoded, layers)

        self.assertEqual(len(layers), 4)
        self.assertEqual([layer.zIndex for layer in layers], [0, 1, 2, 3])
        self.assertGreater(layers[0].alphaCoverage, 0)
        self.assertGreater(layers[1].alphaCoverage, 0)
        self.assertLess(layers[1].alphaCoverage, 1)
        with Image.open(BytesIO(layers[1].png)) as foreground:
            self.assertEqual(foreground.mode, "RGBA")
            self.assertEqual(foreground.size, (100, 80))
        self.assertTrue(diagnostics.recompositionMatchesInput)
        self.assertEqual([classification.inferredRole for classification in diagnostics.classifications], ["unknown"] * 4)

    def test_fake_layer_overlap_is_explicitly_non_authoritative(self) -> None:
        layers_module = load_module("services.vision.layers")

        overlap = layers_module.classify_evidence_overlap([], [])

        self.assertEqual(overlap.classification, "not-evaluated")
        self.assertTrue(overlap.nonAuthoritative)

    def test_alpha_evidence_classification_is_heuristic_not_layer_order_semantics(self) -> None:
        layers_module = load_module("services.vision.layers")
        schema_module = load_module("services.vision.schemas.layers")
        png = BytesIO()
        Image.new("RGBA", (10, 10), (255, 255, 255, 255)).save(png, format="PNG")
        layer = schema_module.LayerPrediction(id="layer-1", png=png.getvalue(), zIndex=0, alphaCoverage=1)
        text_mask = Image.new("L", (10, 10), 255)

        classification = layers_module.classify_layers([layer], typography_mask=text_mask)[0]

        self.assertEqual(classification.inferredRole, "text-like")
        self.assertEqual(classification.textOverlap, 1)
        self.assertTrue(classification.nonAuthoritative)
