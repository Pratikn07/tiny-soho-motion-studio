# P5 · Automatic checks and retry policy

| | |
|---|---|
| Track | Pipeline |
| Agent | Pipeline agent (Python) |
| Depends on | P4 |
| Unblocks | B3 (verdicts), U3 (check badges), calibrating new models (P3) |
| Owned paths | `creative-vision/src/checks.py` (new), `creative-vision/src/processor.py` (new `check` operation only), `creative-vision/tests/test_checks.py`, `benchmarks/calibration/**` |
| Branch | `task/p5-checks` |

## Why

Most failures are measurable. In the benchmark, every bad take was caught by one of three numbers, and the good
takes passed. Measuring them automatically lets the pipeline retry with a new seed instead of showing the creator a
clip where the camera zoomed or the child walked behind the text.

## Design

New creative-vision operation `check`, run on the raw clip and the final:

| Check | Measure | Pass | Evidence |
|---|---|---|---|
| `cameraDrift` | Mean pixel change behind the text lines' boxes, first vs last raw frame | < 12 | Still takes 1–12; salmon zoom 71 |
| `behindTextPercent` | Sample 4 frames/s; for each line, the share of its **letter pixels** (alpha > 128) whose background changed by > 40 grey levels vs the first frame; take the worst line and moment | < 9 | Good potty takes 6.6–7.4; walked-into-text takes 10.8–36.5 |
| `loopDifference` | Mean pixel change, first vs last raw frame, whole frame | < 5 | Pinned end frame 2.3–2.8; unpinned 9.8–20.3 |
| `textDrift` | Final last frame vs cleaned text layer on letter pixels | ≤ 3 | Exact text measured 1.4–2.4 |

- Output `TakeChecks` (T0) with plain-language `reasons`, for example "The child moved behind 'Start with the
  basics:' at 1.0 s". Verdict `accepted` when all pass.
- **Thresholds live in config** per model (`calibrated` models only); they were set on few clips and must be
  rechecked. `loopDifference` only applies when the run pinned an end frame.
- **Retry policy** (applied by B3): rejected → next seed while attempts remain; after two rejections for the same
  reason, P1 is asked for a calmer suggestion (for `behindText`) or the run stops with the reasons.
- **Calibration harness** (`benchmarks/calibration/`): runs the checks over labelled takes (the benchmark clips plus
  new ones) and reports how many good/bad takes each threshold separates. Used when adding a model or changing a
  threshold.

## Implementation plan

1. Port `behind_text` from `benchmarks/gpu/animate_text.py` and `mean_difference`/camera logic from
   `benchmarks/gpu/compose.py` into `creative-vision/src/checks.py`.
2. Add `operation: "check"` returning `TakeChecks` into the vision job result.
3. Tests with synthetic clips: static (all pass), zoom (camera fails), object crossing a line (behind-text fails),
   non-looping end (loop fails).
4. Calibration harness with the labelled benchmark takes (kept outside git; the harness reads a local folder).

## Gate

- On the eight saved potty takes (the only layered slide so far): the four that walked into the text and the two
  "lively" 0.4 takes (hair behind "basics:") are rejected; the two pinned 0.6 takes are accepted.
- On the round-2 flat-slide takes, where the protected boxes stand in for text lines, the salmon zoom (seed 42)
  fails `cameraDrift` and the other five pass it. Note that understanding seed 42 scored 11.8, close to the
  limit; treat 12 as provisional.
- `python -m pytest creative-vision/tests -q` passes.

## Out of scope

Story and emotion judgement (a later optional AI look at frames, per the playbook's step 6).
