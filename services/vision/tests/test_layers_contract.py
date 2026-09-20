from __future__ import annotations

import asyncio
import base64
import importlib
import os
import sys
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

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
    def test_qwen_configuration_supports_explicit_local_cuda_or_https_remote_backends(self) -> None:
        config_module = load_module("services.vision.config")
        with patch.dict(
            os.environ,
            {
                "TINY_SOHO_QWEN_LAYERS_ENABLED": "1",
                "TINY_SOHO_QWEN_LAYERS_BACKEND": "remote-https",
                "TINY_SOHO_QWEN_LAYERS_REMOTE_URL": "https://layers.example.test/v1/decompose",
                "TINY_SOHO_QWEN_LAYERS_REMOTE_TOKEN": "test-only-token",
                "TINY_SOHO_QWEN_LAYERS_REMOTE_ALLOWED_HOSTS": "layers.example.test",
                "TINY_SOHO_QWEN_LAYERS_TIMEOUT_SECONDS": "60",
            },
            clear=False,
        ):
            config = config_module.VisionConfig.from_env()

        self.assertTrue(config.qwen_layers.enabled)
        self.assertEqual(config.qwen_layers.backend, "remote-https")
        self.assertEqual(config.qwen_layers.remote_url, "https://layers.example.test/v1/decompose")
        self.assertEqual(config.qwen_layers.timeout_seconds, 60)

    def test_local_cuda_backend_uses_an_injected_pipeline_and_validates_rgba_source_canvas_layers(self) -> None:
        adapter_module = load_module("services.vision.adapters.qwen_layers")
        config_module = load_module("services.vision.config")
        image_module = load_module("services.vision.image_input")
        schema_module = load_module("services.vision.schemas.layers")

        class FakePipeline:
            def decompose(self, image, options):
                # Qwen's 640/1024 bucket can differ from the original canvas.
                return [Image.new("RGBA", (50, 40), (51, 102, 153, 255)) for _ in range(options.requestedLayerCount)]

        with tempfile.TemporaryDirectory() as temporary_directory:
            settings = config_module.QwenLayersSettings(
                enabled=True,
                backend="local-cuda",
                model_path=Path(temporary_directory),
                remote_url=None,
                remote_token=None,
                remote_allowed_hosts=(),
                timeout_seconds=60,
                min_free_vram_bytes=1,
            )
            backend = adapter_module.QwenLocalCudaBackend(
                settings,
                engine_factory=lambda _: (FakePipeline(), "pinned-test", "cuda"),
            )
            image = image_module.decode_image(image_bytes(), "image/png", max_bytes=4096, max_pixels=10_000)
            layers = asyncio.run(backend.decompose(image, schema_module.LayerOptions(requestedLayerCount=4, seed=7)))

        self.assertEqual(len(layers), 4)
        self.assertEqual(backend.backend.provider, "QwenImageLayeredPipeline")
        self.assertEqual(backend.backend.device, "cuda")
        with Image.open(BytesIO(layers[0].png)) as layer:
            self.assertEqual(layer.mode, "RGBA")
            self.assertEqual(layer.size, (100, 80))

    def test_remote_backend_accepts_only_https_and_validated_base64_rgba_layers(self) -> None:
        adapter_module = load_module("services.vision.adapters.qwen_layers")
        config_module = load_module("services.vision.config")
        image_module = load_module("services.vision.image_input")
        schema_module = load_module("services.vision.schemas.layers")
        png = BytesIO()
        Image.new("RGBA", (100, 80), (51, 102, 153, 255)).save(png, format="PNG")
        payload = base64.b64encode(png.getvalue()).decode("ascii")
        received = {}

        def request_handler(url, token, request):
            received.update({"url": url, "token": token, "request": request})
            return {"version": "remote-test", "layers": [{"pngBase64": payload, "zIndex": index} for index in range(4)]}

        settings = config_module.QwenLayersSettings(
            enabled=True,
            backend="remote-https",
            model_path=None,
            remote_url="https://layers.example.test/v1/decompose",
            remote_token="server-only-token",
            remote_allowed_hosts=("layers.example.test",),
            timeout_seconds=60,
            min_free_vram_bytes=1,
        )
        backend = adapter_module.QwenRemoteHttpsBackend(settings, request_handler=request_handler)
        image = image_module.decode_image(image_bytes(), "image/png", max_bytes=4096, max_pixels=10_000)
        layers = asyncio.run(backend.decompose(image, schema_module.LayerOptions(requestedLayerCount=4, seed=7)))

        self.assertEqual(len(layers), 4)
        self.assertEqual(received["url"], "https://layers.example.test/v1/decompose")
        self.assertEqual(received["token"], "server-only-token")
        self.assertEqual(received["request"]["requestedLayerCount"], 4)
        self.assertEqual(backend.backend.provider, "QwenRemoteHttpsBackend")

    def test_remote_backend_rejects_a_host_outside_the_server_allowlist(self) -> None:
        adapter_module = load_module("services.vision.adapters.qwen_layers")
        config_module = load_module("services.vision.config")
        image_module = load_module("services.vision.image_input")
        schema_module = load_module("services.vision.schemas.layers")
        base_module = load_module("services.vision.adapters.base")
        settings = config_module.QwenLayersSettings(
            enabled=True,
            backend="remote-https",
            model_path=None,
            remote_url="https://unapproved.example.test/v1/decompose",
            remote_token="server-only-token",
            remote_allowed_hosts=("approved.example.test",),
            timeout_seconds=60,
            min_free_vram_bytes=1,
        )
        backend = adapter_module.QwenRemoteHttpsBackend(settings, request_handler=lambda *_: {})
        image = image_module.decode_image(image_bytes(), "image/png", max_bytes=4096, max_pixels=10_000)

        with self.assertRaisesRegex(base_module.VisionCapabilityUnavailable, "allowlisted"):
            asyncio.run(backend.decompose(image, schema_module.LayerOptions(requestedLayerCount=4)))

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
        self.assertEqual(diagnostics.meanAbsoluteError, 0)
        self.assertEqual(diagnostics.warningThreshold, 0.02)
        self.assertFalse(diagnostics.warning)
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
