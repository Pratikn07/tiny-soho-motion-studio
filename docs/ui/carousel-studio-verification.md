# Carousel Studio UI verification — 2026-09-27

Initial UI verification was performed locally on `codex/carousel-studio-ui`. The release integration below extends that UI to the hosted application; deployment status is recorded in the release PR and deployment history.

## Working workflow

- Upload PNG, JPG or WebP through the file picker, drag and drop, or clipboard. Invalid, empty, oversized and undecodable images produce recovery messages.
- Keep the original image proportions. Browser checks covered the source artwork plus uploaded 9:16, 1:1 and 4:5 images.
- Select, reorder, remove and restore slides; maintain independent story drafts.
- Choose authored example ideas or write a story. Adjust the movement area by pointer, keyboard or sliders. Marked sample text collisions prevent plan approval until corrected.
- Play the existing meal-prep sample, compare it with its original, seek through the clip, and download the video or JSON story plan.
- Recover from an empty project with uploads or the example library. Keyboard users can dismiss dialogs and reach labelled controls.

## Verification

Seven model tests passed. The Next.js production build passed, including types and route generation. The root typecheck now excludes the independent `hosted/` application, whose path aliases belong to its own build.

The automated browser pass covered 18 interaction/layout checks at desktop 1440×1000, desktop 1440×900 and mobile 390×844. It recorded zero browser exceptions and zero `/api/` requests. Local evidence and screenshots are in `.tiny-soho/ui-review/`.

The design detector reported no findings. Independent finish review disposition: **Approved for this milestone**.

| Material finding | Final status |
| --- | --- |
| Missing space in the mobile headline | Resolved in the rendered mobile screenshot and text assertion |
| Desktop primary action below the initial viewport | Resolved at 900px and 1000px heights; inspector body scrolls while its action stays visible |

## Explicit boundaries

This is a UI milestone. The example stories and protected text regions are manually prepared. New uploads are not automatically analyzed. No generation APIs were called; the previous WAN test is clearly labelled and its existing hair/caption artifact is disclosed. Editing the story does not change that sample. Drafts and uploaded images are held for the current browser session; JSON export preserves the story plan before a refresh.

The separate `/legacy` page retains the earlier local interface. `npm run ui:dev` and `npm run ui:start` start only Next.js, without the provider worker. The preview URL is http://127.0.0.1:3011.

## Hosted release integration

The canonical editor, its sample artwork, the existing video and licensed font live under `hosted/components/carousel` and `hosted/public`. The local app re-exports the editor and links the same static assets. Hosted production builds are self-contained.

The hosted entry point checks `/api/session`, which reuses the server-side owner allowlist. Signed-out visitors see the existing login form; denied accounts never mount the editor. The editor stays mounted when switching to existing tools, preserving the session draft and pausing sample playback. Legacy styles are scoped to their own wrapper. CI now runs the hosted tests, typecheck and production build alongside the existing root and worker checks.

The new screen remains a UI preview: uploads stay in memory, only the existing sample video is playable, and no provider jobs are submitted. Refreshing or signing out discards the session draft.

Release integration verification: 48 root test files / 168 tests and 24 hosted test files / 66 tests pass, both production builds and both typechecks pass, and an independent source review found no remaining blockers. The shared sample asset played successfully in the rebuilt local browser.
