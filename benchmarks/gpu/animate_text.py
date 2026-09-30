"""Animate a separate text layer onto LTX background clips: each line fades and rises in, top to bottom.

  uv run --no-project --with pillow python benchmarks/gpu/animate_text.py [results/<timestamp>]

Reads layered.json. The text layer's pixels are never redrawn: each line is cut straight out of the designer's
transparent PNG and only its opacity and a small vertical offset change over time. Lines are found by empty
rows between them, so an icon and its word stay together. Writes <name>.final.mp4, <slide>.lines.png (numbered
lines for review), <slide>.compare.mp4 (static design | each clip) and summary.csv.
"""
from __future__ import annotations
import csv
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageStat

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
from compose import compare, frame, mean_difference, probe  # noqa: E402

START, STEP, FADE, RISE = 0.2, 0.14, 0.35, 18  # First line (s), gap between lines (s), fade length (s), rise (px).
SOLID, CLEAR = 230, 12  # Clean-up for background-removed layers: near-solid -> solid, faint haze -> clear.
THIN_ROW = 0.03  # A row with ink across less than 3% of the width counts as space between lines.
MIN_GAP = 2  # Thin rows needed to separate two lines.
SAMPLES_PER_SECOND, CHANGED = 4, 40  # Behind-text check: frames sampled per second, grey-level change that counts.
MAX_BEHIND_TEXT = 9.0  # Percent of any line's letter pixels. Calibrated on 6 potty clips: good 6.6-7.4, bad 10.8-36.5.


def text_layer(slide: dict) -> Image.Image:
    layer = Image.open(REPO / slide["text"]).convert("RGBA")
    if layer.size != (slide["width"], slide["height"]):
        raise SystemExit(f"{slide['id']}: text layer is {layer.size}, expected {slide['width']}x{slide['height']}")
    layer.putalpha(layer.getchannel("A").point(lambda v: 255 if v >= SOLID else 0 if v <= CLEAR else v))
    return layer


def lines(layer: Image.Image) -> list[tuple[int, int, int, int]]:
    """Bounding boxes of horizontal bands of text, top to bottom.

    A row is 'between lines' when it has little ink (touching icon circles or a lone descender still count as a
    gap). Each gap is cut at its thinnest row, so every pixel of ink belongs to exactly one line.
    """
    alpha = layer.getchannel("A")
    width, height = alpha.size
    ink = alpha.point(lambda v: 1 if v > 40 else 0)
    counts = [sum(ink.crop((0, y, width, y + 1)).getdata()) for y in range(height)]
    busy = [c > THIN_ROW * width for c in counts]
    runs, start = [], None  # Runs of busy rows.
    for y, is_busy in enumerate(busy + [False]):
        if is_busy and start is None:
            start = y
        elif not is_busy and start is not None:
            runs.append((start, y))
            start = None
    cuts = [0] + [min(range(a_end, b_start), key=lambda y: counts[y])
                  for (_, a_end), (b_start, _) in zip(runs, runs[1:]) if b_start - a_end >= MIN_GAP] + [height]
    boxes = []
    for top, bottom in zip(cuts, cuts[1:]):
        bbox = alpha.crop((0, top, width, bottom)).getbbox()
        if bbox:
            boxes.append((bbox[0], top + bbox[1], bbox[2], top + bbox[3]))
    return boxes


def review_sheet(layer: Image.Image, boxes: list, out: Path) -> None:
    sheet = Image.new("RGBA", layer.size, (255, 255, 255, 255))
    sheet.alpha_composite(layer)
    draw = ImageDraw.Draw(sheet)
    for index, (left, top, right, bottom) in enumerate(boxes, start=1):
        draw.rectangle([left - 3, top - 3, right + 3, bottom + 3], outline=(0, 140, 255, 255), width=3)
        draw.text((max(0, left - 28), top), str(index), fill=(0, 140, 255, 255))
    sheet.convert("RGB").save(out)


def colour_gains(still: Image.Image, first: Image.Image) -> tuple[float, ...]:
    """Per-channel gain so the clip's first frame matches the background still overall."""
    src, gen = ImageStat.Stat(still).mean, ImageStat.Stat(first).mean
    return tuple(round(min(1.25, max(0.8, s / g)), 4) if g else 1.0 for s, g in zip(src, gen))


def behind_text(raw: Path, size: tuple[int, int], layer: Image.Image, boxes: list) -> tuple[float, int, float]:
    """Worst share (%) of any line's letter pixels whose background changed by > CHANGED levels vs the first frame.

    Only pixels under the actual lettering and icons count, not the empty space in a line's box, so a subject
    that merely touches the end of a line (as in the design) scores low, while a child walking behind a sentence
    scores high. Returns (percent, line number counted from 1, time in seconds) for the worst moment.
    """
    letters = layer.getchannel("A").point(lambda v: 255 if v > 128 else 0)
    glyphs = [letters.crop(rect) for rect in boxes]
    counts = [g.histogram()[255] for g in glyphs]
    worst = (0.0, 0, 0.0)
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-vf", f"fps={SAMPLES_PER_SECOND},"
                        f"scale={size[0]}:{size[1]}", str(Path(tmp) / "%03d.png")], check=True)
        frames = sorted(Path(tmp).glob("*.png"))
        first = Image.open(frames[0]).convert("L")
        for index, path in enumerate(frames[1:], start=1):
            changed = ImageChops.difference(first, Image.open(path).convert("L")).point(
                lambda v: 255 if v > CHANGED else 0)
            for line, (rect, glyph, count) in enumerate(zip(boxes, glyphs, counts), start=1):
                if not count:
                    continue
                hit = ImageChops.multiply(changed.crop(rect), glyph).histogram()[255]
                share = 100 * hit / count
                if share > worst[0]:
                    worst = (round(share, 1), line, round(index / SAMPLES_PER_SECOND, 2))
    return worst


def render(raw: Path, slide: dict, layer: Image.Image, boxes: list, out: Path) -> tuple[float, ...]:
    w, h = slide["width"], slide["height"]
    with Image.open(REPO / slide["source"]) as image:
        still = image.convert("RGB")
    gains = colour_gains(still, frame(raw, (w, h), last=False))
    with tempfile.TemporaryDirectory() as tmp:
        inputs = ["-i", str(raw)]
        graph = [f"[0:v]scale={w}:{h},setsar=1,colorchannelmixer=rr={gains[0]}:gg={gains[1]}:bb={gains[2]},"
                 f"format=rgba[b0]"]
        for index, (left, top, right, bottom) in enumerate(boxes, start=1):
            piece = Path(tmp) / f"line{index}.png"
            layer.crop((left, top, right, bottom)).save(piece)
            inputs += ["-loop", "1", "-framerate", "24", "-i", str(piece)]
            start = START + STEP * (index - 1)
            # Rise from RISE px below to the designed position while fading in; exact position once visible.
            y = f"{top}+{RISE}*min(1\\,max(0\\,1-(t-{start})/{FADE}))"
            graph.append(f"[{index}:v]format=rgba,fade=t=in:st={start}:d={FADE}:alpha=1[t{index}]")
            graph.append(f"[b{index - 1}][t{index}]overlay=x={left}:y='{y}':eval=frame:shortest=1[b{index}]")
        graph.append(f"[b{len(boxes)}]format=yuv420p[v]")
        subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(graph), "-map", "[v]",
                        "-an", "-t", "5", "-c:v", "libx264", "-crf", "16", "-movflags", "+faststart", str(out)],
                       check=True)
    return gains


def main() -> None:
    results = sorted((HERE / "results").glob("*/metrics.json"))
    folder = (REPO / sys.argv[1]) if len(sys.argv) > 1 else (results[-1].parent if results else None)
    if not folder or not (folder / "metrics.json").exists():
        raise SystemExit("No benchmark results found. Run modal_bench.py --slides layered.json first.")
    metrics = json.loads((folder / "metrics.json").read_text())
    slides = {s["id"]: s for s in json.loads((HERE / "layered.json").read_text())}
    rows, finals, prepared = [], {}, {}
    for clip in metrics["clips"]:
        slide = slides.get(clip["slide"])
        raw = folder / f"{clip['name']}.raw.mp4"
        if not slide:
            continue
        if slide["id"] not in prepared:
            layer = text_layer(slide)
            boxes = lines(layer)
            review_sheet(layer, boxes, folder / f"{slide['id']}.lines.png")
            prepared[slide["id"]] = (layer, boxes)
        layer, boxes = prepared[slide["id"]]
        row = {"name": clip["name"], "seed": clip.get("seed", ""), "seconds": clip["seconds"],
               "peak_reserved_gib": clip["peak_reserved_gib"], "error": clip["error"] or ""}
        if raw.exists():
            size = (slide["width"], slide["height"])
            final = folder / f"{clip['name']}.final.mp4"
            gains = render(raw, slide, layer, boxes, final)
            finals.setdefault(slide["id"], []).append(final)
            row.update({"lines": len(boxes), "colour_gain": "/".join(f"{g:.3f}" for g in gains),
                        # Background behind the text should not change if the camera held still.
                        "camera_drift": mean_difference(frame(raw, size, last=False), frame(raw, size, last=True),
                                                        boxes),
                        "text_in_by": round(START + STEP * (len(boxes) - 1) + FADE, 2),
                        **dict(zip(("behind_text_pct", "behind_line", "behind_at_s"), behind_text(raw, size, layer, boxes))),
                        "final_duration": probe(final)["duration"]})
        rows.append(row)
    for slide_id, videos in finals.items():
        slide = slides[slide_id]
        with Image.open(REPO / slide["source"]) as image:
            design = image.convert("RGBA")
        design.alpha_composite(prepared[slide_id][0])
        still = folder / f"{slide_id}.design.png"
        design.convert("RGB").save(still)
        compare(still, sorted(videos), folder / f"{slide_id}.compare.mp4")
    for row in rows:
        if row.get("behind_text_pct", 0) > MAX_BEHIND_TEXT:
            row["verdict"] = f"retry: subject behind line {row['behind_line']} at {row['behind_at_s']}s"
        elif row.get("final_duration"):
            row["verdict"] = "ok"
    columns = ["name", "seed", "seconds", "peak_reserved_gib", "lines", "text_in_by", "camera_drift",
               "behind_text_pct", "behind_line", "behind_at_s", "verdict", "colour_gain", "final_duration", "error"]
    with open(folder / "summary.csv", "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows({k: row.get(k, "") for k in columns} for row in rows)
    for row in rows:
        print(", ".join(f"{k}={row[k]}" for k in columns if row.get(k) not in (None, "")))
    print(f"\nWrote {folder.relative_to(REPO)}: *.final.mp4, *.lines.png, *.compare.mp4, summary.csv")


if __name__ == "__main__":
    main()
