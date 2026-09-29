# Creation-first Tiny Soho Studio design

## Decision and purpose

The signed-in Studio opens as a creation workspace, not as a prefilled example carousel. A creator starts a new creation or reopens one from a ChatGPT-style history rail. A creation is one carousel containing up to 20 slides; it is not one slide, one video, or a simulated conversation. Opening a creation reveals the existing visual editor: slide rail, original artwork, and story/movement inspector. “Project” remains the persistence term in the API and database, but the primary interface calls it a **creation**.

The audience is a creator or marketer with finished artwork, often with embedded typography. Their first action is to paste or upload images, then review a five-second story and the permitted movement area. The source pixels, layout, and aspect ratio remain the source of truth. This change is about finding and resuming work; it must not imply that image analysis or video generation is already complete.

## Why the current entry is wrong

`CarouselStudio` initializes with three example slides, selects the meal-prep slide, names the draft “Everyday little moments,” and starts at “Shape story.” `StudioShell` mounts that editor immediately after owner authorization. `useCarouselWorkspace` restores only a `?carousel=` link and otherwise leaves the sample draft active. Its save action creates a backend project when one does not exist. Consequently, a returning creator lands inside example work and sees project management before they have supplied an image.

## Information architecture

- **`/` without `?carousel=`:** Show a calm, empty “New creation” start state with one dominant paste/upload target and a secondary link to the Example library. The history rail lists the owner's saved carousel creations, newest first. No example slide is selected or silently saved.
- **`/?carousel=<id>`:** Open that saved creation in the visual editor. The history rail marks it active. Refreshing the URL restores its images, story, protected areas, run state, and generated result as the existing durable workflow does.
- **New creation:** A persistent action at the top of the history rail returns to the empty start state. An untouched start state creates no backend record. The first accepted image or explicit choice to use an example starts a draft and saves it automatically. A carousel's later slides stay in that same creation.
- **Examples:** Keep the existing three examples in an explicit library. Viewing an example is clearly labelled as sample material; choosing “Use this example” adds it to the current/new creation. Examples never populate the default screen or imply fresh provider output.
- **Other tools:** Keep the existing Motion & Assets, Director, Workflows, and Vision entry reachable through a secondary Studio tools action. Existing non-carousel projects do not appear in the creation history.

## Screen and interaction design

Keep Tiny Soho's approved light editorial world: ivory work surface, white controls, near-black type, restrained sage states, Didot display headings, fine rules, and uncropped artwork. The new start state should feel like the first page of the same studio rather than a different product. A concise heading can ask “What would you like to bring to life?”; the upload target explains that images may be pasted, dropped, or chosen and retain their original proportions.

On desktop, a narrow creation-history rail sits to the left of the current visual studio. The existing slide rail remains inside the active creation; these two rails have distinct labels and jobs. At widths where both rails would squeeze the artwork or inspector, the history rail becomes a toggleable drawer. On mobile, creation history is a drawer, upload is the first prominent action, and the active editor retains its current stacked slide/image/inspector order. Keyboard users can reach New creation, each saved creation, upload, examples, and the editor in reading order. Opening or starting a creation moves focus to its heading; opening the history drawer returns focus to its trigger when closed.

```text
Start:   [Creation history] [New creation: paste / drop / choose images]
Editing: [Creation history] [Slides] [Uncropped artwork] [Story + movement]
Narrow:  [History drawer]   [Slides / artwork / story in existing order]
```

The saved-project dropdown and prominent “Save project” button leave the primary header. Show a small “Saving… / Saved / Needs attention” state near the creation title and an explicit retry action after save failure. The name is editable once work begins, defaulting to “Untitled creation”; a creator may rename it at any time. Existing backend revision checks and owner checks remain in force.

## Transitions and failure behavior

| Situation | Expected behavior |
| --- | --- |
| First visit or `/` with no creation ID | Empty start, saved creation history if any, no project creation. |
| Paste/drop/select several supported images | Validate each image; add accepted slides to one creation; select the first accepted slide; begin save and show progress. |
| Upload or save fails | Keep the local images and story visible; show a retryable error; do not navigate away or claim “Saved.” |
| Click another creation or New creation while edits are pending | Finish the current save first; if it fails, remain in the current creation with edits intact. |
| Refresh a saved `?carousel=` URL | Restore the same creation and selected first slide without injecting examples. |
| Open an invalid, missing, or inaccessible creation ID | Show a recoverable message and the history/start state; never show another owner's content. |
| Browser Back/Forward | Navigate between the previously visited creation and start URLs without losing unsaved edits. |
| Open Example library | No provider call or backend write until “Use this example” is chosen. |

## Boundaries and acceptance

The change reuses the existing owner-gated Supabase project, asset, and carousel persistence. It may add an owner-scoped carousel-summary read endpoint; it does not require a migration, a new data store, a chat transcript, a model marketplace, or a new video job. No WAN or NVIDIA request is part of a navigation smoke test. A code release is complete only when the blank start, new-creation auto-save, old-creation resume, history filtering, error recovery, desktop/mobile layout, and current video review path are verified. Production verification should confirm the deployed commit and owner-visible navigation without submitting a billable video job.
