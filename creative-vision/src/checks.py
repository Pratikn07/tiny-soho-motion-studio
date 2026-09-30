"""Automatic take checks: did the camera hold still, did anything move behind the letters, does the clip loop?

Every bad benchmark take was caught by one of these numbers and the good ones passed, so the pipeline can retry
with a new seed instead of showing the creator a zoom or a child walking behind the text. Ported from
benchmarks/gpu/animate_text.py (behind-text) and benchmarks/gpu/compose.py (camera drift, mean difference).
The thresholds were calibrated on few clips; recheck them with benchmarks/calibration/ when adding a model.
"""
from __future__ import annotations

import subprocess
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from PIL import Image, ImageChops, ImageStat

from .finish import UUID, clean_text_layer, open_layer, text_lines, video_frame

if TYPE_CHECKING:
    from .processor import VisionJob, VisionResult

Box = tuple[int, int, int, int]

SAMPLES_PER_SECOND = 4  # Behind-text: frames sampled per second.
CHANGED = 40  # Grey-level change that counts as "the background behind this letter changed".
LETTER = 128  # Alpha above this is a letter pixel.
BORDER = 0.1  # Without a text layer, camera drift is measured on the outer 10% of each edge.
TIMEOUT_SECONDS = 120


@dataclass(frozen=True)
class Thresholds:
    camera_drift: float  # Pass below. Still takes 1-12; salmon zoom 71.
    behind_text: float  # Pass below, % of the worst line's letter pixels. Good potty 6.6-7.4; bad 10.8-36.5.
    loop: float  # Pass below, only with a pinned end frame. Pinned 2.3-2.8; unpinned 9.8-20.3.
    text_drift: float  # Pass at or below. Finishing's exact text measured 1.95 (luma) on the potty slide.
    calibrated: bool


# Per catalog model. Only calibrated models have their own entry; others use the provisional LTX numbers and the
# result says so (catalog `calibrated: false`), so B3 can hold their verdicts for the creator instead of retrying.
THRESHOLDS: dict[str, Thresholds] = {
    "ltx-2.5-distilled": Thresholds(camera_drift=12, behind_text=9, loop=5, text_drift=3, calibrated=True),
}
PROVISIONAL = Thresholds(camera_drift=12, behind_text=9, loop=5, text_drift=3, calibrated=False)


def thresholds_for(model_id: object) -> Thresholds:
    return THRESHOLDS.get(model_id, PROVISIONAL) if isinstance(model_id, str) else PROVISIONAL


def mean_difference(a: Image.Image, b: Image.Image, rects: list[Box]) -> float:
    """Mean absolute pixel difference (0-255) across the given boxes."""
    total = area = 0.0
    for rect in rects:
        stat = ImageStat.Stat(ImageChops.difference(a.crop(rect), b.crop(rect)))
        pixels = (rect[2] - rect[0]) * (rect[3] - rect[1])
        total += sum(stat.mean) / 3 * pixels
        area += pixels
    return round(total / area, 1) if area else 0.0


def border_boxes(width: int, height: int) -> list[Box]:
    x, y = max(1, round(width * BORDER)), max(1, round(height * BORDER))
    return [(0, 0, width, y), (0, height - y, width, height), (0, y, x, height - y), (width - x, y, width, height - y)]


def sample_frames(video: Path, size: tuple[int, int], fps: int = SAMPLES_PER_SECOND, *, ffmpeg: str = "ffmpeg") -> list[Image.Image]:
    with tempfile.TemporaryDirectory(prefix="tiny-soho-check-") as tmp:
        subprocess.run([ffmpeg, "-v", "error", "-y", "-i", str(video), "-vf", f"fps={fps},scale={size[0]}:{size[1]}",
                        str(Path(tmp) / "%04d.png")],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=TIMEOUT_SECONDS)
        frames = []
        for path in sorted(Path(tmp).glob("*.png")):
            with Image.open(path) as image:
                frames.append(image.convert("L"))
        return frames


def behind_text(frames: list[Image.Image], layer: Image.Image, boxes: list[Box],
                fps: int = SAMPLES_PER_SECOND) -> tuple[float, int, float]:
    """Worst share (%) of any line's letter pixels whose background changed by > CHANGED levels vs the first frame.

    Only pixels under the lettering count, not the empty space in a line's box, so a subject that merely touches
    the end of a line (as designed) scores low while a child walking behind a sentence scores high. Returns
    (percent, line number from 1, seconds) for the worst moment; (0, 0, 0) if nothing changed.
    """
    letters = layer.getchannel("A").point(lambda v: 255 if v > LETTER else 0)
    glyphs = [letters.crop(rect) for rect in boxes]
    counts = [glyph.histogram()[255] for glyph in glyphs]
    worst = (0.0, 0, 0.0)
    if not frames:
        return worst
    first = frames[0]
    for index, current in enumerate(frames[1:], start=1):
        changed = ImageChops.difference(first, current).point(lambda v: 255 if v > CHANGED else 0)
        for line, (rect, glyph, count) in enumerate(zip(boxes, glyphs, counts), start=1):
            if not count:
                continue
            share = 100 * ImageChops.multiply(changed.crop(rect), glyph).histogram()[255] / count
            if share > worst[0]:
                worst = (round(share, 1), line, round(index / fps, 2))
    return worst


def text_drift(final_last: Image.Image, layer: Image.Image) -> float:
    """Final's last frame vs the cleaned text layer on solid letter pixels, in luma.

    Luma, because yuv420p halves colour resolution: thin coloured letters differ in RGB even when placed exactly
    (a static design encoded once scores up to 13 on a 3 px divider), which would fail every seed alike.
    """
    solid = layer.getchannel("A").point(lambda v: 255 if v == 255 else 0)
    if not solid.getbbox():
        return 0.0
    difference = ImageChops.difference(final_last.convert("L"), layer.convert("RGB").convert("L"))
    return round(ImageStat.Stat(difference, mask=solid).mean[0], 2)


@dataclass(frozen=True)
class CheckReport:
    cameraDrift: float
    behindTextPercent: float
    behindTextLine: int | None
    behindTextAtSeconds: float | None
    loopDifference: float
    textDrift: float | None
    reasons: list[str]
    failed: list[str]  # Check codes that failed, for B3's retry policy.

    def take_checks(self) -> dict[str, object]:
        """T0 `TakeChecks` (optional fields left out when unknown)."""
        return {k: v for k, v in asdict(self).items() if k != "failed" and v is not None}


def evaluate(camera: float, behind: tuple[float, int, float], loop: float, drift: float | None,
             limits: Thresholds, *, end_frame_pinned: bool) -> CheckReport:
    failed, reasons = [], []
    if camera >= limits.camera_drift:
        failed.append("cameraDrift")
        reasons.append("The camera moved (a zoom or pan), so the design no longer lines up.")
    percent, line, seconds = behind
    if percent >= limits.behind_text:
        failed.append("behindText")
        reasons.append(f"Something moved behind text line {line} (counted from the top) at {seconds:g} s.")
    if end_frame_pinned and loop >= limits.loop:
        failed.append("loop")
        reasons.append("The last frame does not match the first, so the clip will jump when it replays.")
    if drift is not None and drift > limits.text_drift:
        failed.append("textDrift")
        reasons.append("The finished text does not match the text layer exactly.")
    return CheckReport(camera, percent, line or None, seconds if line else None, loop, drift, reasons, failed)


def measure(raw: Path, size: tuple[int, int], layer: Image.Image | None, final: Path | None, limits: Thresholds,
            *, end_frame_pinned: bool, ffmpeg: str = "ffmpeg") -> CheckReport:
    width, height = size
    boxes = text_lines(layer) if layer is not None else []
    first, last = (video_frame(raw, size, last=flag, ffmpeg=ffmpeg) for flag in (False, True))
    camera = mean_difference(first, last, boxes or border_boxes(width, height))
    loop = mean_difference(first, last, [(0, 0, width, height)])
    behind = behind_text(sample_frames(raw, size, ffmpeg=ffmpeg), layer, boxes) if boxes else (0.0, 0, 0.0)
    drift = None
    if final is not None and layer is not None:
        drift = text_drift(video_frame(final, size, last=True, ffmpeg=ffmpeg), layer)
    return evaluate(camera, behind, loop, drift, limits, end_frame_pinned=end_frame_pinned)


# --- Retry policy (reference for B3, which applies it) -----------------------------------------------------------

def retry_decision(rejections: list[list[str]], attempts_left: int) -> str:
    """What to do after the latest take was rejected. `rejections`: failed codes of each rejected take, oldest first.

    - "finish_problem": text drift does not depend on the seed; stop retrying and report it.
    - "calmer_motion": behind-text failed on the last two takes; ask P1 for a calmer suggestion.
    - "stop": no attempts are left, or another check failed on the last two takes.
    - "new_seed": otherwise.
    """
    latest = rejections[-1] if rejections else []
    if "textDrift" in latest:
        return "finish_problem"
    repeated = set(latest) & set(rejections[-2]) if len(rejections) >= 2 else set()
    if attempts_left <= 0:
        return "stop"
    if "behindText" in repeated:
        return "calmer_motion"
    if repeated:
        return "stop"
    return "new_seed"


# --- Vision job wiring -------------------------------------------------------------------------------------------

class CheckStorage(Protocol):
    def download_owned_source(self, owner_user_id: str, project_id: str, asset_id: str) -> tuple[bytes, str, str]: ...

    def download_owned_input(self, owner_user_id: str, project_id: str, asset_id: str) -> tuple[bytes, str, str]: ...


def check_options(options: dict[str, object], input_asset_ids: list[str]) -> tuple[str, str | None, str | None, int, int, bool, Thresholds]:
    take_id, text_id, final_id = options.get("takeId"), options.get("textAssetId"), options.get("finalAssetId")
    if not isinstance(take_id, str) or not UUID.match(take_id):
        raise ValueError("Checks need a take id.")
    for value in (text_id, final_id):
        if value is not None and (not isinstance(value, str) or value not in input_asset_ids):
            raise ValueError("Check inputs must be listed on the job.")
    width, height = options.get("width"), options.get("height")
    if not all(isinstance(v, int) and not isinstance(v, bool) and 16 <= v <= 8192 for v in (width, height)):
        raise ValueError("Checks need the slide size.")
    pinned = options.get("endFramePinned", False)
    if not isinstance(pinned, bool):
        raise ValueError("endFramePinned must be true or false.")
    return take_id, text_id, final_id, width, height, pinned, thresholds_for(options.get("modelId"))  # type: ignore[return-value]


def run_check_job(job: "VisionJob", storage: CheckStorage, ffmpeg: str) -> "VisionResult":
    """`check` operation: raw clip (source), text layer and final (inputs) -> T0 `TakeChecks` plus a verdict."""
    from .processor import VisionResult  # Imported here: processor registers this module.

    def attention(code: str, message: str) -> VisionResult:
        return VisionResult("needs_attention", [], [], None, None, code, message)

    try:
        _, text_id, final_id, width, height, pinned, limits = check_options(job.options, job.input_asset_ids)
    except ValueError as error:
        return attention("check_inputs_invalid", str(error))
    raw, raw_mime, _ = storage.download_owned_source(job.owner_user_id, job.project_id, job.source_asset_id)
    if raw_mime != "video/mp4":
        return attention("check_inputs_invalid", "Checks need the MP4 clip from the video model.")
    try:
        with tempfile.TemporaryDirectory(prefix="tiny-soho-check-job-") as directory:
            folder = Path(directory)
            raw_path = folder / "raw.mp4"
            raw_path.write_bytes(raw)
            layer = final_path = None
            if text_id:
                data, mime, _ = storage.download_owned_input(job.owner_user_id, job.project_id, text_id)
                if mime != "image/png":
                    raise ValueError("The text layer must be a PNG with transparency.")
                layer = clean_text_layer(open_layer(data, name="text layer"))
                if layer.size != (width, height):
                    raise ValueError("The text layer does not match the slide size.")
            if final_id:
                data, mime, _ = storage.download_owned_input(job.owner_user_id, job.project_id, final_id)
                if mime != "video/mp4":
                    raise ValueError("The final clip must be an MP4.")
                final_path = folder / "final.mp4"
                final_path.write_bytes(data)
            report = measure(raw_path, (width, height), layer, final_path, limits, end_frame_pinned=pinned,
                             ffmpeg=ffmpeg)
    except ValueError as error:
        return attention("check_inputs_invalid", str(error))
    except (OSError, subprocess.SubprocessError):
        return attention("check_failed", "The take could not be measured. Try the checks again.")
    return VisionResult("completed", [], [], width, height, data={
        "checks": report.take_checks(), "verdict": "rejected" if report.failed else "accepted",
        "failed": report.failed, "calibrated": limits.calibrated,
        "thresholds": {k: v for k, v in asdict(limits).items() if k != "calibrated"}})
