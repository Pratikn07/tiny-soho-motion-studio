# Gates: remaining creation UI

OWNS: hosted/components/creation/text-animation/**, hosted/components/creation/takes/**, hosted/components/creation/export/**, hosted/components/creation/budget/**, hosted/components/creation/panels.ts, hosted/components/creation/mock-api.ts, hosted/components/creation/CreationShell.tsx, hosted/components/creation/CreationPreview.tsx, hosted/components/creation/useCreation.ts, hosted/components/carousel/CreationSidebar.tsx, hosted/app/api/takes/**, hosted/tests/runs-routes.test.ts, hosted/tests/creation-*.test.*, docs/tasks/T0-contract.md, creative-vision/src/finish.py, creative-vision/tests/test_finish.py, GATES.md

Scope: Finish U4, U3 and O1 budget UI against the approved task contracts, verify locally, and publish reviewable task PRs.

- [x] G1: Text preview splits cleaned layers like P4 and matches the 14-line final timing within one frame.
  CHECK: npm --prefix hosted test -- --run tests/creation-text-animation.test.tsx
  EXPECT: Test Files  1 passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=84c6ba423e893207d869dd8efbe007017bedd8eba0259388a2be0107c57769b6; exit=0; EXPECT=matched; output-sha256=3066cab4e734ba1bc8f08ba32b594623f564be3cebc50388f3e38d6a6b170a5f; output-bytes=349; shell=/bin/sh; cwd=/Users/pratik.nandoskar/.codex/worktrees/creation-ui/tiny-soho-studio; path=5c2abfba0001/29 entries

- [ ] G2: Persisted runs recover after remount, polling settles, take selection and fresh signed exports work.
  CHECK: npm --prefix hosted test -- --run tests/creation-takes.test.tsx tests/runs-routes.test.ts
  EXPECT: Test Files  2 passed
  EVIDENCE: pending

- [x] G3: Budget card displays server spend, reservations, cap and accepted-clip cost with loading/error recovery.
  CHECK: npm --prefix hosted test -- --run tests/creation-budget.test.tsx
  EXPECT: Test Files  1 passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=d35d8ef3cbe263e9585ec8102d8222e1ce7e5b2c41f70cbcd95cd86ec3be0265; exit=0; EXPECT=matched; output-sha256=98c0d3bb447786373bfc0809593ca10ed30c4ec37827345cb3e35ab907015902; output-bytes=341; shell=/bin/sh; cwd=/Users/pratik.nandoskar/.codex/worktrees/creation-ui/tiny-soho-studio; path=5c2abfba0001/29 entries

- [x] G4: Integrated hosted suite, type-check and production build pass.
  CHECK: npm --prefix hosted test && npm --prefix hosted run check && npm --prefix hosted run build
  EXPECT: Finalizing page optimization
  EVIDENCE: automatic-evidence=v1; definition-sha256=d1197cd1f9cdae48233efcf50f8a0d6eb7fbdc0f5837615b0463019a0678f768; exit=0; EXPECT=matched; output-sha256=c4d2bac9599bb0378ec8c55606e636f6db4d0c683dc6faab640f1fcefdc3e6e7; output-bytes=4839; shell=/bin/sh; cwd=/Users/pratik.nandoskar/.codex/worktrees/creation-ui/tiny-soho-studio; path=5c2abfba0001/29 entries

- [x] G5: Desktop and phone screenshots inspected; original aspect ratio, reduced motion and controls work.
  EVIDENCE: Native Chrome preview inspected for U4, U3 (draft #58) and O1. U4 verified original aspect ratio, reduced-motion final frame/explicit Play and timing warning. U3 synthetic videos synchronized within 0.002 seconds; chosen carousel advanced and played its next slide. O1 details/refresh work at desktop 1440px and phones 390px/320px with no overflow or page errors. Screenshots: /Users/pratik.nandoskar/.codex/visualizations/2026/10/01/01a0f5be-e4fe-71a2-a65d-11e80d01deab/tiny-soho-{u4,u3,budget}-{desktop,phone}.png. Mock data and CPU synthetic media; no provider calls or database writes.

- [x] G6: Task PRs published with scope, gate evidence and explicit live-integration limits.
  EVIDENCE: U4 #57 merged as 5fb508a; U3 #58 published as a draft with green CI and its live gate explicitly unmet; O1 UI #59 published against main with local verification and backend/provider limits in its description. All three PRs attached to this chat.

- [ ] G7: Real authenticated ten-slide creator workflow survives closing/reopening with chosen downloads.
  EVIDENCE: unmet; mock ten-slide workflow and native browser preview pass on draft #58. Requires authenticated owner/provider execution. P1 #48 is merged; P2 #43 remains draft pending GPU validation. CLAUDE.md forbids shared-database writes without the owner's explicit yes in chat.

Ruling: Existing docs/tasks/U4, U3 and O1 are the supplied design and implementation plans; execute them in order with native implementation and a final independent review.
Ruling: Backend/provider tasks remain with Agent 1; do not change credentials, deploy or merge held #43. Live integration stays explicitly unmet until configured providers and owner session are available.
Ruling: O1 UI uses task/o1-budget-card from current main; task/o1-cost-budget belongs to Agent 1. Implement G3 and verify integration without changing backend billing or writing to the shared database.
Ruling: G2's implementation is published on draft #58 and stays unmerged until G7 passes. P2 #43 is still an open draft as verified on 2026-10-01. U3 is rebased onto main including O1 UI #59 (8d37f98); verify the combined screens before pushing.
Ruling: U4 includes the small P4 cover-frame fix exposed by review; the saved first-frame choice must affect the generated cover.
Ruling: U3 extends the shared panel/save integration so choosing a take uses the existing write queue and cannot overwrite another open creation. Mock routes load only in the development preview or tests.
Ruling: U3 adds owner-only GET /api/takes/:id/run and its authorization tests, so a previously chosen take survives a newer run. It adds the missing running count to the shared sidebar and refreshes that count on focus and while open.

- [x] G8: First-frame covers follow animation while default covers retain the complete last frame.
  CHECK: /tmp/tiny-soho-vision-check/bin/python -m pytest creative-vision/tests/test_finish.py -q
  EXPECT: passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=03c7b4bcaf1e1158b3a3a627c032f9e52305a23d5f22be1cfa4679f2c624cad3; exit=0; EXPECT=matched; output-sha256=e9aa7e69887c5b198bee1e9db3d37140aaa38308548f62482377db7a6e57b200; output-bytes=110; shell=/bin/sh; cwd=/Users/pratik.nandoskar/.codex/worktrees/creation-ui/tiny-soho-studio; path=5c2abfba0001/29 entries
