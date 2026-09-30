"""Protect only the text and brand boxes, keep everything else the model generated, and measure the result.

  uv run --no-project --with pillow python benchmarks/gpu/compose.py [results/<timestamp>]

Boxes come from slides.json (text detection plus hand-measured logos/cards), not from the app. For each
full-slide <name>.raw.mp4 it writes <name>.final.mp4: the clip colour-matched to the original, with every
protected box restored from the original still (soft outward edge, exact inside). Per slide it writes
<slide>.compare.mp4 (original | each clip in name order | baseline if any) and one summary.csv.
"""
from __future__ import annotations
import csv
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps, ImageStat

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
FEATHER = 10  # Source pixels of soft edge outside each box; inside a box stays 100% original.
PRICE_PER_SECOND = 0.000842  # Modal RTX PRO 6000, from modal.com/pricing on 2026-09-29.
CLIPS_PER_MONTH, BATCHES_PER_MONTH = 600, 30  # Two 10-slide carousels a day, one GPU session a day.


def probe(video: Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height,nb_frames:format=duration", "-of", "json", str(video)],
                         check=True, capture_output=True, text=True).stdout
    data = json.loads(out)
    stream = data["streams"][0]
    return {"width": stream["width"], "height": stream["height"], "frames": int(stream.get("nb_frames", 0)),
            "duration": round(float(data["format"]["duration"]), 2)}


def frame(video: Path, size: tuple[int, int], last: bool) -> Image.Image:
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "frame.png"
        seek = ["-sseof", "-0.1"] if last else []
        subprocess.run(["ffmpeg", "-v", "error", "-y", *seek, "-i", str(video), "-frames:v", "1",
                        "-vf", f"scale={size[0]}:{size[1]}", str(png)], check=True)
        return Image.open(png).convert("RGB")


def original(slide: dict) -> Image.Image:
    with Image.open(REPO / slide["source"]) as image:
        return ImageOps.exif_transpose(image).convert("RGB")


def boxes(slide: dict) -> list[tuple[int, int, int, int]]:
    w, h = slide["width"], slide["height"]
    return [(round(b["x"] * w / 100), round(b["y"] * h / 100), round((b["x"] + b["width"]) * w / 100),
             round((b["y"] + b["height"]) * h / 100)) for b in slide["protected"]]


def mean_difference(a: Image.Image, b: Image.Image, rects: list[tuple[int, int, int, int]]) -> float:
    """Mean absolute pixel difference (0-255) across the given boxes."""
    total = area = 0.0
    for rect in rects:
        stat = ImageStat.Stat(ImageChops.difference(a.crop(rect), b.crop(rect)))
        pixels = (rect[2] - rect[0]) * (rect[3] - rect[1])
        total += sum(stat.mean) / 3 * pixels
        area += pixels
    return round(total / area, 1) if area else 0.0


def protection_mask(slide: dict) -> Image.Image:
    """Alpha 255 on every protected box, fading to 0 over FEATHER px outside it."""
    size = (slide["width"], slide["height"])
    grown = Image.new("L", size, 0)
    draw = ImageDraw.Draw(grown)
    for left, top, right, bottom in boxes(slide):
        draw.rectangle([left - FEATHER, top - FEATHER, right + FEATHER, bottom + FEATHER], fill=255)
    mask = grown.filter(ImageFilter.GaussianBlur(FEATHER / 2))
    exact = ImageDraw.Draw(mask)
    for rect in boxes(slide):
        exact.rectangle(rect, fill=255)  # The text itself is never blended.
    return mask


def colour_gains(still: Image.Image, first: Image.Image, slide: dict) -> tuple[float, ...]:
    """Per-channel gain so the clip's first frame matches the original inside the protected boxes."""
    src, gen = [0.0] * 3, [0.0] * 3
    for rect in boxes(slide):
        for totals, image in ((src, still), (gen, first)):
            stat = ImageStat.Stat(image.crop(rect))
            for channel in range(3):
                totals[channel] += stat.sum[channel]
    return tuple(round(min(1.25, max(0.8, s / g)), 4) if g else 1.0 for s, g in zip(src, gen))


def compose(raw: Path, slide: dict, out: Path) -> tuple[float, ...]:
    w, h = slide["width"], slide["height"]
    still = original(slide)
    gains = colour_gains(still, frame(raw, (w, h), last=False), slide)
    multiplier = 2 if w % 2 or h % 2 else 1  # Even encoded size without changing the aspect ratio.
    with tempfile.TemporaryDirectory() as tmp:
        overlay = still.convert("RGBA")
        overlay.putalpha(protection_mask(slide))
        png = Path(tmp) / "protected.png"
        overlay.save(png)
        mixer = f"colorchannelmixer=rr={gains[0]}:gg={gains[1]}:bb={gains[2]}"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-loop", "1", "-i", str(png),
                        "-filter_complex", f"[0:v]scale={w}:{h},setsar=1,{mixer}[base];"
                                           f"[base][1:v]overlay=0:0:format=auto:shortest=1,"
                                           f"scale={w * multiplier}:{h * multiplier}:flags=neighbor,setsar=1[v]",
                        "-map", "[v]", "-an", "-t", "5", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart", str(out)], check=True)
    return gains


def compare(source: Path, videos: list[Path], out: Path) -> None:
    inputs = ["-loop", "1", "-t", "5", "-i", str(source)]
    for video in videos:
        inputs += ["-i", str(video)]
    count = len(videos) + 1
    scaled = "".join(f"[{i}:v]scale=-2:600,setsar=1,fps=24[v{i}];" for i in range(count))
    stacked = "".join(f"[v{i}]" for i in range(count)) + f"hstack=inputs={count}[v]"
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", scaled + stacked, "-map", "[v]",
                    "-t", "5", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", str(out)], check=True)


def main() -> None:
    results = sorted((HERE / "results").glob("*/metrics.json"))
    folder = (REPO / sys.argv[1]) if len(sys.argv) > 1 else (results[-1].parent if results else None)
    if not folder or not (folder / "metrics.json").exists():
        raise SystemExit("No benchmark results found. Run modal_bench.py first.")
    metrics = json.loads((folder / "metrics.json").read_text())
    slides = {s["id"]: s for s in json.loads((HERE / "slides.json").read_text())}
    rows, finals = [], {}
    for clip in metrics["clips"]:
        raw = folder / f"{clip['name']}.raw.mp4"
        if clip.get("mode", "full") != "full":
            continue  # Earlier crop-mode clips only contain part of the slide.
        slide = slides[clip["slide"]]
        row = {"name": clip["name"], "slide": slide["id"], "seed": clip.get("seed", ""), "order": clip["order"],
               "seconds": clip["seconds"], "peak_reserved_gib": clip["peak_reserved_gib"], "error": clip["error"] or ""}
        if raw.exists():
            size = (slide["width"], slide["height"])
            first, last = frame(raw, size, last=False), frame(raw, size, last=True)
            final = folder / f"{clip['name']}.final.mp4"
            gains = compose(raw, slide, final)
            finals.setdefault(slide["id"], []).append(final)
            row.update({
                # Pixels behind the text should not change if the camera held still; a zoom or pan scores high.
                "camera_drift": mean_difference(first, last, boxes(slide)),
                "colour_gain": "/".join(f"{g:.3f}" for g in gains),
                # Final text vs the original design: ~2-3 is an untouched still after encoding.
                "final_text_drift": mean_difference(original(slide), frame(final, size, last=True), boxes(slide)),
                "final_duration": probe(final)["duration"]})
        rows.append(row)
    for slide_id, videos in finals.items():
        baseline = slides[slide_id].get("baseline")
        compare(REPO / slides[slide_id]["source"], sorted(videos) + ([REPO / baseline] if baseline else []),
                folder / f"{slide_id}.compare.mp4")
    columns = ["name", "slide", "seed", "order", "seconds", "peak_reserved_gib", "camera_drift", "colour_gain",
               "final_text_drift", "final_duration", "error"]
    with open(folder / "summary.csv", "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows({k: row.get(k, "") for k in columns} for row in rows)
    for row in rows:
        print(", ".join(f"{k}={row[k]}" for k in columns if row.get(k) not in (None, "")))
    done = [c for c in metrics["clips"] if not c["error"]]
    steady = [c["seconds"] for c in done[1:]] or [c["seconds"] for c in done]  # The first clip includes warm-up.
    if steady:
        per_clip = sum(steady) / len(steady)
        monthly = (per_clip * CLIPS_PER_MONTH + metrics["load_seconds"] * BATCHES_PER_MONTH) * PRICE_PER_SECOND
        print(f"\nSteady-state {per_clip:.0f}s per clip on {metrics['gpu']}. Projected Modal GPU cost for "
              f"{CLIPS_PER_MONTH} clips/month, no retries: ${monthly:.2f}. Excludes container start and reruns.")
    print(f"\nWrote {folder.relative_to(REPO)}/summary.csv, *.final.mp4 and *.compare.mp4")


if __name__ == "__main__":
    main()
