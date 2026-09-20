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
        raise AssertionError(f"Expected {module_name} to provide the runtime contract.") from error


class VisionRuntimeTests(unittest.TestCase):
    def test_unconfigured_optional_adapter_is_not_reported_ready(self) -> None:
        registry_module = load_module("services.vision.runtime.registry")
        registry = registry_module.RuntimeRegistry.default()

        status = registry.status("image.ocr")

        self.assertEqual(status.capabilityId, "image.ocr")
        self.assertEqual(status.state, "unloaded")
        self.assertFalse(status.available)
        self.assertIn("not configured", status.reason)

    def test_runtime_transition_preserves_the_backend_and_failure_reason(self) -> None:
        registry_module = load_module("services.vision.runtime.registry")
        registry = registry_module.RuntimeRegistry()
        registry.register("image.layers", backend="QwenLocalCudaBackend", available=False, reason="GPU setup required.")

        registry.transition("image.layers", state="error", reason="CUDA smoke test failed.")

        status = registry.status("image.layers")
        self.assertEqual(status.backend, "QwenLocalCudaBackend")
        self.assertEqual(status.state, "error")
        self.assertFalse(status.available)
        self.assertEqual(status.reason, "CUDA smoke test failed.")

    def test_runtime_ready_transition_can_clear_an_unavailable_reason(self) -> None:
        registry_module = load_module("services.vision.runtime.registry")
        registry = registry_module.RuntimeRegistry.default()

        registry.transition("image.ocr", state="ready", reason=None)

        status = registry.status("image.ocr")
        self.assertTrue(status.available)
        self.assertIsNone(status.reason)
