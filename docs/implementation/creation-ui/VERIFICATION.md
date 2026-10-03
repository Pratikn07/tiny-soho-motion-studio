# Creation UI verification

Implementation snapshot before PR and release: implemented locally on `codex/creation-ui-improvements`, based on `origin/main` at `2b86934`. At this snapshot, no commit, push, production deployment, production record changes or paid generation was performed.

## Request reconciliation

| Requested improvement | Implemented behavior | Evidence |
| --- | --- | --- |
| Empty pages when scrolling | Contain the visually hidden take-stage labels inside positioned progress elements; give the workspace and inspector explicit scroll ownership. | Browser checks below; G1/G6 regression checks. |
| Ordered video creation | Upload first, then Motion → Text → Review → Results. Only the current panel appears. Primary actions remain in the inspector footer. | G1; desktop and mobile screenshots. |
| Rename chats/creations and useful history | Explicit Rename menu, useful initial title from the first slide, search, signed cover thumbnails, archive and restore. Archiving changes organization and does not cancel generation. | G2; browser rename, archive, restore and search checks. |
| Protect work during navigation | Flush queued edits before changing creation; remain open on failure; recover session drafts only after an authorized creation load. Changed revisions require an explicit recovery choice, including a conflict after automatic recovery. | G3; five navigation/recovery cases. |
| More small animation options | Soft zoom and Slide in alongside None, Fade and Fade and rise. Both canvas preview and CPU finishing use matching transforms with the original final position. | G4/G5; synthetic MP4 frame, timing, final text and cover checks. |
| Clear settings and small semantic fixes | Reset settings, explicit creation default versus slide override, future-video scope, collapsed technical details and model options, lower-overlap-risk wording, truthful failed checks. | G1/G4; manual Review/Text checks. |
| Mobile usability | Sticky current-step controls and primary action, history dialog focus, keyboard trap, Escape and focus return, inert background, stronger metadata contrast. | G6; mobile drawer checks below. |

## Browser checks

Local sample-data preview at `http://127.0.0.1:3002/?studio=creation&mock=1`:

- Desktop 1728 × 829: waiting, animating, failed and completed Results each retained a document height of 829 and width of 1728, with `scrollY = 0` after scrolling the inspector to the bottom. The final failed-state check repeated these measurements and confirmed “Generation failed” without “Checks are still running.”
- Tablet 768 × 1024: document dimensions matched the viewport. The preview and inspector fit, and the primary action remained accessible.
- Mobile 390 × 844: no horizontal overflow. Text setup had 2466 pixels of real page content; its primary-action footer ended at viewport y=844. Moving to Review showed the selected motion and Soft zoom before generation.
- Mobile history: opening focused “Close creations”; the dialog marked its background inert. Keyboard navigation stayed within the drawer; Escape closed it and restored the trigger. Rename saved the visible title; Archive hid it; Show archived and Restore brought it back; a nonmatching search showed “No creations match your search.”
- Temporary viewport overrides were cleared after responsive checks.

Screenshots: [desktop Review](evidence/tiny-soho-ui-desktop-review.jpg), [desktop failed Results](evidence/tiny-soho-ui-desktop-failed.jpg), [mobile Review](evidence/tiny-soho-ui-mobile-review.jpg).

## Verification boundaries

GATES.md contains automatically recorded test, type-check, build and CPU-rendering evidence. The final source diff passes `git diff --check`.

Browser screenshots use sample data and placeholder artwork. The fixture's completed video URLs do not provide playable provider output. Actual animation MP4 rendering was checked separately through the CPU finishing tests; production authentication, provider generation and deployed output were not exercised.

A read-only review identified history-menu spacing and the archive/running-state policy. The spacing is corrected; Archive remains reversible and explicitly does not cancel runs. Recovery also protects a whole-document draft from silent replacement of a newer revision.

The original checkout remains separate and untouched, retaining its existing changes to `hosted/.env.example`, `hosted/lib/review/reviewers.ts`, `hosted/tests/review.test.ts`, `.claude/`, `CLAUDE.md` and `eng.traineddata`.
