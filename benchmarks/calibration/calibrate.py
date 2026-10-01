"""Run the take checks over labelled clips and report how well each threshold separates good from bad takes.

  python benchmarks/calibration/calibrate.py [labels.json] [--model ltx-2.5-distilled] [--root <repo>]

Use it when adding a model or changing a threshold (docs/tasks/P5-checks-and-retry.md). Layered slides
(benchmarks/gpu/layered.json) are checked against their text layer and re-finished with the production finish step
for the text-drift check. Flat slides (benchmarks/gpu/slides.json) only have hand-measured protected boxes, so they
test camera drift on those boxes. Clips and slides are read from local, git-ignored folders; missing files are
reported and skipped.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path[:0] = [str(REPO / "creative-vision"), str(REPO)]
from PIL import Image, ImageOps  # noqa: E402
from src.checks import CheckReport, evaluate, measure, mean_difference, thresholds_for  # noqa: E402
from src.finish import TextAnimation, clean_text_layer, render_final, video_frame  # noqa: E402

CHECKS = {"cameraDrift": "cameraDrift", "behindText": "behindTextPercent", "loop": "loopDifference",
          "textDrift": "textDrift"}


def flat_boxes(slide: dict) -> list[tuple[int, int, int, int]]:
    w, h = slide["width"], slide["height"]
    return [(round(b["x"] * w / 100), round(b["y"] * h / 100), round((b["x"] + b["width"]) * w / 100),
             round((b["y"] + b["height"]) * h / 100)) for b in slide["protected"]]


def run(take: dict, slides: dict, root: Path, model: str) -> tuple[CheckReport, list[str]]:
    limits = thresholds_for(model)
    slide = slides[take["slide"]]
    raw, size = root / take["raw"], (slide["width"], slide["height"])
    if "text" in slide:
        with Image.open(root / slide["text"]) as image:
            layer = clean_text_layer(image)
        with Image.open(root / slide["source"]) as image:
            still = ImageOps.exif_transpose(image).convert("RGB")
        with tempfile.TemporaryDirectory() as tmp:
            final = Path(tmp) / "final.mp4"
            final.write_bytes(render_final(raw.read_bytes(), still, layer, TextAnimation()).video)
            report = measure(raw, size, layer, final, limits, end_frame_pinned=take.get("pinned", False))
        return report, take.get("checks", list(CHECKS))
    first, last = (video_frame(raw, size, last=flag) for flag in (False, True))
    camera = mean_difference(first, last, flat_boxes(slide))
    return evaluate(camera, (0.0, 0, 0.0), 0.0, None, limits, end_frame_pinned=False), take.get("checks", ["cameraDrift"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("labels", nargs="?", default=str(HERE / "labels.json"))
    parser.add_argument("--model", default="ltx-2.5-distilled")
    parser.add_argument("--root", default=str(REPO), help="Folder that the labels' paths are relative to.")
    args = parser.parse_args()
    root = Path(args.root)
    slides = {s["id"]: s for name in ("slides.json", "layered.json")
              for s in json.loads((REPO / "benchmarks/gpu" / name).read_text())}
    limits = thresholds_for(args.model)
    print(f"model {args.model} ({'calibrated' if limits.calibrated else 'PROVISIONAL'} thresholds: {limits})\n")
    agree, total, values = 0, 0, {name: {"accepted": [], "rejected": []} for name in CHECKS}
    for take in json.loads(Path(args.labels).read_text())["takes"]:
        if not (root / take["raw"]).exists():
            print(f"skip {take['id']}: {take['raw']} not found")
            continue
        report, applied = run(take, slides, root, args.model)
        failed = [code for code in report.failed if code in applied]
        verdict = "rejected" if failed else "accepted"
        total += 1
        agree += verdict == take["expect"]
        for code in applied:
            if code == "loop" and not take.get("pinned"):
                continue
            value = getattr(report, CHECKS[code])
            if value is not None:
                values[code][take["expect"]].append(value)
        mark = "ok  " if verdict == take["expect"] else "MISS"
        print(f"{mark} {take['id']:<22} expect {take['expect']:<8} got {verdict:<8} camera {report.cameraDrift:>5} "
              f"behind {report.behindTextPercent:>5}%{f' (line {report.behindTextLine}, {report.behindTextAtSeconds}s)' if report.behindTextLine else ''} "
              f"loop {report.loopDifference:>5} text {report.textDrift}  {'; '.join(r for r, c in zip(report.reasons, report.failed) if c in applied)}")
    print(f"\n{agree}/{total} takes match their labels.")
    print("Per check (values from takes labelled accepted | rejected; a check need not catch every rejected take):")
    for code, groups in values.items():
        good, bad = sorted(groups["accepted"]), sorted(groups["rejected"])
        print(f"  {code:<12} accepted {good}  rejected {bad}")


if __name__ == "__main__":
    main()
