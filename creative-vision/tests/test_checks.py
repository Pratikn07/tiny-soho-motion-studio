import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "creative-vision"))
sys.path.insert(0, str(ROOT))
from src.checks import (  # noqa: E402
    PROVISIONAL, THRESHOLDS, evaluate, measure, retry_decision, run_check_job, thresholds_for)
from src.finish import TextAnimation, clean_text_layer, render_final  # noqa: E402
from src.processor import VisionJob, VisionProcessor, process_vision_job  # noqa: E402

OWNER = "11111111-1111-4111-8111-111111111111"
PROJECT = "22222222-2222-4222-8222-222222222222"
RAW = "33333333-3333-4333-8333-333333333333"
TEXT = "55555555-5555-4555-8555-555555555555"
FINAL = "88888888-8888-4888-8888-888888888888"
TAKE = "66666666-6666-4666-8666-666666666666"
SIZE = (240, 240)
LINES = [(20, 30, 200, 50), (20, 90, 200, 110)]
LTX = THRESHOLDS["ltx-2.5-distilled"]


def scene() -> Image.Image:
    """A textured background, so a zoom actually changes the pixels behind the text."""
    image = Image.new("RGB", SIZE, (200, 180, 160))
    draw = ImageDraw.Draw(image)
    for x in range(0, SIZE[0], 12):
        draw.rectangle([x, 0, x + 5, SIZE[1]], fill=(150, 120, 100))
    return image


def text_layer() -> Image.Image:
    layer = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for left, top, right, bottom in LINES:
        for x in range(left, right, 8):  # Letters with gaps, like real text.
            draw.rectangle([x, top, x + 4, bottom - 1], fill=(20, 40, 120, 255))
    return layer


def clip(tmp_path: Path, frames: list[Image.Image], name="raw.mp4") -> Path:
    folder = tmp_path / name.replace(".mp4", "")
    folder.mkdir()
    for index, image in enumerate(frames):
        image.save(folder / f"{index:04d}.png")
    out = tmp_path / name
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "24", "-i", str(folder / "%04d.png"), "-c:v", "libx264",
                    "-crf", "12", "-pix_fmt", "yuv420p", str(out)], check=True)
    return out


def static(count=121) -> list[Image.Image]:
    return [scene() for _ in range(count)]


def zoom(count=121) -> list[Image.Image]:
    frames = []
    for index in range(count):
        inset = round(30 * index / (count - 1))
        frames.append(scene().crop((inset, inset, SIZE[0] - inset, SIZE[1] - inset)).resize(SIZE))
    return frames


def with_square(position, size=40) -> Image.Image:
    image = scene()
    ImageDraw.Draw(image).rectangle([position[0], position[1], position[0] + size, position[1] + size], fill=(10, 10, 10))
    return image


def crossing(count=121) -> list[Image.Image]:
    """A dark shape walks in from the right across the first line and back, ending where it started."""
    frames = []
    for index in range(count):
        phase = 1 - abs(2 * index / (count - 1) - 1)  # 0 -> 1 -> 0
        frames.append(with_square((198 - round(160 * phase), 20)))
    return frames


def wandering(count=121) -> list[Image.Image]:
    """The subject ends somewhere else (away from the text), so the clip jumps on replay."""
    return [with_square((10, 130 + round(60 * index / (count - 1))), size=100) for index in range(count)]


def check(tmp_path, frames, pinned=True, final=True):
    raw = clip(tmp_path, frames)
    layer = clean_text_layer(text_layer())
    final_path = None
    if final:
        final_path = tmp_path / "final.mp4"
        final_path.write_bytes(render_final(raw.read_bytes(), scene(), layer, TextAnimation()).video)
    return measure(raw, SIZE, layer, final_path, LTX, end_frame_pinned=pinned)


def test_static_take_passes_every_check(tmp_path):
    report = check(tmp_path, static())
    assert report.failed == [] and report.reasons == []
    assert report.cameraDrift < 2 and report.behindTextPercent < 2 and report.loopDifference < 2
    assert report.textDrift is not None and report.textDrift <= 3
    assert set(report.take_checks()) >= {"cameraDrift", "behindTextPercent", "loopDifference", "textDrift", "reasons"}


def test_zoom_fails_camera_drift(tmp_path):
    report = check(tmp_path, zoom(), final=False)
    assert "cameraDrift" in report.failed and report.cameraDrift >= 12
    assert "camera moved" in report.reasons[report.failed.index("cameraDrift")]


def test_subject_crossing_a_line_fails_behind_text_and_names_the_line_and_moment(tmp_path):
    report = check(tmp_path, crossing(), final=False)
    assert report.failed == ["behindText"]
    assert report.behindTextLine == 1 and 0.5 <= report.behindTextAtSeconds <= 4.5  # While it covers the letters.
    assert report.reasons == [f"Something moved behind text line 1 (counted from the top) at {report.behindTextAtSeconds:g} s."]


def test_non_looping_end_fails_only_when_the_end_frame_was_pinned(tmp_path):
    pinned = check(tmp_path, wandering(), final=False)
    assert pinned.failed == ["loop"] and pinned.loopDifference >= 5 and pinned.cameraDrift < 12
    assert evaluate(pinned.cameraDrift, (0.0, 0, 0.0), pinned.loopDifference, None, LTX,
                    end_frame_pinned=False).failed == []


def test_without_a_text_layer_camera_drift_uses_the_frame_border(tmp_path):
    raw = clip(tmp_path, zoom())
    report = measure(raw, SIZE, None, None, LTX, end_frame_pinned=False)
    assert report.failed == ["cameraDrift"] and report.textDrift is None and report.behindTextLine is None


def test_text_drift_catches_misplaced_text(tmp_path):
    raw = clip(tmp_path, static())
    shifted = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    shifted.alpha_composite(text_layer(), (4, 0))
    final = tmp_path / "final.mp4"
    final.write_bytes(render_final(raw.read_bytes(), scene(), clean_text_layer(shifted), TextAnimation()).video)
    report = measure(raw, SIZE, clean_text_layer(text_layer()), final, LTX, end_frame_pinned=True)
    assert "textDrift" in report.failed


def test_thresholds_are_per_model_and_unknown_models_are_provisional():
    assert thresholds_for("ltx-2.5-distilled").calibrated
    assert thresholds_for("wan2.7-i2v") is PROVISIONAL and not PROVISIONAL.calibrated
    assert thresholds_for(None) is PROVISIONAL


@pytest.mark.parametrize("history, left, expected", [
    ([["cameraDrift"]], 2, "new_seed"),
    ([["behindText"]], 2, "new_seed"),
    ([["behindText"], ["behindText"]], 2, "calmer_motion"),
    ([["cameraDrift"], ["behindText"]], 2, "new_seed"),
    ([["cameraDrift"], ["cameraDrift", "loop"]], 2, "stop"),
    ([["behindText"]], 0, "stop"),
    ([["textDrift"]], 3, "finish_problem"),
])
def test_retry_policy(history, left, expected):
    assert retry_decision(history, left) == expected


class FakeStorage:
    def __init__(self, files):
        self.files = files

    def download_owned_source(self, owner, project, asset_id):
        assert (owner, project, asset_id) == (OWNER, PROJECT, RAW)
        return (*self.files[asset_id], "signed")

    def download_owned_input(self, owner, project, asset_id):
        return (*self.files[asset_id], "signed")


def check_job(**options) -> VisionJob:
    base = {"takeId": TAKE, "textAssetId": TEXT, "finalAssetId": FINAL, "width": 240, "height": 240,
            "endFramePinned": True, "modelId": "ltx-2.5-distilled"}
    return VisionJob("job", OWNER, PROJECT, RAW, "check", base | options, [TEXT, FINAL])


def test_check_job_returns_take_checks_and_a_verdict(tmp_path):
    raw = clip(tmp_path, crossing())
    layer_png = tmp_path / "text.png"
    text_layer().save(layer_png)
    final = render_final(raw.read_bytes(), scene(), clean_text_layer(text_layer()), TextAnimation()).video
    storage = FakeStorage({RAW: (raw.read_bytes(), "video/mp4"), TEXT: (layer_png.read_bytes(), "image/png"),
                           FINAL: (final, "video/mp4")})
    result = process_vision_job(check_job(), storage, VisionProcessor("ffmpeg", "ffprobe"))
    assert result.status == "completed" and result.asset_ids == []
    assert result.data["verdict"] == "rejected" and result.data["failed"] == ["behindText"]
    assert result.data["calibrated"] is True and result.data["checks"]["behindTextLine"] == 1
    assert result.data["thresholds"] == {"camera_drift": 12, "behind_text": 9, "loop": 5, "text_drift": 3}
    for bad in ({"takeId": "x"}, {"finalAssetId": RAW}, {"width": None}, {"endFramePinned": "yes"}, {"width": 300}):
        failed = run_check_job(check_job(**bad), storage, "ffmpeg")
        assert failed.status == "needs_attention" and failed.error_code == "check_inputs_invalid"
