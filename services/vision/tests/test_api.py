from __future__ import annotations

import asyncio
import importlib
import platform
import sys
import unittest
from pathlib import Path

import httpx


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))


def load_module(module_name: str):
    try:
        return importlib.import_module(module_name)
    except ModuleNotFoundError as error:
        raise AssertionError(f"Expected {module_name} to implement the vision sidecar contract.") from error


def get(app, path: str) -> httpx.Response:
    async def request() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get(path)

    return asyncio.run(request())


class TorchWithMpsOnly:
    class backends:
        class mps:
            @staticmethod
            def is_available() -> bool:
                return True

    class cuda:
        @staticmethod
        def is_available() -> bool:
            return False

        @staticmethod
        def device_count() -> int:
            return 0


class VisionSidecarContractTests(unittest.TestCase):
    def test_health_reports_loopback_binding_and_cpu_mps_cuda_preflight(self) -> None:
        app_module = load_module("services.vision.app")
        response = get(app_module.app, "/health")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["service"], "tiny-soho-vision")
        self.assertEqual(payload["bind"]["host"], "127.0.0.1")
        self.assertTrue(payload["hardware"]["cpu"]["available"])
        self.assertIn("mps", payload["hardware"])
        self.assertIn("cuda", payload["hardware"])

    def test_capabilities_exposes_the_shared_registry_without_enabling_inference(self) -> None:
        app_module = load_module("services.vision.app")
        response = get(app_module.app, "/v1/capabilities")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            [capability["id"] for capability in payload["capabilities"]],
            [
                "image.ocr",
                "image.layers",
                "image.segment",
                "image.inpaint",
                "video.compose.typography",
            ],
        )
        self.assertEqual(payload["capabilities"][0]["status"], "planned")
        self.assertEqual(payload["capabilities"][3]["status"], "unavailable")
        self.assertIn("No model runtime", payload["capabilities"][1]["hardwareRequirements"]["notes"])
        runtime_status = payload["capabilities"][0].get("runtimeStatus", {})
        self.assertEqual(runtime_status.get("state"), "unloaded")
        self.assertFalse(runtime_status.get("available"))
        self.assertIn("not configured", runtime_status.get("reason", ""))

    def test_hardware_preflight_uses_real_cpu_facts_and_never_requires_torch(self) -> None:
        hardware_module = load_module("services.vision.hardware")
        result = hardware_module.detect_hardware(torch_module=TorchWithMpsOnly())

        self.assertEqual(result["cpu"]["available"], True)
        self.assertEqual(result["cpu"]["architecture"], platform.machine())
        self.assertEqual(result["mps"], {"available": True, "reason": None})
        self.assertEqual(
            result["cuda"],
            {"available": False, "deviceCount": 0, "reason": "CUDA is not available."},
        )


if __name__ == "__main__":
    unittest.main()
