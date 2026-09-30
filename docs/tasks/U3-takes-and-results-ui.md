# U3 · Progress, takes side by side, choose and download

| | |
|---|---|
| Track | UI |
| Agent | Frontend agent |
| Depends on | T0 (fixtures), B3 for integration |
| Unblocks | O2 |
| Owned paths | `hosted/components/creation/takes/**`, `hosted/components/creation/export/**`, CSS modules and tests |
| Branch | `task/u3-takes-results` |

## Why

Generation now runs on the server, may try several seeds, and rejects takes automatically. The creator needs to see
what is happening without technical detail, compare the accepted takes, pick one per slide and download the
carousel.

## Design

- **Progress per slide** from `GET /api/runs/:id` (poll every 4 s while open; nothing breaks if she leaves): plain
  steps "Waiting for the GPU", "Animating", "Adding your text", "Checking", "Ready", or "Needs a look" with the
  reason. Show "Take 2 of 3" when retrying, and the cost so far.
- **Takes side by side**: her design (still) and each take, playing in sync, with badges per check in words: "Camera
  steady", "Text clear", "Loops smoothly", or the failure ("The child moved behind 'Start with the basics:' at
  1.0 s"). Rejected takes are collapsed under "Show rejected takes" (useful for trust while thresholds are new).
- **Actions**: Choose this take, Try another take (budget-checked), Cancel, Download this clip, Download all chosen
  clips (zip or sequential downloads), Download cover image.
- **Carousel view**: all slides in order with their chosen take, so she can watch the carousel as a sequence.
- **Leaving and returning**: the sidebar shows creations with running work ("2 slides in progress").
- Reuse the existing compare slider idea from the canvas where it helps (original vs video).

## Implementation plan

1. Components against T0 fixtures: `RunProgress`, `TakeGrid`, `TakePlayer` (synced playback), `CheckBadges`,
   `CarouselPreview`, `ExportBar`.
2. Hook `useRun(runId)` with polling that stops on terminal states and resumes on focus.
3. Tests: each run state renders the right words; rejected takes hidden by default; choose writes `chosenTakeId`;
   budget-refused retry shows the reason; download links use signed URLs and refresh when expired.
4. Integration with B3 on staging (close the tab mid-run, reopen, takes are there).

## Gate

- For a 10-slide creation, the creator can follow progress, compare takes, choose, and download all chosen clips
  without help; closing and reopening the tab mid-run loses nothing.
- Screenshots at desktop and phone width; hosted tests and `check` pass.

## Out of scope

Text animation settings (U4), spend dashboard beyond the per-run cost (O1).
