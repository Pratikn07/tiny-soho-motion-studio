# LTX GPU benchmark

A disposable test of **LTX-2.5 22B distilled** image-to-video on three Tiny Soho still slides, run on
Modal's RTX PRO 6000. It answers the roadmap's stage 2 gate
([docs/strategy/2026-09-29-tiny-soho-studio-roadmap.md](../../docs/strategy/2026-09-29-tiny-soho-studio-roadmap.md)):
does LTX keep the story, faces and layout acceptable, and how many GPU seconds does an accepted clip cost?

Nothing here uses the hosted app's plans, motion areas or prompts, and nothing touches Supabase or production.
Only the three still images are sent to Modal. Results land in `benchmarks/gpu/results/`, which is
git-ignored because the clips show children.

## How a clip is made

1. LTX receives the whole still slide and a prompt (`slides.json`) and animates the full frame.
2. `compose.py` restores only the **protected boxes** from the original still: every text line, plus logos,
   hearts, dividers, note cards and panels. Inside a box the pixels are exactly the original; a 10 px soft edge
   blends outward. Everything else stays as LTX generated it, so heads and hands can move freely.
3. Before restoring, the clip's colour is matched to the original inside those boxes (LTX renders 2–4% darker),
   so box edges do not show as a tone step.

Protected boxes come from the still images only: text lines from Apple Vision text detection
(`find_text.swift`, 0.5% margin added) and non-text brand elements measured by hand. Each box in
`slides.json` records which (`"found"`).

## One-time setup

1. Modal account with a card on file and a **$30 Workspace budget** (Usage & Billing). CLI: `uv tool install modal`,
   then `modal setup`.
2. Accept the LTX-2.5 terms at <https://huggingface.co/Lightricks/LTX-2.5>, create a Hugging Face **Read** token,
   and store it in your own terminal: `modal secret create huggingface HF_TOKEN=<token>`.
3. Download the weights (about 66 GiB, measured 375 s) into the `tiny-soho-models` Volume, CPU only:
   `modal run benchmarks/gpu/modal_bench.py::download`

## Run

```bash
modal run benchmarks/gpu/modal_bench.py
```

```bash
uv run --no-project --with pillow python benchmarks/gpu/compose.py
```

To find text boxes on a new still: `swift benchmarks/gpu/find_text.swift <image>`.

## Output

In `benchmarks/gpu/results/<timestamp>/`: `<name>.raw.mp4` (LTX output), `<name>.final.mp4` (protected boxes
restored), `<slide>.compare.mp4` (original | each clip in name order | baseline if any), `metrics.json` and
`summary.csv` with:

- `seconds`, `peak_reserved_gib`: GPU time and memory per clip (the first clip includes model loading).
- `camera_drift`: change behind the protected boxes between the first and last raw frame. Low (about 2–12) when
  the camera held still; a zoom or pan scores far higher (71 on the round-2 salmon zoom). Use it to auto-reject.
- `final_text_drift`: final clip vs original inside the boxes. About 2–3 means the text is untouched.
