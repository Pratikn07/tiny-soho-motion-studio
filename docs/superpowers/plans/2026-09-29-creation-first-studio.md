# Creation-first Tiny Soho Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the example-filled signed-in start screen with a New creation start and a saved-creation history rail; keep the existing visual carousel editor inside each creation.

**Architecture:** Keep `creative_studio_projects` as the durable backing record and use the existing `?carousel=<id>` link for an active creation. Add a small owner-scoped carousel-summary read, then make the carousel workspace start empty, create/save on the first accepted image, and navigate safely between saved creations. Extract the history and empty-start UI while retaining the existing image, story, movement, and review components.

**Tech Stack:** Next.js 15.5.25, React 19.1.1, TypeScript 5.9.2, Vitest 5.0.1, Testing Library, Supabase Auth/Postgres/Storage, CSS modules.

**Spec:** `docs/superpowers/specs/2026-09-29-creation-first-studio-design.md`

## Global Constraints

- Use the approved Tiny Soho light editorial design; preserve the original artwork's aspect ratio and the existing story, movement, review, and generation gates.
- In the interface, say “creation”; retain “project” in existing API/database records to avoid a schema migration.
- No empty backend record is created on the start screen or by clicking New creation. The first accepted upload or explicit example selection begins auto-save.
- The history contains only the authenticated owner's carousel creations; do not show projects created only in Motion & Assets or other tools.
- Do not submit NVIDIA or WAN jobs to verify navigation. Keep provider keys and the Supabase service role on the server.
- Keep current examples opt-in and clearly labelled; do not initialize the signed-in workspace with them.
- Keep existing revision-conflict protection, idempotent run recovery, and owner authorization. A failed save cannot be reported as saved or discarded by navigation.
- Do not modify the separate local Studio or Instagram automation.

## Review Focus

- A creator uploads one valid and one invalid image together: the valid slide remains and the invalid file receives an actionable error (Task 3 test).
- The first upload creates one record despite rapid edits or a repeated save click (Task 2 test).
- A save fails while the creator clicks another history item or browser Back: their draft remains visible and the URL is restored (Task 2 test).
- The project database contains non-carousel records: the history returns only owner-owned records with `carousel_document` (Task 1 test).
- An invalid or inaccessible `?carousel=` URL does not show examples or another creation, and offers a way back to New creation (Task 3 test).

---

### Task 1: Read saved carousel creations without changing the generic project API

**Files:**

- Modify: `hosted/lib/repository.ts` (`listProjects` vicinity)
- Create: `hosted/app/api/carousel/route.ts`
- Modify: `hosted/lib/api.ts`
- Create: `hosted/tests/carousel-list.test.ts`
- Modify: `hosted/tests/repository.test.ts`

**Interfaces:**

- Produce `CarouselCreationSummary = { id: string; name: string; updatedAt: string; slideCount: number }` in `hosted/lib/api.ts` and `listCarouselCreations(): Promise<CarouselCreationSummary[]>` on `createStudioApi`.
- `GET /api/carousel` returns `{ creations: CarouselCreationSummary[] }`, newest first, or the normal owner/auth error. The server derives `slideCount` from the stored `carousel_document`; it does not expose media URLs or provider data.

- [ ] **Step 1: Write the failing route/client tests.** Follow the mocking shape in `hosted/tests/carousel-routes.test.ts`. Assert the contract explicitly:

```ts
import { GET as list } from "@/app/api/carousel/route";
import { requireOwner } from "@/lib/auth";
import { StudioError } from "@/lib/errors";
const newerId = "11111111-1111-4111-8111-111111111111";
const olderId = "22222222-2222-4222-8222-222222222222";
const newerTime = "2026-09-29T12:00:00.000Z";
const olderTime = "2026-09-28T12:00:00.000Z";
vi.mocked(requireOwner).mockRejectedValueOnce(new StudioError(401, "denied", "Sign in."));
expect((await list(new Request("https://studio.test/api/carousel"))).status).toBe(401);
vi.mocked(requireOwner).mockResolvedValue({ userId: "owner", email: "owner@test" });
repo.listCarouselProjects.mockResolvedValue([
  { id: newerId, name: "Toddler meal prep", updated_at: newerTime,
    carousel_document: { name: "Toddler meal prep", slides: [{}, {}, {}] } },
  { id: olderId, name: "Salmon cakes", updated_at: olderTime,
    carousel_document: { name: "Salmon cakes", slides: [{}] } },
]);
const response = await list(new Request("https://studio.test/api/carousel"));
expect(await response.json()).toEqual({ creations: [
  { id: newerId, name: "Toddler meal prep", updatedAt: newerTime, slideCount: 3 },
  { id: olderId, name: "Salmon cakes", updatedAt: olderTime, slideCount: 1 },
] });
expect(repo.listCarouselProjects).toHaveBeenCalledWith();
```

Add a repository test following `hosted/tests/repository.test.ts`: assert the Supabase query calls `.eq("owner_user_id", "owner-a")`, `.not("carousel_document", "is", null)`, and `.order("updated_at", { ascending: false })`. This pins generic non-carousel records out of the list. Add a client test beside `hosted/tests/api.test.ts` that calls `listCarouselCreations()` and checks the mapped result.

- [ ] **Step 2: Run the focused tests and confirm they fail for missing behavior.** Run `cd hosted && npm test -- tests/carousel-list.test.ts tests/repository.test.ts tests/api.test.ts`.
- [ ] **Step 3: Implement the owner-scoped read.** Add `StudioRepository.listCarouselProjects()` selecting `id,name,updated_at,carousel_document` with `.eq("owner_user_id", this.owner.userId)`, `.not("carousel_document", "is", null)`, and `.order("updated_at", { ascending: false })`. The route calls `requireOwner(request)` before constructing the repository, maps rows into the summary interface, sets `Cache-Control: no-store`, and uses `routeErrorResponse` like the existing carousel route. Add the corresponding `createStudioApi` method. Leave `GET /api/projects` unchanged for the other Studio tools.
- [ ] **Step 4: Run the focused tests again.** Expect owner rejection, filtering, order, and client mapping to pass. Commit only this task's files.

### Task 2: Make a creation a safe, durable session

**Files:**

- Modify: `hosted/components/carousel/useCarouselWorkspace.ts`
- Modify: `hosted/components/carousel/CarouselStudio.tsx` (initial state and creation-switch callbacks only)
- Modify: `hosted/tests/carousel-workspace.test.tsx`

**Interfaces:**

- Replace the hook's generic `projects` list with `creations: CarouselCreationSummary[]` from Task 1.
- Expose `startNew(): Promise<boolean>` and `open(id: string): Promise<boolean>`. `true` means the editor may reset its selected slide/stage; `false` means navigation was blocked and the current draft stays visible. Expose `retrySave()` through the existing `save()` action.
- Preserve `analyze`, `generate`, run polling, and `CarouselDocument` persistence contracts.

- [ ] **Step 1: Extend the workspace tests with a blank initial state and first-upload save.** Change the test fixture to allow an empty `slides` array. Add assertions equivalent to:

```ts
const { result, api } = setup({ slides: [] }); // Extend the existing fixture to accept initial slides.
const localUpload: Slide = {
  ...initial,
  id: "33333333-3333-4333-8333-333333333333",
  assetId: undefined,
  src: "blob:local-upload",
};
expect(api.createProject).not.toHaveBeenCalled();
expect(result.current.workspace.project).toBeNull();
act(() => result.current.setSlides([localUpload]));
await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1));
await waitFor(() => expect(result.current.workspace.dirty).toBe(false));
```

In this fixture, mock `createProject`, `uploadCarouselImage`, and `fetch("blob:local-upload")` so persistence can complete. Test two rapid edits while that save is in flight, a repeated Save click, and a failed upload/save. The successful slide must remain local until retry succeeds; `createProject` must not duplicate the first creation.

- [ ] **Step 2: Write navigation tests.** From a dirty existing creation, `startNew()` and `open(otherId)` must save before switching. If `saveCarousel` rejects, both return `false`, keep the current slide/story, and leave `?carousel=` on the current ID. Test Back/Forward through a `PopStateEvent` with the same failure rule. A successful new start yields `slides=[]`, `project=null`, name `Untitled creation`, no selected slide, and a URL without `carousel`. Opening a saved creation hydrates signed URLs and its stored title.
- [ ] **Step 3: Run `cd hosted && npm test -- tests/carousel-workspace.test.tsx` and confirm the new tests fail.**
- [ ] **Step 4: Implement the session transitions.** Initialize `CarouselStudio` with `slides=[]`, `selectedId=""`, `projectName="Untitled creation"`, and stage `upload`. In the hook, replace the initial-example-draft comparison with a real empty-start check. Let auto-save call `persist()` when there is at least one accepted slide even if `project` is null; serialize through the existing lock so one first upload creates one record. On success, refresh the creation summaries. Make `startNew`/`open` finish pending edits before clearing or hydrating. Clear per-creation run status and paused-run state when switching, but keep the global WAN acknowledgement. Change URL only after a successful user-initiated switch; use `pushState` for New creation/open, `replaceState` for the first auto-created ID, and handle `popstate` without adding another history entry. On a failed Back/Forward save, restore the previous URL and remain on the current draft.
- [ ] **Step 5: Run the focused tests, then `cd hosted && npm run check`.** Fix any existing tests that assumed examples were preloaded, without weakening assertions about safe saves or generation. Commit only this task's files.

### Task 3: Build the start screen and creation history around the existing editor

**Files:**

- Create: `hosted/components/carousel/CreationSidebar.tsx`
- Create: `hosted/components/carousel/CreationStart.tsx`
- Create: `hosted/components/carousel/creation.module.css`
- Modify: `hosted/components/carousel/CarouselStudio.tsx`
- Modify: `hosted/tests/studio-shell.test.tsx`
- Create: `hosted/tests/creation-entry.test.tsx`

**Interfaces:**

- `CreationSidebar` receives `{ creations, activeId, busy, onNew, onOpen }`; it displays New creation, saved names, selected state, and a mobile drawer trigger.
- `CreationStart` receives `{ onChooseImages, onOpenExamples }`; paste/drop continues through the parent `CarouselStudio` handlers, so the empty state and active editor share validation and aspect-ratio behavior.
- The existing Example library action still calls `addExample`, but an example is added only after a creator explicitly chooses it.

- [ ] **Step 1: Write screen tests for empty and active states.** Assert a signed-in `/` renders “New creation,” an upload target, and any saved creation names, but not “Everyday little moments,” a selected sample, or a “Save project” button. After choosing an image, assert the editor's slide rail, source image, story panel, and creation title appear. Upload one valid and one invalid image together; expect the accepted slide and an error naming the rejected image. Open Example library and confirm it does not create a project until “Use this example” is clicked. For an invalid ID, assert a recovery action leads to the blank start.

```tsx
expect(screen.getByRole("button", { name: "New creation" })).toBeInTheDocument();
expect(screen.getByText("Paste or upload your images")).toBeInTheDocument();
expect(screen.queryByText("Everyday little moments")).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: "Save project" })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run `cd hosted && npm test -- tests/creation-entry.test.tsx tests/studio-shell.test.tsx` and confirm the new expectations fail.**
- [ ] **Step 3: Implement the new composition.** Render `CreationSidebar` beside `CarouselStudio` content. When `slides.length===0`, render `CreationStart` in the main area instead of the slide rail/canvas/inspector. When a slide exists, render the existing three-panel editor unchanged inside the creation. Remove the project selector and primary “Save project” control from the header; show creation title and accurate save status, with a retry button only on error. Keep Example library and Open existing tools accessible from both states. Replace “Open example” with “Use this example” where that action adds it to a creation.
- [ ] **Step 4: Implement responsive and accessible behavior in `creation.module.css`.** At desktop widths, reserve roughly 220–240px for history; below the width where the artwork would shrink below its current 350px minimum, collapse history into a labelled drawer. On mobile, history opens as a drawer and the editor retains its existing stacked order. New creation, saved items, upload, examples, and drawer controls need visible focus and minimum 44px touch targets. Keep images `object-fit: contain` and source-ratio sizing.
- [ ] **Step 5: Run the focused tests and inspect one desktop and one mobile browser viewport.** Verify the new start, a real saved creation, the Example library, long creation names, empty history, keyboard focus, and no clipped source image. Fix observed layout failures in one batch, then run `node /Users/pratik.nandoskar/.agents/skills/impeccable/scripts/detect.mjs --json hosted/components/carousel/CreationSidebar.tsx hosted/components/carousel/CreationStart.tsx hosted/components/carousel/CarouselStudio.tsx hosted/components/carousel/creation.module.css` once. Commit only this task's files.

### Task 4: Integrate, review, and release the UX change

**Files:**

- Modify only tests or implementation files from Tasks 1–3 when integration exposes a concrete defect.
- Update `docs/ui/carousel-workflow.md` to describe New creation, auto-save, and reopening from history.

- [ ] **Step 1: Run `cd hosted && npm test && npm run check && npm run build`, then `git diff --check`.** Confirm existing analysis, generation, review, and run-resume tests still pass. The navigational tests must not call a live provider.
- [ ] **Step 2: Review the finished branch against the spec.** Confirm every specified start/navigation/error state and desktop/mobile behavior has a corresponding test or browser observation; check that generic project tools still use their existing API and that no example is saved on first load.
- [ ] **Step 3: Open a PR from the feature branch, let CI complete, and address any failures.** Include a desktop and mobile image of the start screen and one image of the active editor in the PR description; identify any owner-only smoke step that could not be run.
- [ ] **Step 4: After release authorization, merge to `main` and deploy `hosted/` from the merge commit through the project-local Vercel account.** Verify the production alias points to the new deployment, `/api/health` returns `ok`, and an owner can create/reopen a harmless image-only draft. Do not submit a WAN video job merely to validate this navigation release.
