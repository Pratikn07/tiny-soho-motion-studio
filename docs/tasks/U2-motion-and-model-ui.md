# U2 · Motion suggestions, creator idea and model selector

| | |
|---|---|
| Track | UI |
| Agent | Frontend agent |
| Depends on | T0 (fixtures), P1 and B5 for integration |
| Unblocks | U3 (a run starts from here) |
| Owned paths | `hosted/components/creation/motion/**`, `hosted/components/creation/model/**`, their CSS modules and tests |
| Branch | `task/u2-motion-model` |

## Why

Prompt wording decides whether the camera zooms or the child wanders off, so the creator should not have to write
prompts. The AI review suggests motions with reasons; she picks one or writes her own idea, and the AI checks it.
She can also choose which model makes the video, with the cost shown first.

## Design

Per slide, a **Motion** panel next to the slide preview:

1. **Three suggestions** from the review (`SlideReview.suggestions`), safest first. Each card: the title, one line
   of what happens, a risk label (Safe / Some risk / Risky) with the reason ("may lean toward 'Start with the
   basics:'"). The prompt is hidden behind "Show details".
2. **Design advice** when the review has it ("Move the girl ~4% right for livelier motion"), shown once, dismissible.
3. **"Or describe your own"** text box. On blur or a Check button, call `idea-check`; show "Looks good" or the
   specific problem and the suggested change, with buttons "Use suggestion" / "Keep mine".
4. **Motion style**: Calm (default) or Lively, explained in words ("Lively gives bigger movement but may cross your
   text"). No numbers shown.
5. **Model selector**, set once per creation with a per-slide override: options from `GET /api/catalog` with plain
   labels, cost per clip, "Recommended" on LTX, greyed-out options with the reason when a model does not fit the
   slide. Before starting, a cost line: "About $0.06 for 2 takes · 3% of this month's budget" (from O1's budget
   endpoint when available).
6. **Billing acknowledgement** per provider the first time a paid provider is used (B5), in plain words.
7. **Buttons**: "Generate this slide" and "Generate all slides" (uses each slide's choice; shows the total cost).

States: review loading (skeleton), review failed (the text box still works: "Suggestions aren't available right
now"), idea checking, ready to generate, budget exceeded (disabled with the reason).

## Implementation plan

1. Components against T0 fixtures: `MotionPanel`, `SuggestionCard`, `IdeaBox`, `MotionStyle`, `ModelSelector`,
   `CostLine`, `BillingAck`.
2. Hook `useSlideReview(slideId)` (start review, poll review run) and `useCatalog()`.
3. Tests: suggestion selection writes `motion` into the document; idea-check "adjust" flow keeps her text unless she
   accepts; unsupported model greyed with reason; cost line totals for "Generate all".
4. Integration with P1, B5 and O1 on staging.

## Gate

- On the potty slide the creator sees three suggestions with reasons, types "she waves at the camera", gets a
  specific check result, picks LTX, sees the cost, and starts a run.
- Screenshots at desktop and phone width; hosted tests and `check` pass.

## Out of scope

Run progress and takes (U3), text animation options (U4).
