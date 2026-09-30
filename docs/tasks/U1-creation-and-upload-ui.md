# U1 · Creation page and layered upload

| | |
|---|---|
| Track | UI |
| Agent | Frontend agent |
| Depends on | T0 (build on fixtures first), B1 and B2 for integration |
| Unblocks | U2, U3 (same shell) |
| Owned paths | Shell files directly in `hosted/components/creation/` (`CreationShell.tsx`, `api.ts`, `creation.module.css`), `hosted/components/creation/upload/**`, `hosted/app/page.tsx` (entry switch only), `hosted/tests/creation-upload-*.test.tsx`. The subfolders `motion/`, `model/`, `takes/`, `export/`, `text-animation/` and `budget/` belong to U2, U3, U4 and O1 |
| Branch | `task/u1-creation-upload` |

## Why

The creator uploads a whole carousel at once, as pairs of files (background + text layer). The current UI
(`hosted/components/carousel/CarouselStudio.tsx`, stages `upload | story | preview`) is built around one flat image
per slide, a draggable movement rectangle and numeric protected-area inputs. None of that is needed now: no boxes,
no masks, no motion areas.

## Design

- **Reuse the shell**: `CreationSidebar` (history, New creation), `?carousel=<id>` style URL routing, autosave after
  edits, and the tokens and rules in `/DESIGN.md` (CSS Modules; `studio.module.css` tokens such as `--ink`,
  `--sage`; calm, editorial, light chrome; never crop the artwork; respect `prefers-reduced-motion`).
- **New creation screen**:
  1. Drop zone for many files at once. Pair files automatically by name (`name-background.*` + `name-text.png`,
     also `-bg`/`-txt`, `_background`/`_text`); anything unpaired shows as "needs a partner" with a picker.
  2. Slide rail in carousel order (drag to reorder), each card showing the flattened preview (background with text
     on top), the two file names, and upload progress per file.
  3. Upload check results from B2 per slide, in plain words: errors block that slide ("The text layer is 1080×1350
     but the background is 1122×1402"), warnings explain the automatic fix ("Letters looked slightly see-through;
     they'll be made solid").
  4. Aspect ratio label per slide (4:5, 9:16, 1:1).
- **States**: empty, uploading (per file), checking, ready, error with retry per file, saved (autosave indicator).
- **What is removed from the new flow**: movement rectangle, protected-area editor, review checkbox for regions.
  The legacy `CarouselStudio` stays reachable until O2.

## Implementation plan

1. Build the shell (`CreationShell.tsx`: sidebar, slide rail slot, panel slots that U2–U4 fill) and a mock API client
   (`hosted/components/creation/api.ts` with a mock and a real implementation behind one interface). Merge the
   shell early so U2–U4 can plug their panels into its slots.
2. Components: `CreationUpload`, `LayerPairing`, `SlideRail`, `SlideCard`, `UploadChecks`.
3. Accessibility: keyboard reorder, labels on every control, progress announced with `aria-live`.
4. Tests (vitest + Testing Library, like `hosted/tests/creation-entry.test.tsx`): pairing rules, unpaired files,
   error and warning display, reorder, autosave call.
5. Integration with B1/B2 on staging.

## Gate

- The creator uploads 20 files (10 pairs) in one drop; all pair correctly; each slide shows its checks; order and
  names survive a reload.
- Screenshots at desktop and phone width in the PR; hosted tests and `check` pass.

## Out of scope

Motion suggestions and model choice (U2), takes (U3), text animation settings (U4).
