import json
import os
import subprocess
import sys
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image, ImageChops, ImageDraw, ImageStat

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "creative-vision"))
sys.path.insert(0, str(ROOT))
from src.finish import (  # noqa: E402
    TextAnimation, clean_text_layer, colour_gains, render_final, run_finish_job, schedule, text_lines)
from src.processor import VisionJob, VisionProcessor, process_vision_job  # noqa: E402

OWNER = "11111111-1111-4111-8111-111111111111"
PROJECT = "22222222-2222-4222-8222-222222222222"
RAW = "33333333-3333-4333-8333-333333333333"
BACKGROUND = "44444444-4444-4444-8444-444444444444"
TEXT = "55555555-5555-4555-8555-555555555555"
TAKE = "66666666-6666-4666-8666-666666666666"
JOB = "77777777-7777-4777-8777-777777777777"
STILL = (200, 180, 160)
INKS = [(20, 40, 120), (120, 20, 40), (30, 110, 40)]
BARS = [(20, 30, 180, 50), (40, 90, 200, 110), (20, 160, 150, 185)]  # left, top, right, bottom on a 240x240 slide.


def text_layer(size=(240, 240), haze=True) -> Image.Image:
    layer = Image.new("RGBA", size, (0, 0, 0, 5 if haze else 0))
    draw = ImageDraw.Draw(layer)
    for (left, top, right, bottom), ink in zip(BARS, INKS):
        draw.rectangle([left, top, right - 1, bottom - 1], fill=(*ink, 240))
    return layer


def background(size=(240, 240)) -> Image.Image:
    return Image.new("RGB", size, STILL)


def raw_clip(tmp_path: Path, darken=0.95, size="96x96", seconds=5.04) -> bytes:
    colour = "".join(f"{round(c * darken):02x}" for c in STILL)
    out = tmp_path / "raw.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=0x{colour}:s={size}:r=24:d={seconds}",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)], check=True)
    return out.read_bytes()


def frame_at(video: bytes, tmp_path: Path, seconds: float) -> Image.Image:
    path, png = tmp_path / "final.mp4", tmp_path / "frame.png"
    path.write_bytes(video)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(seconds), "-i", str(path), "-frames:v", "1", str(png)],
                   check=True)
    with Image.open(png) as image:
        return image.convert("RGB")


def probe(video: bytes, tmp_path: Path) -> dict:
    path = tmp_path / "probe.mp4"
    path.write_bytes(video)
    data = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
                                               "-show_entries", "stream=width,height,nb_read_frames,pix_fmt:format=duration",
                                               "-of", "json", str(path)]))
    stream = data["streams"][0]
    return {"width": stream["width"], "height": stream["height"], "frames": int(stream["nb_read_frames"]),
            "pix_fmt": stream["pix_fmt"], "duration": round(float(data["format"]["duration"]), 2)}


def close(a, b, tolerance=8) -> bool:
    return max(abs(x - y) for x, y in zip(a, b)) <= tolerance


def centre(box):
    return ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2)


def test_clean_up_makes_near_solid_letters_solid_and_removes_haze():
    layer = clean_text_layer(text_layer())
    assert layer.getpixel((5, 5))[3] == 0  # Haze (alpha 5) is cleared.
    assert layer.getpixel(centre(BARS[0]))[3] == 255  # Letters at 240 become solid.
    partial = Image.new("RGBA", (4, 4), (0, 0, 0, 100))
    assert clean_text_layer(partial).getpixel((0, 0))[3] == 100  # Real anti-aliasing is kept.


def test_lines_are_found_top_to_bottom_with_exact_boxes():
    assert text_lines(clean_text_layer(text_layer())) == BARS


def test_icon_touching_its_word_stays_on_one_line_and_a_lone_descender_does_not_join_lines():
    layer = Image.new("RGBA", (300, 200), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.ellipse([10, 20, 50, 60], fill=(0, 0, 0, 255))  # Icon taller than its word.
    draw.rectangle([60, 30, 250, 50], fill=(0, 0, 0, 255))
    draw.rectangle([100, 60, 103, 75], fill=(0, 0, 0, 255))  # A descender reaching toward the next line (thin rows).
    draw.rectangle([10, 80, 250, 100], fill=(0, 0, 0, 255))
    boxes = text_lines(layer)
    assert len(boxes) == 2
    assert boxes[0][0] == 10 and boxes[0][1] == 20  # Icon and word together.
    assert boxes[1][1] >= 76 and boxes[1][3] == 101


def test_colour_gain_matches_a_darker_clip_and_is_clamped():
    still = background((20, 20))
    darker = Image.new("RGB", (20, 20), tuple(round(c * 0.95) for c in STILL))
    gains = colour_gains(still, darker)
    assert all(1.04 < g < 1.07 for g in gains)
    assert colour_gains(still, Image.new("RGB", (20, 20), (20, 20, 20))) == (1.25, 1.25, 1.25)
    assert colour_gains(still, Image.new("RGB", (20, 20), (255, 255, 255))) == (0.8, 0.8, 0.8)


def test_schedule_matches_the_benchmark_and_fits_long_layers_into_the_clip():
    assert schedule(TextAnimation(), 14).text_in_by == 2.37  # Potty slide: 14 lines, in by 2.37 s.
    long = schedule(TextAnimation(step=0.5), 20)
    assert long.text_in_by <= 4.5 and long.starts == sorted(long.starts)
    assert schedule(TextAnimation(style="none"), 5).starts == [0.0] * 5
    assert schedule(TextAnimation(style="fade"), 3).rise == 0


def test_text_animation_rejects_unknown_or_out_of_range_settings():
    assert TextAnimation.parse(None) == TextAnimation()
    assert TextAnimation.parse({"style": "fade", "step": 0.2}).step == 0.2
    assert TextAnimation.parse({"firstAt": 4.5, "step": 2}).firstAt == 4.5  # T0's upper limits are accepted.
    late = schedule(TextAnimation.parse({"firstAt": 4.5, "step": 2}), 3)
    assert late.text_in_by <= 4.5 and late.starts == sorted(late.starts)
    for bad in ({"style": "spin"}, {"fade": -1}, {"rise": 1000}, {"coverFrame": "middle"}, {"speed": 2},
                {"firstAt": 4.6}, {"step": 2.1},
                {"firstAt": float("nan")}, {"step": True}, "fade"):
        with pytest.raises(ValueError):
            TextAnimation.parse(bad)


def test_final_shows_each_line_top_to_bottom_and_ends_with_the_exact_text(tmp_path):
    layer = clean_text_layer(text_layer())
    animation = TextAnimation(firstAt=0.5, step=1.0, fade=0.2, rise=18)  # Lines in by 0.7, 1.7 and 2.7 s.
    out = render_final(raw_clip(tmp_path), background(), layer, animation)
    info = probe(out.video, tmp_path)
    assert (info["width"], info["height"], info["pix_fmt"]) == (240, 240, "yuv420p")
    assert info["duration"] == 5.0 and info["frames"] == 120
    assert out.lines == 3 and out.text_in_by == 2.7
    early, middle, late = (frame_at(out.video, tmp_path, t) for t in (0.3, 1.1, 4.9))
    assert all(close(early.getpixel(centre(box)), STILL) for box in BARS)  # Nothing yet, colour matched.
    assert close(middle.getpixel(centre(BARS[0])), INKS[0])
    assert close(middle.getpixel(centre(BARS[2])), STILL)
    assert all(close(late.getpixel(centre(box)), ink) for box, ink in zip(BARS, INKS))
    assert close(late.getpixel((230, 5)), STILL)
    cover = Image.open(BytesIO(out.cover)).convert("RGB")
    assert cover.size == (240, 240) and cover.getpixel(centre(BARS[1])) == INKS[1]


def test_style_none_places_all_text_from_the_first_frame(tmp_path):
    out = render_final(raw_clip(tmp_path), background(), clean_text_layer(text_layer()), TextAnimation(style="none"))
    first = frame_at(out.video, tmp_path, 0)
    assert all(close(first.getpixel(centre(box)), ink) for box, ink in zip(BARS, INKS))


@pytest.mark.parametrize("style", ["fade-rise", "none"])
def test_first_frame_cover_obeys_the_text_animation(tmp_path, style):
    out = render_final(raw_clip(tmp_path), background(), clean_text_layer(text_layer()),
                       TextAnimation(style=style, coverFrame="first"))
    cover = Image.open(BytesIO(out.cover)).convert("RGB")
    first = frame_at(out.video, tmp_path, 0)
    assert cover.size == background().size
    assert all(close(cover.getpixel(centre(box)), first.getpixel(centre(box))) for box in BARS)


def test_odd_slide_is_doubled_and_short_clips_are_held_to_five_seconds(tmp_path):
    size = (121, 151)
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rectangle([10, 10, 100, 30], fill=(*INKS[0], 255))
    out = render_final(raw_clip(tmp_path, seconds=4.6), background(size), layer, TextAnimation())
    info = probe(out.video, tmp_path)
    assert (info["width"], info["height"]) == (242, 302) and info["duration"] == 5.0


def test_no_text_layer_exports_the_colour_matched_background_only(tmp_path):
    out = render_final(raw_clip(tmp_path), background(), None, TextAnimation())
    assert out.lines == 0
    assert close(frame_at(out.video, tmp_path, 4.9).getpixel((120, 120)), STILL)


def test_mismatched_layers_fail_closed(tmp_path):
    with pytest.raises(ValueError):
        render_final(raw_clip(tmp_path), background((200, 200)), text_layer(), TextAnimation())


class FakeStorage:
    def __init__(self, tmp_path: Path, text=True) -> None:
        self.files = {RAW: (raw_clip(tmp_path), "video/mp4"), BACKGROUND: (png(background(), "PNG"), "image/png")}
        if text:
            self.files[TEXT] = (png(text_layer(), "PNG"), "image/png")
        self.assets: dict[str, str] = {}
        self.uploads: list[tuple[str, str, bool]] = []
        self.downloads: list[str] = []

    def download_owned_source(self, owner, project, asset_id):
        assert (owner, project, asset_id) == (OWNER, PROJECT, RAW)
        self.downloads.append(asset_id)
        return (*self.files[asset_id], "signed")

    def download_owned_input(self, owner, project, asset_id):
        self.downloads.append(asset_id)
        return (*self.files[asset_id], "signed")

    def find_derived(self, object_path):
        return self.assets.get(object_path)

    def upload_derived(self, object_path, data, mime_type, kind, *, overwrite=False):
        self.uploads.append((object_path, kind, overwrite))
        self.assets[object_path] = f"asset-{len(self.assets)}"
        return self.assets[object_path]


def png(image: Image.Image, fmt: str) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


def finish_job(**options) -> VisionJob:
    base = {"takeId": TAKE, "backgroundAssetId": BACKGROUND, "textAssetId": TEXT, "width": 240, "height": 240,
            "textAnimation": {"style": "fade-rise", "firstAt": 0.2, "step": 0.14, "fade": 0.35, "rise": 18,
                              "coverFrame": "last"}}  # T0 FinishJobOptions.
    return VisionJob(JOB, OWNER, PROJECT, RAW, "finish", base | options, [BACKGROUND, TEXT])


def test_finish_job_writes_to_the_take_folder_and_is_idempotent(tmp_path):
    storage = FakeStorage(tmp_path)
    processor = VisionProcessor(ffmpeg_path="ffmpeg", ffprobe_path="ffprobe")
    result = process_vision_job(finish_job(), storage, processor)
    prefix = f"owners/{OWNER}/projects/{PROJECT}/takes/{TAKE}/"
    assert result.status == "completed"
    assert result.object_paths == [f"{prefix}final.mp4", f"{prefix}cover.png"]
    assert [u[1] for u in storage.uploads] == ["derived-image", "derived-video"] and all(u[2] for u in storage.uploads)
    assert result.data["lines"] == 3 and result.data["textInBy"] == 0.83
    again = process_vision_job(finish_job(), storage, processor)
    assert again.status == "completed" and again.asset_ids == result.asset_ids
    assert len(storage.uploads) == 2  # Existing outputs count as done: nothing rendered or uploaded again.
    assert again.data == result.data | {"reused": True}  # Still a complete T0 FinishJobResult.


def test_finish_job_without_text_layer_and_with_bad_inputs(tmp_path):
    storage = FakeStorage(tmp_path, text=False)
    processor = VisionProcessor(ffmpeg_path="ffmpeg", ffprobe_path="ffprobe")
    assert process_vision_job(finish_job(textAssetId=None), storage, processor).data["lines"] == 0
    for bad in ({"takeId": "../other"}, {"backgroundAssetId": RAW}, {"width": 0}, {"textAnimation": {"style": "x"}},
                {"width": 300}):
        result = run_finish_job(finish_job(textAssetId=None, **bad), FakeStorage(tmp_path, text=False), "ffmpeg")
        assert result.status == "needs_attention" and result.error_code == "finish_inputs_invalid"


def test_job_storage_only_allows_this_takes_folder():
    from src.repository import JobStorage, VisionRepositoryError

    class Repo:
        def upload_derived(self, job, path, *args, **kwargs):
            return "ok"

        def find_derived(self, job, path):
            return None

    storage = JobStorage(Repo(), finish_job())
    project = f"owners/{OWNER}/projects/{PROJECT}/"
    assert storage.upload_derived(f"{project}takes/{TAKE}/final.mp4", b"", "video/mp4", "derived-video") == "ok"
    for path in (f"{project}takes/{JOB}/final.mp4", f"{project}takes/{TAKE}/../x/final.mp4", "owners/x/final.mp4"):
        with pytest.raises(VisionRepositoryError):
            storage.upload_derived(path, b"", "video/mp4", "derived-video")
    compose = JobStorage(Repo(), VisionJob(JOB, OWNER, PROJECT, RAW, "compose", {"takeId": TAKE}, []))
    with pytest.raises(VisionRepositoryError):
        compose.find_derived(f"{project}takes/{TAKE}/final.mp4")


POTTY = os.environ.get("TINY_SOHO_POTTY_DIR")  # Folder with potty-background.webp and potty-text.png (never in git).
POTTY_RAW = os.environ.get("TINY_SOHO_POTTY_RAW")  # A potty *.raw.mp4 from benchmarks/gpu/results/.


@pytest.mark.skipif(not (POTTY and POTTY_RAW), reason="private potty fixtures are local only")
def test_golden_potty_slide(tmp_path):
    folder = Path(POTTY)  # type: ignore[arg-type]
    with Image.open(folder / "potty-background.webp") as image:
        still = image.convert("RGB")
    with Image.open(folder / "potty-text.png") as image:
        layer = clean_text_layer(image)
    out = render_final(Path(POTTY_RAW).read_bytes(), still, layer, TextAnimation())  # type: ignore[arg-type]
    assert out.lines == 14 and out.text_in_by == 2.37
    last = frame_at(out.video, tmp_path, 4.95)
    # Every solid letter pixel of the cleaned layer, including edges.
    letters = layer.getchannel("A").point(lambda v: 255 if v == 255 else 0)
    difference = ImageChops.difference(last, layer.convert("RGB"))
    mean = sum(ImageStat.Stat(difference, mask=letters).mean) / 3
    print(f"potty: {out.lines} lines, in by {out.text_in_by}s, letter-pixel difference {mean:.2f}, gains {out.gains}")
    assert mean <= 3
