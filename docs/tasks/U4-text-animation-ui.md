# U4 · Text animation options and preview

| | |
|---|---|
| Track | UI |
| Agent | Frontend agent |
| Depends on | T0 (fixtures), P4 for the final render |
| Unblocks | — |
| Owned paths | `hosted/components/creation/text-animation/**`, CSS module and tests |
| Branch | `task/u4-text-animation` |

## Why

Her text can now come in line by line ("TINY SOHO" first, then each line). She should be able to choose the style
and see it before spending GPU time, and choose which frame Instagram uses as the cover.

## Design

- **Options** (creation default, per-slide override), mapped to T0's `TextAnimation`: None (text there from the
  start), Fade, Fade and rise (default); Speed: Gentle / Normal / Quick (changes `step` and `fade`); Cover: "Full
  text" (last frame, recommended) or "First frame".
- **Instant preview in the browser**, no GPU: play the background still with the text layer's lines animating on
  top, using the same line-splitting rule as P4 (implemented in TypeScript on a canvas, or CSS animations on cropped
  line images). Show "All text in by 2.4 s".
- **Readability hint**: if all text is not in by 3 s, say so ("Viewers may swipe before reading the last line").
- Honour `prefers-reduced-motion` in the preview (show the final state with a play button).

## Implementation plan

1. Line splitter in TypeScript matching P4's constants; unit tests against the same synthetic fixtures as B2/P4.
2. `TextAnimationPanel` and `TextAnimationPreview` components against T0 fixtures.
3. Tests: options write `textAnimation` into the document; timing text updates with speed; reduced-motion behaviour.
4. Check that the preview's timing matches a P4 final for the potty slide within one frame.

## Gate

- On the potty slide the preview shows 14 lines appearing top to bottom, "All text in by 2.4 s", and matches the P4
  final's timing.
- Hosted tests and `check` pass; screenshots in the PR.

## Out of scope

Per-line custom ordering (later, if the creator asks), rendering the final video (P4).
