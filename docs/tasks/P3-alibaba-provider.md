# P3 · Alibaba Wan behind the router

| | |
|---|---|
| Track | Pipeline |
| Agent | Pipeline agent |
| Depends on | B5 (router, catalog), B4 (hardened job loop) |
| Unblocks | Model choice in U2 beyond LTX |
| Owned paths | `creative-worker/src/providers/alibaba.ts` (new; wraps `src/provider.ts`), `creative-worker/src/provider.ts` (only to extract), catalog entries for Wan in `hosted/lib/catalog/models.ts`, tests |
| Branch | `task/p3-alibaba-provider` |

## Why

The Alibaba path works today and stays available as a choice. It must sit behind the same `VideoProvider` interface
as LTX, so it gets the same inputs (background only, prompt, seed) and the same finishing and checks.

## Design

- Wrap the existing DashScope submit/poll code (`creative-worker/src/provider.ts`, `process-job.ts`) as
  `providers/alibaba.ts` implementing `VideoProvider`. Input media keep using 300 s signed URLs.
- **Only the background layer is sent**, never the text layer (the current flow sends the flat slide).
- **End frame**: find out whether the Wan 2.7 and Wan 3 image-to-video APIs accept a last frame (the catalog already
  lists keyframe models, which may). If yes, map `endFrame` to it; if no, mark `supports.endFrame = false` in the
  catalog so U2 can warn "may let the child walk into the text".
- **Output size**: Wan chooses its own resolution; finishing (P4) rescales to the slide size. Record the returned
  size on the take.
- **Prompt notes**: run the four known slides through Wan 2.7 once with the LTX-style prompts and note what differs
  (for example whether the static-camera sentence holds). Add a `wan` prompt profile to the playbook if needed.
- **Cost**: price per video second from the catalog; record `cost_usd` per job.

## Implementation plan

1. Extract and wrap; keep the legacy job path calling the same functions until O2.
2. Capability check for end frames (API docs plus one test call), then catalog update.
3. Benchmark: 4 slides × 1 seed on `wan2.7-i2v` through finishing and checks; results table in the PR
   (checks passed, cost). Set `calibrated` accordingly.
4. Tests with recorded DashScope responses.

## Gate

- A run with `modelId: "wan2.7-i2v"` produces a take that goes through P4 and P5 like an LTX take.
- The catalog's `endFrame` and `calibrated` flags reflect the measured result, with the evidence in the PR.

## Out of scope

Other Alibaba models (added later through the catalog after the same benchmark).
