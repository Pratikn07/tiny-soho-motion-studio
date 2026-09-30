# B2 · Upload checks

| | |
|---|---|
| Track | Backend |
| Agent | Backend agent |
| Depends on | B1 |
| Unblocks | U1 (check results), P1 (clean inputs) |
| Owned paths | `hosted/lib/upload-checks.ts` (new), `hosted/tests/upload-checks.test.ts`, test fixtures under `hosted/tests/fixtures/layers/` |
| Branch | `task/b2-upload-checks` |

## Why

Problems that code can measure exactly should be caught at upload, free and instantly, before any AI or GPU spend.
The first real layered pair (potty) had letters only 82–99% opaque and a faint 1–4% haze around the text, typical
of a background-removal tool rather than a direct export. Mismatched sizes or a white (not transparent) text layer
would break the finishing step.

## Design

`runUploadChecks(background, textLayer) → UploadCheckResult` (T0), using `sharp`:

| Code | Rule | Severity |
|---|---|---|
| `size_mismatch` | Background and text layer pixel sizes differ | error |
| `no_alpha` | Text layer has no alpha channel, or is fully opaque | error |
| `text_not_solid` | Share of letter pixels with alpha 231–254 above 5% of letter pixels | warning ("letters look slightly see-through; they will be made solid") |
| `text_haze` | Pixels with alpha 1–12 above 1% of the image | warning ("a faint haze will be removed") |
| `ratio_unsupported` | Aspect ratio outside 9:16 … 16:9 | error |
| `too_large` | Over 25 MB or 40 MP (existing limits) | error |
| `background_has_text` | Optional, later: text detection on the background finds words | warning |

Also returns `textLayer` stats (solid, partial, haze percentages, line count using the same line-splitting rule as
P4) and the `generationSize`: about 768×960 pixels' worth (737,280 px) at the slide's ratio, each side rounded to a
multiple of 64 (the formula in `benchmarks/gpu/modal_bench.py:generation_size`).

The clean-up itself (alpha ≥ 230 → 255, ≤ 12 → 0) happens in P4 at finishing time, so the stored layer stays the
creator's original file.

## Implementation plan

1. Implement `hosted/lib/upload-checks.ts` with pure functions over raw pixel buffers so it is unit-testable.
2. Share the line-splitting rule with P4 by copying the algorithm and its constants (rows with ink across under 3%
   of the width count as gaps; cut each gap at its thinnest row) and testing both against the same fixtures.
3. Wire it into B1's `PUT .../layers` response.
4. Fixtures: the potty pair (git-ignored locally; generate a synthetic pair with the same properties for CI), a
   white-background text layer, a size-mismatched pair, a 9:16 and a 1:1 pair.

## Gate

- The synthetic potty-like pair returns warnings `text_not_solid` and `text_haze`, `lines = 14`, and
  `generationSize = 768×960`; the white text layer returns `no_alpha`; the mismatched pair returns `size_mismatch`.
- 9:16 and 1:1 fixtures return sizes that are multiples of 64 and within 10% of the target pixel count
  (9:16 → 640×1152; 1:1 → 832×832, 6% under, because each side rounds to 64).

## Out of scope

Judgement calls (subject too close to text, story ideas): P1.
