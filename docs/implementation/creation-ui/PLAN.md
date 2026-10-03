# Creation UI improvements

The user approved implementation after reviewing the scrolling audit and the small-feature recommendations. Work proceeds natively in an isolated worktree from current main. The acceptance ledger is GATES.md in this directory.

Preserve the light editorial identity, original image proportions and source lettering. Do not start paid generation or alter production records during verification. Changes are local until a production release is explicitly requested.

1. Repair take-progress label containment and scroll ownership. Correct terminal-stage labels and check messages. Verify mixed and failed take states in existing tests and a real browser.
2. Add a focused workspace sequence: Motion, Text, Review and Generate, Results. Keep upload as the initial action. Put the current stage's primary action at the inspector footer, keep file replacement/removal in a secondary menu, and expose settings scope explicitly.
3. Add history Rename, search, thumbnails and archive/restore. Persist archive state in the existing creation document, preserving backward compatibility; default a new creation's title to its first uploaded slide. Preserve selected-slide context.
4. Flush edits before switching creations; retain recoverable pending documents and revisions in session storage, scoped to the creation, and guard page departure while unsaved. Keep the editor open on save failure. Verify immediate New creation, reopening and conflict behavior.
5. Add soft-zoom and slide-in to the shared contract, browser canvas and Python finishing renderer. Use matching linear progress, fixed source pixels and exact end position. Add reset and explicit inherited/custom settings. Render small synthetic MP4s locally and compare final frames and timing.
6. Improve history contrast, H1 structure, drawer semantics and warning copy. Keep motion-risk advice actionable through choosing a safer option or replacing source files.
7. Run scoped tests, full affected suites, type checks and hosted build. Inspect desktop/mobile together, fix verified defects in one batch, and confirm once. Record evidence and review the complete diff.

Acceptance-sensitive cases: rapid edit then navigation; failed save; older documents without archive metadata; many history entries; long names; running/failed/completed takes; text without a layer; reduced-motion preview; odd image dimensions; new animation final frames; multi-slide settings and overrides.
