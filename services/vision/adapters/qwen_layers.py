from __future__ import annotations

import asyncio
import base64
import binascii
import importlib.metadata
import importlib.util
import json
from collections.abc import Awaitable, Callable, Mapping, Sequence
from io import BytesIO
from typing import Any
from urllib.parse import urlparse

import httpx
from PIL import Image, ImageDraw

from .base import VisionCapabilityUnavailable
from ..config import QwenLayersSettings
from ..image_input import DecodedImage
from ..layers import alpha_coverage, decoded_rgba, encode_rgba
from ..schemas.layers import LayerBackend, LayerOptions, LayerPrediction


MODEL_ID = "Qwen/Qwen-Image-Layered"
SOURCE_COMMIT = "54c4fe47e76d745775e03fc66ee38457280ed9ea"
MAX_REMOTE_LAYER_BYTES = 16 * 1024 * 1024
MAX_REMOTE_RESPONSE_BYTES = 192 * 1024 * 1024
MAX_REMOTE_LAYER_PIXELS = 4 * 1024 * 1024
MAX_REMOTE_TOTAL_PIXELS = MAX_REMOTE_LAYER_PIXELS * 8
MAX_NORMALIZED_OUTPUT_PIXELS = MAX_REMOTE_TOTAL_PIXELS


class FakeQwenLayersBackend:
    """Deterministic test adapter; it is not Qwen inference."""

    backend = LayerBackend(provider="FakeQwenLayersBackend", model="deterministic-rgba", version="1")

    async def decompose(self, image: DecodedImage, options: LayerOptions = LayerOptions()) -> list[LayerPrediction]:
        source = decoded_rgba(image)
        columns = options.requestedLayerCount // 2
        predictions = []
        for index in range(options.requestedLayerCount):
            column, row = index % columns, index // columns
            left, right = (column * source.width) // columns, ((column + 1) * source.width) // columns
            top, bottom = (row * source.height) // 2, ((row + 1) * source.height) // 2
            alpha = Image.new("L", source.size, 0)
            if right > left and bottom > top:
                ImageDraw.Draw(alpha).rectangle((left, top, right - 1, bottom - 1), fill=255)
            layer = source.copy()
            layer.putalpha(alpha)
            predictions.append(LayerPrediction(id=f"layer-{index + 1}", png=encode_rgba(layer), zIndex=index, alphaCoverage=alpha_coverage(layer)))
        return predictions


class _ConfiguredQwenBackend:
    def __init__(self, settings: QwenLayersSettings) -> None:
        self._settings = settings
        self._version: str | None = None
        self._device: str | None = None

    def configuration_reason(self) -> str | None:
        if not self._settings.enabled:
            return "Qwen Image Layered is not configured. Enhanced mode is optional."
        if self._settings.backend == "disabled":
            return "Qwen Image Layered is enabled but no local CUDA or remote HTTPS backend is selected."
        return None


class QwenLocalCudaBackend(_ConfiguredQwenBackend):
    """Lazy local Qwen pipeline that loads only from a configured local model path."""

    def __init__(
        self,
        settings: QwenLayersSettings,
        *,
        engine_factory: Callable[[QwenLayersSettings], tuple[Any, str, str]] | None = None,
    ) -> None:
        super().__init__(settings)
        self._engine_factory = engine_factory or _create_local_cuda_engine
        self._engine: Any | None = None
        self._initialization_lock = asyncio.Lock()

    @property
    def backend(self) -> LayerBackend:
        return LayerBackend(
            provider="QwenImageLayeredPipeline",
            model=MODEL_ID,
            version=self._version or SOURCE_COMMIT,
            device=self._device,
            runtimeStatus="ready" if self._engine is not None else "unavailable",
        )

    def configuration_reason(self) -> str | None:
        reason = super().configuration_reason()
        if reason is not None:
            return reason
        if self._settings.backend != "local-cuda":
            return "Qwen Image Layered local CUDA backend is not selected."
        if self._settings.model_path is None:
            return "Qwen Image Layered local CUDA backend requires TINY_SOHO_QWEN_LAYERS_MODEL_PATH."
        if not self._settings.model_path.is_dir():
            return "Qwen Image Layered local model directory does not exist."
        return None

    async def decompose(self, image: DecodedImage, options: LayerOptions = LayerOptions()) -> list[LayerPrediction]:
        engine = await self._get_engine()
        try:
            layers = await asyncio.wait_for(
                asyncio.to_thread(engine.decompose, image, options),
                timeout=self._settings.timeout_seconds,
            )
        except TimeoutError as error:
            raise VisionCapabilityUnavailable(f"Qwen Image Layered did not finish within {self._settings.timeout_seconds} seconds.") from error
        except VisionCapabilityUnavailable:
            raise
        except Exception as error:
            raise VisionCapabilityUnavailable("Qwen Image Layered inference failed. Check the local CUDA runtime and model files.") from error
        return _layer_predictions(layers, image, options)

    async def _get_engine(self) -> Any:
        reason = self.configuration_reason()
        if reason is not None:
            raise VisionCapabilityUnavailable(reason)
        async with self._initialization_lock:
            if self._engine is None:
                try:
                    self._engine, self._version, self._device = await asyncio.to_thread(self._engine_factory, self._settings)
                except VisionCapabilityUnavailable:
                    raise
                except Exception as error:
                    raise VisionCapabilityUnavailable("Qwen Image Layered could not load its configured local CUDA model.") from error
        if self._engine is None:
            raise VisionCapabilityUnavailable("Qwen Image Layered did not initialize a usable local CUDA runtime.")
        return self._engine


class _QwenLocalPipeline:
    def __init__(self, pipeline: Any, torch_module: Any) -> None:
        self._pipeline = pipeline
        self._torch = torch_module

    def decompose(self, image: DecodedImage, options: LayerOptions) -> Sequence[Image.Image]:
        with Image.open(BytesIO(image.data)) as source:
            source.load()
            source_image = source.convert("RGBA")
        generator = self._torch.Generator(device="cuda")
        if options.seed is not None:
            generator.manual_seed(options.seed)
        with self._torch.inference_mode():
            output = self._pipeline(
                image=source_image,
                generator=generator,
                true_cfg_scale=4.0,
                negative_prompt=" ",
                num_inference_steps=50,
                num_images_per_prompt=1,
                layers=options.requestedLayerCount,
                resolution=640,
                cfg_normalize=True,
                use_en_prompt=True,
                prompt=options.prompt,
            )
        try:
            return output.images[0]
        except (AttributeError, IndexError, TypeError) as error:
            raise VisionCapabilityUnavailable("Qwen Image Layered returned an unsupported local pipeline response.") from error


def _create_local_cuda_engine(settings: QwenLayersSettings) -> tuple[Any, str, str]:
    if importlib.util.find_spec("torch") is None or importlib.util.find_spec("diffusers") is None:
        raise VisionCapabilityUnavailable("Qwen Image Layered local CUDA dependencies are not installed.")
    try:
        import torch
        from diffusers import QwenImageLayeredPipeline
    except ImportError as error:
        raise VisionCapabilityUnavailable("Qwen Image Layered local CUDA dependencies could not be imported.") from error
    if not torch.cuda.is_available():
        raise VisionCapabilityUnavailable("Qwen Image Layered local backend requires a CUDA device; this host has none.")
    free_memory, _ = torch.cuda.mem_get_info()
    if int(free_memory) < settings.min_free_vram_bytes:
        raise VisionCapabilityUnavailable("Qwen Image Layered local backend does not have the configured minimum free CUDA memory.")
    assert settings.model_path is not None
    pipeline = QwenImageLayeredPipeline.from_pretrained(
        str(settings.model_path),
        local_files_only=True,
        torch_dtype=torch.bfloat16,
    ).to("cuda")
    try:
        version = importlib.metadata.version("diffusers")
    except importlib.metadata.PackageNotFoundError:
        version = SOURCE_COMMIT
    return _QwenLocalPipeline(pipeline, torch), version, "cuda"


class QwenRemoteHttpsBackend(_ConfiguredQwenBackend):
    """Server-configured HTTPS backend; browser clients never receive its token."""

    def __init__(
        self,
        settings: QwenLayersSettings,
        *,
        request_handler: Callable[[str, str, Mapping[str, object], int], Awaitable[Mapping[str, object]]] | None = None,
    ) -> None:
        super().__init__(settings)
        self._request_handler = request_handler or _remote_request

    @property
    def backend(self) -> LayerBackend:
        return LayerBackend(
            provider="QwenRemoteHttpsBackend",
            model=MODEL_ID,
            version=self._version or "configured-remote",
            device="remote",
            runtimeStatus="ready" if self._version is not None else "unavailable",
        )

    def configuration_reason(self) -> str | None:
        reason = super().configuration_reason()
        if reason is not None:
            return reason
        if self._settings.backend != "remote-https":
            return "Qwen Image Layered remote HTTPS backend is not selected."
        if self._settings.remote_url is None or self._settings.remote_token is None:
            return "Qwen Image Layered remote HTTPS backend requires a server-side URL and token."
        parsed = urlparse(self._settings.remote_url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            return "Qwen Image Layered remote URL must be an HTTPS endpoint without embedded credentials."
        if parsed.query or parsed.fragment:
            return "Qwen Image Layered remote URL must not contain query parameters or fragments."
        if parsed.hostname.lower() not in self._settings.remote_allowed_hosts:
            return "Qwen Image Layered remote URL host is not explicitly allowlisted."
        return None

    async def decompose(self, image: DecodedImage, options: LayerOptions = LayerOptions()) -> list[LayerPrediction]:
        reason = self.configuration_reason()
        if reason is not None:
            raise VisionCapabilityUnavailable(reason)
        assert self._settings.remote_url is not None
        assert self._settings.remote_token is not None
        request = {
            "imageBase64": base64.b64encode(image.data).decode("ascii"),
            "mimeType": image.mimeType,
            "prompt": options.prompt,
            "requestedLayerCount": options.requestedLayerCount,
            "seed": options.seed,
        }
        try:
            response = await asyncio.wait_for(
                self._request_handler(
                    self._settings.remote_url,
                    self._settings.remote_token,
                    request,
                    self._settings.timeout_seconds,
                ),
                timeout=self._settings.timeout_seconds,
            )
        except TimeoutError as error:
            raise VisionCapabilityUnavailable("Qwen Image Layered remote backend timed out.") from error
        except VisionCapabilityUnavailable:
            raise
        except Exception as error:
            raise VisionCapabilityUnavailable("Qwen Image Layered remote backend request failed.") from error
        return _remote_layer_predictions(response, image, options, self)


async def _remote_request(url: str, token: str, request: Mapping[str, object], timeout_seconds: int) -> Mapping[str, object]:
    async with httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=False) as client, client.stream(
        "POST",
        url,
        json=request,
        headers={"Authorization": f"Bearer {token}"},
    ) as response:
        response.raise_for_status()
        content_length = response.headers.get("content-length")
        if content_length is not None:
            try:
                expected_bytes = int(content_length)
            except ValueError as error:
                raise VisionCapabilityUnavailable("Qwen Image Layered remote backend returned an invalid Content-Length header.") from error
            if expected_bytes > MAX_REMOTE_RESPONSE_BYTES:
                raise VisionCapabilityUnavailable("Qwen Image Layered remote response exceeded the configured size limit.")
        body = bytearray()
        async for chunk in response.aiter_bytes():
            body.extend(chunk)
            if len(body) > MAX_REMOTE_RESPONSE_BYTES:
                raise VisionCapabilityUnavailable("Qwen Image Layered remote response exceeded the configured size limit.")
    return parse_remote_response(bytes(body))


def parse_remote_response(body: bytes) -> Mapping[str, object]:
    if len(body) > MAX_REMOTE_RESPONSE_BYTES:
        raise VisionCapabilityUnavailable("Qwen Image Layered remote response exceeded the configured size limit.")
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise VisionCapabilityUnavailable("Qwen Image Layered remote backend returned invalid JSON.") from error
    if not isinstance(payload, Mapping):
        raise VisionCapabilityUnavailable("Qwen Image Layered remote backend returned a non-object response.")
    return payload


def _remote_layer_predictions(
    response: Mapping[str, object],
    image: DecodedImage,
    options: LayerOptions,
    backend: QwenRemoteHttpsBackend,
) -> list[LayerPrediction]:
    raw_layers = response.get("layers")
    if not isinstance(raw_layers, list) or len(raw_layers) != options.requestedLayerCount:
        raise VisionCapabilityUnavailable("Qwen Image Layered remote backend returned an unexpected layer count.")
    decoded_layers: list[Image.Image] = []
    total_pixels = 0
    for raw_layer in raw_layers:
        if not isinstance(raw_layer, Mapping) or not isinstance(raw_layer.get("pngBase64"), str):
            raise VisionCapabilityUnavailable("Qwen Image Layered remote backend returned an invalid layer schema.")
        encoded_layer = raw_layer["pngBase64"]
        if len(encoded_layer) > _max_base64_chars(MAX_REMOTE_LAYER_BYTES):
            raise VisionCapabilityUnavailable("Qwen Image Layered remote backend returned an oversized encoded layer.")
        try:
            raw_png = base64.b64decode(encoded_layer, validate=True)
        except (ValueError, binascii.Error) as error:
            raise VisionCapabilityUnavailable("Qwen Image Layered remote backend returned invalid layer encoding.") from error
        if len(raw_png) > MAX_REMOTE_LAYER_BYTES:
            raise VisionCapabilityUnavailable("Qwen Image Layered remote backend returned an oversized layer.")
        try:
            with Image.open(BytesIO(raw_png)) as layer:
                width, height = layer.size
                pixels = width * height
                if pixels > MAX_REMOTE_LAYER_PIXELS or total_pixels + pixels > MAX_REMOTE_TOTAL_PIXELS:
                    raise VisionCapabilityUnavailable("Qwen Image Layered remote backend returned layers above the configured pixel limit.")
                layer.load()
                decoded_layers.append(layer.copy())
                total_pixels += pixels
        except VisionCapabilityUnavailable:
            raise
        except (Image.DecompressionBombError, OSError, ValueError) as error:
            raise VisionCapabilityUnavailable("Qwen Image Layered remote backend returned an invalid layer image.") from error
    version = response.get("version")
    backend._version = version if isinstance(version, str) and version else "remote-response"
    return _layer_predictions(decoded_layers, image, options)


def _layer_predictions(layers: Sequence[Image.Image], image: DecodedImage, options: LayerOptions) -> list[LayerPrediction]:
    if len(layers) != options.requestedLayerCount:
        raise VisionCapabilityUnavailable("Qwen Image Layered returned an unexpected layer count.")
    if image.width * image.height * options.requestedLayerCount > MAX_NORMALIZED_OUTPUT_PIXELS:
        raise VisionCapabilityUnavailable("Qwen Image Layered normalized output would exceed the configured normalized output pixel limit.")
    output_size: tuple[int, int] | None = None
    predictions = []
    for index, layer in enumerate(layers):
        if not isinstance(layer, Image.Image) or layer.mode != "RGBA":
            raise VisionCapabilityUnavailable("Qwen Image Layered returned a non-RGBA layer.")
        if output_size is None:
            output_size = layer.size
        elif layer.size != output_size:
            raise VisionCapabilityUnavailable("Qwen Image Layered returned layers with mismatched canvas dimensions.")
        normalized = layer
        if layer.size != (image.width, image.height):
            normalized = layer.resize((image.width, image.height), Image.Resampling.LANCZOS)
        coverage = alpha_coverage(normalized)
        if coverage <= 0:
            raise VisionCapabilityUnavailable("Qwen Image Layered returned an empty alpha layer.")
        predictions.append(LayerPrediction(id=f"layer-{index + 1}", png=encode_rgba(normalized), zIndex=index, alphaCoverage=coverage))
    return predictions


def _max_base64_chars(byte_limit: int) -> int:
    return ((byte_limit + 2) // 3) * 4


class DisabledQwenLayersBackend(_ConfiguredQwenBackend):
    @property
    def backend(self) -> LayerBackend:
        return LayerBackend(provider="QwenLayersDisabled", model=MODEL_ID, version=SOURCE_COMMIT, runtimeStatus="unavailable")

    async def decompose(self, image: DecodedImage, options: LayerOptions = LayerOptions()) -> list[LayerPrediction]:
        raise VisionCapabilityUnavailable(self.configuration_reason() or "Qwen Image Layered is disabled.")


def default_qwen_layers_backend(settings: QwenLayersSettings) -> QwenLocalCudaBackend | QwenRemoteHttpsBackend | DisabledQwenLayersBackend:
    if not settings.enabled:
        return DisabledQwenLayersBackend(settings)
    if settings.backend == "local-cuda":
        return QwenLocalCudaBackend(settings)
    if settings.backend == "remote-https":
        return QwenRemoteHttpsBackend(settings)
    return DisabledQwenLayersBackend(settings)
