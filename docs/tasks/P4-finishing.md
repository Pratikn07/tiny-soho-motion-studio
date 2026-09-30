# P4 · Finishing: colour match and text-line animation

| | |
|---|---|
| Track | Pipeline |
| Agent | Pipeline agent (Python) |
| Depends on | T0 |
| Unblocks | P5, B3 integration, U4 (preview) |
| Owned paths | `creative-vision/src/finish.py` (new), `creative-vision/src/processor.py` (new `finish` operation only), `creative-vision/src/repository.py` (capability flag only), `creative-vision/tests/test_finish.py`, fixtures |
| Branch | `task/p4-finishing` |

## Why

The model animates only the background. Finishing puts the creator's text back, exactly her pixels, and animates
it in line by line. The benchmark's `benchmarks/gpu/animate_text.py` does this and was checked frame by frame on the
potty slide (14 lines, all in by 2.37 s).

## Design

New creative-vision operation `finish` (same claim/lease/upload flow as `compose` today):

- **Inputs**: raw video asset, text-layer asset, slide size, `TextAnimation` (T0).
- **Clean the text layer**: alpha ≥ 230 → 255, alpha ≤ 12 → 0 (fixes see-through letters and faint haze).
- **Split into lines**: a row with ink (alpha > 40) across less than 3% of the width counts as space; two or more
  such rows separate lines; each gap is cut at its thinnest row so every pixel belongs to one line. An icon and its
  word stay together.
- **Colour match**: per-channel gain so the clip's first frame matches the background still (clamped 0.8–1.25). LTX
  renders 2–4% darker; without this, edges show as a tone step.
- **Animate**: line *i* fades in from `firstAt + step × (i − 1)` over `fade` seconds while rising `rise` px into its
  exact position (defaults 0.2 / 0.14 / 0.35 / 18). `style: "none"` places all lines from frame 0.
- **Export**: slide size (doubled if odd, as today), 5.0 s, H.264 CRF 16, `yuv420p`, faststart. Upload to
  `owners/{uid}/projects/{pid}/takes/{takeId}/final.mp4` (idempotent: an existing valid file counts as done).
- **Cover frame**: also export a PNG of the fully texted frame for `coverFrame: "last"`.
- **No text layer**: export the colour-matched background clip only.
- Keep `creative-vision/requirements.txt` CPU-only (Pillow + ffmpeg); no model weights here.

## Implementation plan

1. Port `text_layer`, `lines`, `colour_gains` and `render` from `benchmarks/gpu/animate_text.py` into
   `creative-vision/src/finish.py`, keeping constants in one place.
2. Wire `operation: "finish"` in `processor.py`, advertise the capability in `repository.py`.
3. Tests: synthetic layer with known lines (count and order), haze clean-up, colour gain on a darkened clip, output
   duration and size, odd-size doubling, idempotent upload, `style: "none"`.
4. Golden check: the potty fixture (local only) produces 14 lines and `text_in_by ≈ 2.37 s`.

## Gate

- On the potty pair, the final shows each line appearing top to bottom and the last frame's text equals the
  cleaned text layer (mean difference ≤ 3 on letter pixels).
- `python -m pytest creative-vision/tests -q` passes.

## Out of scope

Checks and verdicts (P5), text animation settings UI (U4), flat-upload text protection (later).
