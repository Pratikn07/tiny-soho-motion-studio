"""Finishing: put the creator's text layer back onto a model clip, one line at a time.

The model only ever animates the background. This step colour-matches the clip to the background still and
overlays the text layer's own pixels: each line is cut straight out of the transparent PNG and only its opacity
and a small vertical offset change over time, so the lettering on the last frame is exactly the creator's.
Ported from benchmarks/gpu/animate_text.py (checked frame by frame on the potty slide: 14 lines, in by 2.37 s).
"""
from __future__ import annotations

import math
import re
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from PIL import Image, ImageOps, ImageStat

if TYPE_CHECKING:
    from .processor import VisionJob, VisionResult

Box = tuple[int, int, int, int]

SOLID, CLEAR = 230, 12  # Text layer clean-up: near-solid alpha -> solid, faint haze -> clear.
INK = 40  # Alpha above this counts as ink when looking for lines.
THIN_ROW = 0.03  # A row with ink across less than 3% of the width counts as space between lines.
MIN_GAP = 2  # Thin rows needed to separate two lines.
GAIN_LIMITS = (0.8, 1.25)  # LTX renders 2-4% darker; never correct more than this.
FPS, DURATION = 24, 5.0
CRF = 16
LAST_LINE_BY = 4.5  # Seconds: the last line is fully in by here, so the final frames show the whole design.
MAX_LINES = 60  # Each line is one ffmpeg input; more than this is not a text layer we can animate safely.
MAX_OUTPUT_PIXELS = 16_000_000
MAX_LAYER_PIXELS = 40_000_000
TIMEOUT_SECONDS = 240
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
STYLES = ("none", "fade", "fade-rise")


@dataclass(frozen=True)
class TextAnimation:
    """T0 `TextAnimation`; defaults are the benchmark's."""
    style: str = "fade-rise"
    firstAt: float = 0.2
    step: float = 0.14
    fade: float = 0.35
    rise: float = 18
    coverFrame: str = "last"

    @classmethod
    def parse(cls, value: object) -> "TextAnimation":
        if value is None:
            return cls()
        if not isinstance(value, dict):
            raise ValueError("Text animation must be an object.")
        base = asdict(cls())
        unknown = set(value) - set(base)
        if unknown:
            raise ValueError("Text animation has unknown settings.")
        merged = base | value
        if merged["style"] not in STYLES or merged["coverFrame"] not in ("first", "last"):
            raise ValueError("Text animation style is not supported.")
        limits = {"firstAt": (0, 4.5), "step": (0, 2), "fade": (0, 2), "rise": (0, 200)}  # T0 textAnimationSchema.
        for key, (low, high) in limits.items():
            number = merged[key]
            if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) \
                    or not low <= number <= high:
                raise ValueError(f"Text animation {key} must be between {low} and {high}.")
            merged[key] = float(number)
        return cls(**merged)


@dataclass(frozen=True)
class LineTiming:
    starts: list[float]
    fade: float
    rise: float
    text_in_by: float
    step: float


def schedule(animation: TextAnimation, count: int) -> LineTiming:
    """Start time of each line. The step shrinks if needed so the last line is in by LAST_LINE_BY."""
    if animation.style == "none" or count == 0:
        return LineTiming([0.0] * count, 0.0, 0.0, 0.0, 0.0)
    fade = max(animation.fade, 1 / FPS)
    step = animation.step
    if count > 1 and animation.firstAt + step * (count - 1) + fade > LAST_LINE_BY:
        step = max(0.0, (LAST_LINE_BY - animation.firstAt - fade) / (count - 1))
    first = min(animation.firstAt, max(0.0, LAST_LINE_BY - fade))
    starts = [round(first + step * index, 4) for index in range(count)]
    rise = animation.rise if animation.style == "fade-rise" else 0.0
    return LineTiming(starts, fade, rise, round(starts[-1] + fade, 2), round(step, 4))


def clean_text_layer(layer: Image.Image) -> Image.Image:
    """Solidify see-through letters and drop faint haze left by background removal."""
    out = layer.convert("RGBA")
    out.putalpha(out.getchannel("A").point(lambda v: 255 if v >= SOLID else 0 if v <= CLEAR else v))
    return out


def text_lines(layer: Image.Image) -> list[Box]:
    """Bounding boxes of horizontal bands of text, top to bottom.

    A row is 'between lines' when it has little ink (touching icon circles or a lone descender still count as a
    gap). Each gap is cut at its thinnest row, so every pixel of ink belongs to exactly one line and an icon stays
    with its word.
    """
    alpha = layer.getchannel("A")
    width, height = alpha.size
    ink = alpha.point(lambda v: 1 if v > INK else 0)
    counts = [ink.crop((0, y, width, y + 1)).histogram()[1] for y in range(height)]
    busy = [count > THIN_ROW * width for count in counts]
    runs, start = [], None
    for y, is_busy in enumerate(busy + [False]):
        if is_busy and start is None:
            start = y
        elif not is_busy and start is not None:
            runs.append((start, y))
            start = None
    cuts = [0] + [min(range(a_end, b_start), key=lambda y: counts[y])
                  for (_, a_end), (b_start, _) in zip(runs, runs[1:]) if b_start - a_end >= MIN_GAP] + [height]
    boxes: list[Box] = []
    for top, bottom in zip(cuts, cuts[1:]):
        bbox = alpha.crop((0, top, width, bottom)).getbbox()
        if bbox:
            boxes.append((bbox[0], top + bbox[1], bbox[2], top + bbox[3]))
    return boxes


def colour_gains(still: Image.Image, first: Image.Image) -> tuple[float, float, float]:
    """Per-channel gain so the clip's first frame matches the background still overall."""
    low, high = GAIN_LIMITS
    src, gen = ImageStat.Stat(still.convert("RGB")).mean, ImageStat.Stat(first.convert("RGB")).mean
    return tuple(round(min(high, max(low, s / g)), 4) if g else 1.0 for s, g in zip(src, gen))  # type: ignore[return-value]


def apply_gains(image: Image.Image, gains: tuple[float, float, float]) -> Image.Image:
    bands = [band.point(lambda v, g=gain: min(255, round(v * g))) for band, gain in zip(image.convert("RGB").split(), gains)]
    return Image.merge("RGB", bands)


def video_frame(video: Path, size: tuple[int, int], *, last: bool, ffmpeg: str = "ffmpeg") -> Image.Image:
    with tempfile.TemporaryDirectory(prefix="tiny-soho-frame-") as tmp:
        png = Path(tmp) / "frame.png"
        seek = ["-sseof", "-0.1"] if last else []
        subprocess.run([ffmpeg, "-v", "error", "-y", *seek, "-i", str(video), "-frames:v", "1",
                        "-vf", f"scale={size[0]}:{size[1]}", str(png)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=60)
        with Image.open(png) as image:
            return image.convert("RGB")


def output_size(width: int, height: int) -> tuple[int, int]:
    """Even encoded size without changing the aspect ratio (odd slides are doubled, as in compose)."""
    multiplier = 2 if width % 2 or height % 2 else 1
    size = (width * multiplier, height * multiplier)
    if size[0] * size[1] > MAX_OUTPUT_PIXELS:
        raise ValueError("This slide is too large to export. Upload a smaller image at the same proportions.")
    return size


@dataclass(frozen=True)
class FinishOutput:
    video: bytes
    cover: bytes
    width: int
    height: int
    lines: int
    text_in_by: float
    step: float
    gains: tuple[float, float, float]


def finish_metadata(raw: bytes, background: Image.Image, layer: Image.Image | None, animation: TextAnimation,
                    *, ffmpeg: str = "ffmpeg") -> dict[str, object]:
    """The `finish` result (T0 FinishJobResult) for these inputs, without rendering: used when the take's final
    already exists, so a retried job reports the same numbers as the run that made the file."""
    boxes = text_lines(layer) if layer is not None else []
    timing = schedule(animation, len(boxes))
    with tempfile.TemporaryDirectory(prefix="tiny-soho-finish-") as directory:
        raw_path = Path(directory) / "raw.mp4"
        raw_path.write_bytes(raw)
        gains = colour_gains(background, video_frame(raw_path, background.size, last=False, ffmpeg=ffmpeg))
    return result_data(len(boxes), timing.text_in_by, timing.step, gains, animation)


def result_data(lines: int, text_in_by: float, step: float, gains: tuple[float, float, float],
                animation: TextAnimation) -> dict[str, object]:
    return {"lines": lines, "textInBy": text_in_by, "step": step, "colourGains": list(gains),
            "style": animation.style, "coverFrame": animation.coverFrame}


def render_final(raw: bytes, background: Image.Image, layer: Image.Image | None, animation: TextAnimation,
                 *, ffmpeg: str = "ffmpeg") -> FinishOutput:
    """Colour-match the raw clip to the background and animate the text layer in, line by line."""
    width, height = background.size
    if layer is not None and layer.size != background.size:
        raise ValueError("The text layer must be the same size as the background.")
    out_w, out_h = output_size(width, height)
    boxes = text_lines(layer) if layer is not None else []
    if len(boxes) > MAX_LINES:
        raise ValueError("The text layer has too many separate lines to animate.")
    timing = schedule(animation, len(boxes))
    with tempfile.TemporaryDirectory(prefix="tiny-soho-finish-") as directory:
        folder = Path(directory)
        raw_path, out_path = folder / "raw.mp4", folder / "final.mp4"
        raw_path.write_bytes(raw)
        first = video_frame(raw_path, (width, height), last=False, ffmpeg=ffmpeg)
        gains = colour_gains(background, first)
        inputs = ["-i", str(raw_path)]
        # Hold the last frame if a provider returns slightly less than 5 s; -t trims anything longer.
        graph = [f"[0:v]scale={width}:{height},setsar=1,fps={FPS},tpad=stop_mode=clone:stop_duration={DURATION},"
                 f"colorchannelmixer=rr={gains[0]}:gg={gains[1]}:bb={gains[2]},format=rgba[b0]"]
        if layer is not None and boxes and animation.style == "none":
            piece = folder / "text.png"
            layer.save(piece)
            inputs += ["-loop", "1", "-framerate", str(FPS), "-i", str(piece)]
            graph.append("[b0][1:v]overlay=0:0:format=rgb:shortest=1[b1]")
            last_label = "b1"
        else:
            for index, (left, top, right, bottom) in enumerate(boxes, start=1):
                piece = folder / f"line{index}.png"
                layer.crop((left, top, right, bottom)).save(piece)  # type: ignore[union-attr]
                inputs += ["-loop", "1", "-framerate", str(FPS), "-i", str(piece)]
                start = timing.starts[index - 1]
                # Rise from `rise` px below to the designed position while fading in; exact position once visible.
                y = f"{top}+{timing.rise}*min(1\\,max(0\\,1-(t-{start})/{timing.fade}))"
                graph.append(f"[{index}:v]format=rgba,fade=t=in:st={start}:d={timing.fade}:alpha=1[t{index}]")
                graph.append(f"[b{index - 1}][t{index}]overlay=x={left}:y='{y}':eval=frame:format=rgb:shortest=1[b{index}]")
            last_label = f"b{len(boxes)}"
        # Blend in RGB (above) and subsample chroma once here; yuv420 blending smears thin coloured letters.
        graph.append(f"[{last_label}]scale={out_w}:{out_h}:flags=neighbor,setsar=1,format=yuv420p[v]")
        subprocess.run([ffmpeg, "-v", "error", "-y", *inputs, "-filter_complex", ";".join(graph), "-map", "[v]",
                        "-an", "-t", str(DURATION), "-r", str(FPS), "-c:v", "libx264", "-crf", str(CRF),
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out_path)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=TIMEOUT_SECONDS)
        last_cover = animation.coverFrame == "last"
        cover = apply_gains(video_frame(raw_path, (width, height), last=last_cover, ffmpeg=ffmpeg), gains).convert("RGBA")
        # Animated text is invisible at t=0; style none has the complete layer from the first frame.
        if layer is not None and (last_cover or animation.style == "none"):
            cover.alpha_composite(layer)
        buffer = BytesIO()
        cover.convert("RGB").save(buffer, format="PNG")
        return FinishOutput(out_path.read_bytes(), buffer.getvalue(), out_w, out_h, len(boxes), timing.text_in_by,
                            timing.step, gains)


def open_layer(data: bytes, *, name: str) -> Image.Image:
    with Image.open(BytesIO(data)) as image:
        if image.width * image.height > MAX_LAYER_PIXELS:
            raise ValueError(f"The {name} is too large.")
        return ImageOps.exif_transpose(image).convert("RGBA" if name == "text layer" else "RGB")


# --- Vision job wiring -------------------------------------------------------------------------------------------

class FinishStorage(Protocol):
    def download_owned_source(self, owner_user_id: str, project_id: str, asset_id: str) -> tuple[bytes, str, str]: ...

    def download_owned_input(self, owner_user_id: str, project_id: str, asset_id: str) -> tuple[bytes, str, str]: ...

    def find_derived(self, object_path: str) -> str | None: ...

    def upload_derived(self, object_path: str, data: bytes, mime_type: str, kind: str, *, overwrite: bool = False) -> str: ...


def take_prefix(owner_user_id: str, project_id: str, take_id: str) -> str:
    return f"owners/{owner_user_id}/projects/{project_id}/takes/{take_id}/"


def finish_options(options: dict[str, object], input_asset_ids: list[str]) -> tuple[str, str, str | None, int, int, TextAnimation]:
    """Validate the `finish` job options (see the T0 changelog for the shape)."""
    take_id, background_id, text_id = options.get("takeId"), options.get("backgroundAssetId"), options.get("textAssetId")
    if not isinstance(take_id, str) or not UUID.match(take_id):
        raise ValueError("Finishing needs a take id.")
    if not isinstance(background_id, str) or background_id not in input_asset_ids:
        raise ValueError("Finishing needs the background layer as an input.")
    if text_id is not None and (not isinstance(text_id, str) or text_id not in input_asset_ids):
        raise ValueError("The text layer must be one of the job inputs.")
    width, height = options.get("width"), options.get("height")
    if not all(isinstance(v, int) and not isinstance(v, bool) and 16 <= v <= 8192 for v in (width, height)):
        raise ValueError("Finishing needs the slide size.")
    return take_id, background_id, text_id, width, height, TextAnimation.parse(options.get("textAnimation"))  # type: ignore[return-value]


def run_finish_job(job: "VisionJob", storage: FinishStorage, ffmpeg: str) -> "VisionResult":
    """`finish` operation: raw clip (source) + background and optional text layer (inputs) -> final.mp4, cover.png.

    Outputs go to the take's own folder. An asset already recorded there counts as done, so a retried job after a
    crash neither renders twice nor leaves orphaned files; it still returns the full result (plus `reused: true`).
    """
    from .processor import VisionResult  # Imported here: processor registers this module.

    def attention(code: str, message: str) -> VisionResult:
        return VisionResult("needs_attention", [], [], None, None, code, message)

    try:
        take_id, background_id, text_id, width, height, animation = finish_options(job.options, job.input_asset_ids)
        out_w, out_h = output_size(width, height)
    except ValueError as error:
        return attention("finish_inputs_invalid", str(error))
    prefix = take_prefix(job.owner_user_id, job.project_id, take_id)
    paths = [f"{prefix}final.mp4", f"{prefix}cover.png"]
    existing = [storage.find_derived(path) for path in paths]

    raw, raw_mime, _ = storage.download_owned_source(job.owner_user_id, job.project_id, job.source_asset_id)
    if raw_mime != "video/mp4":
        return attention("finish_inputs_invalid", "Finishing needs an MP4 clip from the video model.")
    try:
        background_data, background_mime, _ = storage.download_owned_input(job.owner_user_id, job.project_id, background_id)
        if not background_mime.startswith("image/"):
            raise ValueError("The background layer must be an image.")
        background = open_layer(background_data, name="background")
        layer = None
        if text_id:
            text_data, text_mime, _ = storage.download_owned_input(job.owner_user_id, job.project_id, text_id)
            if text_mime != "image/png":
                raise ValueError("The text layer must be a PNG with transparency.")
            layer = clean_text_layer(open_layer(text_data, name="text layer"))
        if background.size != (width, height):
            raise ValueError("The background does not match the slide size.")
        if all(existing):  # Already finished (a retried job): report the result, render and upload nothing.
            data = finish_metadata(raw, background, layer, animation, ffmpeg=ffmpeg) | {"reused": True}
            return VisionResult("completed", existing, paths, out_w, out_h, data=data)  # type: ignore[arg-type]
        result = render_final(raw, background, layer, animation, ffmpeg=ffmpeg)
    except ValueError as error:
        return attention("finish_inputs_invalid", str(error))
    except (OSError, subprocess.SubprocessError):
        return attention("finish_failed", "The clip could not be finished. Try this take again.")
    cover_id = existing[1] or storage.upload_derived(paths[1], result.cover, "image/png", "derived-image", overwrite=True)
    final_id = existing[0] or storage.upload_derived(paths[0], result.video, "video/mp4", "derived-video", overwrite=True)
    return VisionResult("completed", [final_id, cover_id], paths, result.width, result.height,
                        data=result_data(result.lines, result.text_in_by, result.step, result.gains, animation))
