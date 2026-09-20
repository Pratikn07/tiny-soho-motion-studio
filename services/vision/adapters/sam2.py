from __future__ import annotations

import asyncio
import importlib.metadata
import importlib.util
import math
from io import BytesIO
from pathlib import Path
from collections.abc import Callable
from typing import Any

from PIL import Image, ImageDraw

from .base import VisionCapabilityUnavailable
from ..config import Sam2Settings
from ..image_input import DecodedImage
from ..schemas.ocr import NormalizedBoundingBox
from ..schemas.segmentation import SegmentationEngine, SegmentationPrediction, SegmentationPrompts


class FakeSegmentationAdapter:
    """Deterministic contract adapter; it is not a semantic segmentation model."""

    engine = SegmentationEngine(provider="FakeSegmentationAdapter", model="deterministic-mask", version="1")

    async def segment(self, image: DecodedImage, prompts: SegmentationPrompts) -> list[SegmentationPrediction]:
        mask = Image.new("L", (image.width, image.height), 0)
        draw = ImageDraw.Draw(mask)
        radius = max(2, round(min(image.width, image.height) / 8))

        if prompts.boundingBox is not None:
            bounding_box = prompts.boundingBox
            draw.rectangle(_pixel_box(bounding_box, image.width, image.height), fill=255)
        else:
            first_point = prompts.positivePoints[0]
            center_x = round(first_point.x * image.width)
            center_y = round(first_point.y * image.height)
            bounding_box = _normalized_box(center_x, center_y, radius, image.width, image.height)

        for point in prompts.positivePoints:
            center_x = round(point.x * image.width)
            center_y = round(point.y * image.height)
            draw.ellipse((center_x - radius, center_y - radius, center_x + radius, center_y + radius), fill=255)
        for point in prompts.negativePoints:
            center_x = round(point.x * image.width)
            center_y = round(point.y * image.height)
            draw.ellipse((center_x - radius, center_y - radius, center_x + radius, center_y + radius), fill=0)

        buffer = BytesIO()
        mask.save(buffer, format="PNG")
        return [SegmentationPrediction(id="foreground", png=buffer.getvalue(), boundingBox=bounding_box, score=1.0)]


class Sam2Adapter:
    """Lazy SAM 2 image-prompting adapter backed by an explicit local checkpoint."""

    def __init__(
        self,
        settings: Sam2Settings,
        *,
        engine_factory: Callable[[Sam2Settings], tuple[Any, str, str]] | None = None,
    ) -> None:
        self._settings = settings
        self._engine_factory = engine_factory or _create_sam2_engine
        self._engine_instance: Any | None = None
        self._engine_version: str | None = None
        self._engine_device: str | None = None
        self._initialization_lock = asyncio.Lock()

    async def segment(self, image: DecodedImage, prompts: SegmentationPrompts) -> list[SegmentationPrediction]:
        engine, _, _ = await self._get_engine()
        try:
            mask, score = await asyncio.wait_for(
                asyncio.to_thread(engine.predict, image, prompts),
                timeout=self._settings.timeout_seconds,
            )
        except TimeoutError as error:
            raise VisionCapabilityUnavailable(
                f"SAM 2 did not finish within {self._settings.timeout_seconds} seconds."
            ) from error
        except VisionCapabilityUnavailable:
            raise
        except Exception as error:
            raise VisionCapabilityUnavailable("SAM 2 inference failed. Check the local checkpoint, model config, and runtime logs.") from error

        return [_prediction_from_mask(mask, image.width, image.height, score)]

    @property
    def engine(self) -> SegmentationEngine:
        return SegmentationEngine(
            provider="SAM 2",
            model="sam2.1_hiera_tiny",
            version=self._engine_version or "2b90b9f5",
            device=self._engine_device,
            runtimeStatus="ready" if self._engine_instance is not None else "unavailable",
        )

    def configuration_reason(self) -> str | None:
        if not self._settings.enabled:
            return "SAM 2 is not configured. Enable it only after explicit local checkpoint provisioning."
        if self._settings.checkpoint_path is None:
            return "SAM 2 is enabled, but TINY_SOHO_SAM2_CHECKPOINT_PATH is not configured."
        if not self._settings.checkpoint_path.is_file():
            return "SAM 2 is enabled, but the configured checkpoint path is not a readable file."
        return None

    async def _get_engine(self) -> tuple[Any, str, str]:
        reason = self.configuration_reason()
        if reason is not None:
            raise VisionCapabilityUnavailable(reason)
        async with self._initialization_lock:
            if self._engine_instance is None:
                try:
                    self._engine_instance, self._engine_version, self._engine_device = await asyncio.to_thread(
                        self._engine_factory,
                        self._settings,
                    )
                except VisionCapabilityUnavailable:
                    raise
                except Exception as error:
                    raise VisionCapabilityUnavailable(
                        "SAM 2 could not load the configured local model. Verify the source-pinned runtime, checkpoint, and device."
                    ) from error
        if self._engine_instance is None or self._engine_version is None or self._engine_device is None:
            raise VisionCapabilityUnavailable("SAM 2 did not initialize a usable local runtime.")
        return self._engine_instance, self._engine_version, self._engine_device


class _Sam2ImagePipeline:
    """SAM 2 predictor wrapper accepting validated image bytes, never a client path."""

    def __init__(self, predictor: Any, torch_module: Any) -> None:
        self._predictor = predictor
        self._torch = torch_module

    def predict(self, image: DecodedImage, prompts: SegmentationPrompts) -> tuple[Image.Image, float]:
        try:
            import numpy
        except ModuleNotFoundError as error:
            raise VisionCapabilityUnavailable("SAM 2's optional local runtime dependencies are not installed.") from error
        with Image.open(BytesIO(image.data)) as decoded:
            decoded.load()
            pixels = numpy.asarray(decoded.convert("RGB")).copy()

        point_coordinates = [
            [point.x * (image.width - 1), point.y * (image.height - 1)]
            for point in [*prompts.positivePoints, *prompts.negativePoints]
        ]
        point_labels = [1] * len(prompts.positivePoints) + [0] * len(prompts.negativePoints)
        box = None
        if prompts.boundingBox is not None:
            bounds = prompts.boundingBox
            box = numpy.asarray(
                [
                    bounds.x * (image.width - 1),
                    bounds.y * (image.height - 1),
                    (bounds.x + bounds.width) * (image.width - 1),
                    (bounds.y + bounds.height) * (image.height - 1),
                ],
                dtype=numpy.float32,
            )
        with self._torch.inference_mode():
            self._predictor.set_image(pixels)
            masks, scores, _ = self._predictor.predict(
                point_coords=numpy.asarray(point_coordinates, dtype=numpy.float32) if point_coordinates else None,
                point_labels=numpy.asarray(point_labels, dtype=numpy.int32) if point_labels else None,
                box=box,
                multimask_output=False,
            )
        masks = numpy.asarray(masks)
        scores = numpy.asarray(scores)
        if masks.ndim < 3 or not len(masks) or not len(scores):
            raise VisionCapabilityUnavailable("SAM 2 returned no prompted segmentation mask.")
        index = int(numpy.argmax(scores))
        binary = numpy.where(masks[index] > 0, 255, 0).astype(numpy.uint8)
        return Image.fromarray(binary, mode="L"), float(scores[index])


def _create_sam2_engine(settings: Sam2Settings) -> tuple[Any, str, str]:
    if importlib.util.find_spec("sam2") is None:
        raise VisionCapabilityUnavailable("SAM 2 is enabled but its optional runtime is not installed.")
    try:
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor
    except ImportError as error:
        raise VisionCapabilityUnavailable("SAM 2's optional runtime could not be imported.") from error

    assert settings.checkpoint_path is not None
    device = _select_device(torch, settings.device)
    model = build_sam2(settings.model_config, str(settings.checkpoint_path), device=device)
    try:
        version = importlib.metadata.version("SAM-2")
    except importlib.metadata.PackageNotFoundError:
        version = "2b90b9f5"
    return _Sam2ImagePipeline(SAM2ImagePredictor(model), torch), version, device


def _select_device(torch_module: Any, requested_device: str) -> str:
    cuda_available = bool(torch_module.cuda.is_available())
    mps_available = bool(torch_module.backends.mps.is_available())
    if requested_device == "auto":
        if cuda_available:
            return "cuda"
        # MPS availability is not proof that SAM 2's required operators work.
        # Use CPU until a target-machine MPS smoke is deliberately validated.
        return "cpu"
    if requested_device == "cuda" and not cuda_available:
        raise VisionCapabilityUnavailable("SAM 2 is configured for CUDA, but CUDA is not available.")
    if requested_device == "mps" and not mps_available:
        raise VisionCapabilityUnavailable("SAM 2 is configured for MPS, but MPS is not available.")
    return requested_device


def _prediction_from_mask(mask: Image.Image, width: int, height: int, score: float) -> SegmentationPrediction:
    if mask.mode != "L" or mask.size != (width, height):
        raise VisionCapabilityUnavailable("SAM 2 returned a mask that does not match the source image dimensions.")
    binary = mask.point(lambda value: 255 if value else 0)
    bounds = binary.getbbox()
    if bounds is None:
        raise VisionCapabilityUnavailable("SAM 2 returned an empty mask for the supplied prompts.")
    if not math.isfinite(score):
        raise VisionCapabilityUnavailable("SAM 2 returned an invalid mask score.")
    left, top, right, bottom = bounds
    buffer = BytesIO()
    binary.save(buffer, format="PNG")
    return SegmentationPrediction(
        id="foreground",
        png=buffer.getvalue(),
        boundingBox=NormalizedBoundingBox(
            x=left / width,
            y=top / height,
            width=(right - left) / width,
            height=(bottom - top) / height,
        ),
        score=min(max(float(score), 0.0), 1.0),
    )


def default_sam2_adapter(settings: Sam2Settings) -> Sam2Adapter:
    return Sam2Adapter(settings)


def _pixel_box(box: NormalizedBoundingBox, width: int, height: int) -> tuple[int, int, int, int]:
    return (
        round(box.x * width),
        round(box.y * height),
        round((box.x + box.width) * width),
        round((box.y + box.height) * height),
    )


def _normalized_box(center_x: int, center_y: int, radius: int, width: int, height: int) -> NormalizedBoundingBox:
    left = max(0, center_x - radius)
    top = max(0, center_y - radius)
    right = min(width, center_x + radius)
    bottom = min(height, center_y + radius)
    return NormalizedBoundingBox(x=left / width, y=top / height, width=(right - left) / width, height=(bottom - top) / height)
