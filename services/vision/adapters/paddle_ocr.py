from __future__ import annotations

import asyncio
import importlib.metadata
import importlib.util
import json
from collections.abc import Callable, Mapping
from io import BytesIO
from typing import Any

from .base import VisionCapabilityUnavailable
from ..config import PaddleOcrSettings
from ..image_input import DecodedImage
from ..schemas.ocr import OcrEngine, OcrImage, OcrRegion, OcrResult


class FakeOcrAdapter:
    def __init__(self, regions: list[OcrRegion]) -> None:
        self._regions = regions

    async def recognize(self, image: DecodedImage) -> OcrResult:
        return OcrResult(
            image=OcrImage(width=image.width, height=image.height),
            regions=[region.model_copy(deep=True) for region in self._regions],
            engine=OcrEngine(provider="FakeOcrAdapter", model="deterministic-fake", version="1"),
        )


class PaddleOcrAdapter:
    """Lazy, local PaddleOCR adapter using only explicitly provisioned model directories."""

    def __init__(
        self,
        settings: PaddleOcrSettings,
        *,
        engine_factory: Callable[[PaddleOcrSettings], tuple[Any, str, str]] | None = None,
    ) -> None:
        self._settings = settings
        self._engine_factory = engine_factory or _create_paddle_engine
        self._engine: Any | None = None
        self._version: str | None = None
        self._device: str | None = None
        self._initialization_lock = asyncio.Lock()

    async def recognize(self, image: DecodedImage) -> OcrResult:
        engine, version, device = await self._get_engine()
        try:
            raw_results = await asyncio.wait_for(
                asyncio.to_thread(engine.predict, image.data),
                timeout=self._settings.timeout_seconds,
            )
        except TimeoutError as error:
            raise VisionCapabilityUnavailable(
                f"PaddleOCR did not finish within {self._settings.timeout_seconds} seconds."
            ) from error
        except VisionCapabilityUnavailable:
            raise
        except Exception as error:
            raise VisionCapabilityUnavailable("PaddleOCR inference failed. Check the local model directories and runtime logs.") from error

        return OcrResult(
            image=OcrImage(width=image.width, height=image.height),
            regions=_normalize_results(raw_results, image.width, image.height),
            engine=OcrEngine(
                provider="PaddleOCR",
                model="PP-OCRv5_mobile_det + en_PP-OCRv5_mobile_rec",
                version=version,
                device=device,
                runtimeStatus="ready",
            ),
        )

    def configuration_reason(self) -> str | None:
        return _configuration_reason(self._settings)

    async def _get_engine(self) -> tuple[Any, str, str]:
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
                    raise VisionCapabilityUnavailable(
                        "PaddleOCR could not load the explicitly configured local models. "
                        "Run the documented provision command and verify both model directories."
                    ) from error
        if self._engine is None or self._version is None or self._device is None:
            raise VisionCapabilityUnavailable("PaddleOCR did not initialize a usable local runtime.")
        return self._engine, self._version, self._device


class _PaddlePipeline:
    """Converts validated image bytes in-process, never accepting browser file paths."""

    def __init__(self, pipeline: Any) -> None:
        self._pipeline = pipeline

    def predict(self, data: bytes) -> Any:
        try:
            import numpy
            from PIL import Image
        except ModuleNotFoundError as error:
            raise VisionCapabilityUnavailable("PaddleOCR's optional local runtime dependencies are not installed.") from error
        with Image.open(BytesIO(data)) as image:
            image.load()
            pixels = numpy.asarray(image.convert("RGB"))
        return self._pipeline.predict(pixels)


def _create_paddle_engine(settings: PaddleOcrSettings) -> tuple[Any, str, str]:
    if importlib.util.find_spec("paddleocr") is None:
        raise VisionCapabilityUnavailable("PaddleOCR is enabled but its optional runtime is not installed.")
    try:
        from paddleocr import PaddleOCR
    except ImportError as error:
        raise VisionCapabilityUnavailable("PaddleOCR's optional runtime could not be imported.") from error

    assert settings.detection_model_dir is not None
    assert settings.recognition_model_dir is not None
    pipeline = PaddleOCR(
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_detection_model_dir=str(settings.detection_model_dir),
        text_recognition_model_name="en_PP-OCRv5_mobile_rec",
        text_recognition_model_dir=str(settings.recognition_model_dir),
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device="cpu",
    )
    try:
        version = importlib.metadata.version("paddleocr")
    except importlib.metadata.PackageNotFoundError:
        version = "unknown"
    return _PaddlePipeline(pipeline), version, "cpu"


def _configuration_reason(settings: PaddleOcrSettings) -> str | None:
    if not settings.enabled:
        return "PaddleOCR is not configured. Enable it only after explicit local model provisioning."
    if settings.language != "en":
        return "PaddleOCR v5-mobile currently supports only the provisioned English recognition profile."
    for label, model_dir in (("detection", settings.detection_model_dir), ("recognition", settings.recognition_model_dir)):
        if model_dir is None:
            return f"PaddleOCR is enabled but no {label} model directory is configured."
        if not model_dir.is_dir():
            return f"PaddleOCR {label} model directory does not exist."
        missing = [name for name in ("inference.yml", "inference.pdiparams") if not (model_dir / name).is_file()]
        if missing:
            return f"PaddleOCR {label} model directory is incomplete: missing {', '.join(missing)}."
    return None


def _mapping(value: Any) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return value
    candidate = getattr(value, "json", None)
    candidate = candidate() if callable(candidate) else candidate
    if isinstance(candidate, str):
        candidate = json.loads(candidate)
    if isinstance(candidate, Mapping):
        return candidate
    try:
        return dict(value)
    except (TypeError, ValueError) as error:
        raise VisionCapabilityUnavailable("PaddleOCR returned an unsupported result format.") from error


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if hasattr(value, "tolist"):
        value = value.tolist()
    return list(value)


def _normalized_polygon(raw_polygon: Any, width: int, height: int) -> list[dict[str, float]] | None:
    points = _as_list(raw_polygon)
    normalized: list[dict[str, float]] = []
    for point in points:
        coordinates = _as_list(point)
        if len(coordinates) < 2:
            return None
        x = min(max(float(coordinates[0]), 0.0), float(width)) / width
        y = min(max(float(coordinates[1]), 0.0), float(height)) / height
        normalized.append({"x": x, "y": y})
    if len(normalized) < 3:
        return None
    minimum_x = min(point["x"] for point in normalized)
    maximum_x = max(point["x"] for point in normalized)
    minimum_y = min(point["y"] for point in normalized)
    maximum_y = max(point["y"] for point in normalized)
    if minimum_x == maximum_x or minimum_y == maximum_y:
        return None
    return normalized


def _optional_confidence(values: list[Any], index: int) -> float | None:
    if index >= len(values) or values[index] is None:
        return None
    return min(max(float(values[index]), 0.0), 1.0)


def _normalize_results(raw_results: Any, width: int, height: int) -> list[OcrRegion]:
    regions: list[OcrRegion] = []
    for page_index, page in enumerate(_as_list(raw_results), start=1):
        result = _mapping(page)
        polygons = _as_list(result.get("dt_polys"))
        detection_scores = _as_list(result.get("dt_scores"))
        texts = _as_list(result.get("rec_texts"))
        recognition_scores = _as_list(result.get("rec_scores"))
        for region_index, raw_polygon in enumerate(polygons, start=1):
            polygon = _normalized_polygon(raw_polygon, width, height)
            if polygon is None:
                continue
            minimum_x = min(point["x"] for point in polygon)
            maximum_x = max(point["x"] for point in polygon)
            minimum_y = min(point["y"] for point in polygon)
            maximum_y = max(point["y"] for point in polygon)
            index = region_index - 1
            regions.append(
                OcrRegion(
                    id=f"ocr-{page_index}-{region_index}",
                    text=str(texts[index]) if index < len(texts) and texts[index] is not None else "",
                    detectionConfidence=_optional_confidence(detection_scores, index),
                    recognitionConfidence=_optional_confidence(recognition_scores, index),
                    polygon=polygon,
                    boundingBox={
                        "x": minimum_x,
                        "y": minimum_y,
                        "width": maximum_x - minimum_x,
                        "height": maximum_y - minimum_y,
                    },
                )
            )
    return regions


def default_paddle_ocr_adapter(settings: PaddleOcrSettings) -> PaddleOcrAdapter:
    return PaddleOcrAdapter(settings)
