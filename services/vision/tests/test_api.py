from __future__ import annotations

import asyncio
import base64
import importlib
import json
import platform
import sys
import unittest
from pathlib import Path

import httpx


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
        raise AssertionError(f"Expected {module_name} to implement the vision sidecar contract.") from error


def get(app, path: str) -> httpx.Response:
    async def request() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get(path)

    return asyncio.run(request())


def post_image(app, path: str, data: bytes, mime_type: str) -> httpx.Response:
    async def request() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.post(path, files={"image": ("slide.png", data, mime_type)})

    return asyncio.run(request())


def post_json(app, path: str, payload: dict[str, object]) -> httpx.Response:
    async def request() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.post(path, json=payload)

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
        self.assertIn("local backend requires CUDA", payload["capabilities"][1]["hardwareRequirements"]["notes"])
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

    def test_artifact_endpoint_serves_only_an_opaque_artifact_id(self) -> None:
        app_module = load_module("services.vision.app")
        self.assertTrue(hasattr(app_module, "artifact_manager"), "Sidecar must expose its opaque artifact manager.")
        artifact_manager = getattr(app_module, "artifact_manager", None)
        if artifact_manager is None:
            return
        metadata = artifact_manager.write_bytes(kind="mask", mime_type="image/png", data=b"sidecar-artifact")

        response = get(app_module.app, f"/v1/artifacts/{metadata.id}")
        traversal_response = get(app_module.app, "/v1/artifacts/../../etc/passwd")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"sidecar-artifact")
        self.assertEqual(response.headers["content-type"], "image/png")
        self.assertEqual(traversal_response.status_code, 404)

    def test_ocr_endpoint_returns_normalized_regions_and_an_opaque_safety_mask(self) -> None:
        app_module = load_module("services.vision.app")
        ocr_module = load_module("services.vision.adapters.paddle_ocr")
        schema_module = load_module("services.vision.schemas.ocr")
        original_adapter = getattr(app_module, "ocr_adapter", None)
        app_module.ocr_adapter = ocr_module.FakeOcrAdapter([
            schema_module.OcrRegion(
                id="headline",
                text="Hello",
                detectionConfidence=0.99,
                recognitionConfidence=0.20,
                polygon=[{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}, {"x": 0, "y": 1}],
                boundingBox={"x": 0, "y": 0, "width": 1, "height": 1},
            )
        ])
        try:
            response = post_image(app_module.app, "/v1/ocr", ONE_PIXEL_PNG, "image/png")
        finally:
            app_module.ocr_adapter = original_adapter

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["regions"][0]["recognitionConfidence"], 0.20)
        self.assertRegex(payload["typographySafetyMaskArtifactId"], r"^[0-9a-f-]{36}$")

    def test_ocr_endpoint_rejects_an_undecodable_upload(self) -> None:
        app_module = load_module("services.vision.app")

        response = post_image(app_module.app, "/v1/ocr", b"not an image", "image/png")

        self.assertEqual(response.status_code, 400)

    def test_segment_endpoint_stores_only_an_opaque_mask_artifact(self) -> None:
        app_module = load_module("services.vision.app")
        adapter_module = load_module("services.vision.adapters.sam2")
        original_adapter = getattr(app_module, "segmentation_adapter", None)
        app_module.segmentation_adapter = adapter_module.FakeSegmentationAdapter()
        try:
            async def request() -> httpx.Response:
                transport = httpx.ASGITransport(app=app_module.app)
                async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                    return await client.post(
                        "/v1/segment",
                        files={"image": ("slide.png", ONE_PIXEL_PNG, "image/png")},
                        data={"prompts": '{"positivePoints":[{"x":0.5,"y":0.5}]}'},
                    )

            response = asyncio.run(request())
        finally:
            app_module.segmentation_adapter = original_adapter

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertNotIn("pixels", payload)
        self.assertRegex(payload["masks"][0]["artifactId"], r"^[0-9a-f-]{36}$")
        artifact = get(app_module.app, f"/v1/artifacts/{payload['masks'][0]['artifactId']}")
        self.assertEqual(artifact.status_code, 200)
        self.assertEqual(artifact.headers["content-type"], "image/png")

    def test_segment_endpoint_reports_an_unavailable_backend_without_implicit_download(self) -> None:
        app_module = load_module("services.vision.app")

        async def request() -> httpx.Response:
            transport = httpx.ASGITransport(app=app_module.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                return await client.post(
                    "/v1/segment",
                    files={"image": ("slide.png", ONE_PIXEL_PNG, "image/png")},
                    data={"prompts": '{"positivePoints":[{"x":0.5,"y":0.5}]}'},
                )

        response = asyncio.run(request())
        self.assertEqual(response.status_code, 503)

    def test_layers_endpoint_returns_only_opaque_rgba_artifacts_and_diagnostics(self) -> None:
        app_module = load_module("services.vision.app")
        adapter_module = load_module("services.vision.adapters.qwen_layers")
        original_backend = getattr(app_module, "layers_backend", None)
        app_module.layers_backend = adapter_module.FakeQwenLayersBackend()
        try:
            async def request() -> httpx.Response:
                transport = httpx.ASGITransport(app=app_module.app)
                async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                    return await client.post("/v1/layers", files={"image": ("slide.png", ONE_PIXEL_PNG, "image/png")}, data={"requestedLayerCount": "4", "seed": "17"})

            response = asyncio.run(request())
        finally:
            app_module.layers_backend = original_backend

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual([layer["zIndex"] for layer in payload["layers"]], [0, 1, 2, 3])
        self.assertEqual(payload["options"], {"prompt": None, "requestedLayerCount": 4, "seed": 17})
        self.assertNotIn("pixels", payload)
        self.assertTrue(payload["diagnostics"]["recompositionMatchesInput"])
        for layer in payload["layers"]:
            self.assertRegex(layer["artifactId"], r"^[0-9a-f-]{36}$")
            artifact = get(app_module.app, f"/v1/artifacts/{layer['artifactId']}")
            self.assertEqual(artifact.status_code, 200)
            self.assertEqual(artifact.headers["content-type"], "image/png")

    def test_layers_endpoint_reports_an_unavailable_backend_without_model_download(self) -> None:
        app_module = load_module("services.vision.app")

        response = post_image(app_module.app, "/v1/layers", ONE_PIXEL_PNG, "image/png")

        self.assertEqual(response.status_code, 503)

    def test_overlay_endpoint_returns_an_opaque_local_overlay_artifact(self) -> None:
        app_module = load_module("services.vision.app")

        async def request() -> httpx.Response:
            transport = httpx.ASGITransport(app=app_module.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                return await client.post(
                    "/v1/overlay",
                    files={"image": ("slide.png", ONE_PIXEL_PNG, "image/png")},
                    data={"regions": '[{"id":"copy","text":"copy","polygon":[{"x":0,"y":0},{"x":1,"y":0},{"x":1,"y":1}],"boundingBox":{"x":0,"y":0,"width":1,"height":1}}]'},
                )

        response = asyncio.run(request())

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertRegex(payload["artifactId"], r"^[0-9a-f-]{36}$")
        self.assertRegex(payload["sourceArtifactId"], r"^[0-9a-f-]{36}$")
        self.assertEqual(payload["width"], 1)
        self.assertEqual(payload["height"], 1)

    def test_plate_endpoint_reuses_only_owned_source_and_trusted_overlay_artifacts(self) -> None:
        app_module = load_module("services.vision.app")
        region = {
            "id": "copy",
            "text": "copy",
            "polygon": [{"x": 0, "y": 0}, {"x": 1, "y": 0}, {"x": 1, "y": 1}],
            "boundingBox": {"x": 0, "y": 0, "width": 1, "height": 1},
        }

        async def overlay_request() -> httpx.Response:
            transport = httpx.ASGITransport(app=app_module.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                return await client.post(
                    "/v1/overlay",
                    files={"image": ("slide.png", ONE_PIXEL_PNG, "image/png")},
                    data={"regions": json.dumps([region])},
                )

        overlay_response = asyncio.run(overlay_request())
        self.assertEqual(overlay_response.status_code, 200)
        overlay = overlay_response.json()
        response = post_json(app_module.app, "/v1/plates", {
            "sourceArtifactId": overlay["sourceArtifactId"],
            "typographyOverlayArtifactId": overlay["artifactId"],
            "regions": [region],
            "mode": "original-with-protected-text",
        })

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["artifactId"], overlay["sourceArtifactId"])
        self.assertEqual(payload["mode"], "original-with-protected-text")
        self.assertFalse(payload["textRemoved"])
        self.assertRegex(payload["artifactId"], r"^[0-9a-f-]{36}$")


if __name__ == "__main__":
    unittest.main()
