# Gates: remaining creation UI

OWNS: hosted/components/creation/text-animation/**, hosted/components/creation/takes/**, hosted/components/creation/export/**, hosted/components/creation/budget/**, hosted/components/creation/panels.ts, hosted/components/creation/mock-api.ts, hosted/tests/creation-*.test.*, creative-vision/src/finish.py, creative-vision/tests/test_finish.py, GATES.md

Scope: Finish U4, U3 and O1 budget UI against the approved task contracts, verify locally, and publish reviewable task PRs.

- [x] G1: Text preview splits cleaned layers like P4 and matches the 14-line final timing within one frame.
  CHECK: npm --prefix hosted test -- --run tests/creation-text-animation.test.tsx
  EXPECT: Test Files  1 passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=84c6ba423e893207d869dd8efbe007017bedd8eba0259388a2be0107c57769b6; exit=0; EXPECT=matched; output-sha256=1a9940f237e846e370ef21ef7d06901e6fce1c7a292404ea54790f135065812f; output-bytes=349; shell=/bin/sh; cwd=/Users/pratik.nandoskar/.codex/worktrees/creation-ui/tiny-soho-studio; path=5c2abfba0001/29 entries

- [ ] G2: Persisted runs recover after remount, polling settles, take selection and fresh signed exports work.
  CHECK: npm --prefix hosted test -- --run tests/creation-takes.test.tsx
  EXPECT: Test Files  1 passed
  EVIDENCE: pending

- [ ] G3: Budget card displays server spend, reservations, cap and accepted-clip cost with loading/error recovery.
  CHECK: npm --prefix hosted test -- --run tests/creation-budget.test.tsx
  EXPECT: Test Files  1 passed
  EVIDENCE: pending

- [x] G4: Integrated hosted suite, type-check and production build pass.
  CHECK: npm --prefix hosted test && npm --prefix hosted run check && npm --prefix hosted run build
  EXPECT: Finalizing page optimization
  EVIDENCE: automatic-evidence=v1; definition-sha256=d1197cd1f9cdae48233efcf50f8a0d6eb7fbdc0f5837615b0463019a0678f768; exit=0; EXPECT=matched; output-sha256=867e769f51b8365954a9dbe098589f33de725a125dedde89b22e1b180ce3667a; output-bytes=4415; shell=/bin/sh; cwd=/Users/pratik.nandoskar/.codex/worktrees/creation-ui/tiny-soho-studio; path=5c2abfba0001/29 entries

- [ ] G5: Desktop and phone screenshots inspected; original aspect ratio, reduced motion and controls work.
  EVIDENCE: pending

- [ ] G6: Task PRs published with scope, gate evidence and explicit live-integration limits.
  EVIDENCE: pending

- [ ] G7: Real authenticated ten-slide creator workflow survives closing/reopening with chosen downloads.
  EVIDENCE: pending; requires owner-session live providers (P1 #48 and P2 #43 remain held).

Ruling: Existing docs/tasks/U4, U3 and O1 are the supplied design and implementation plans; execute them in order with native implementation and a final independent review.
Ruling: Backend/provider tasks remain with Agent 1; do not change credentials, deploy or merge held #43/#48. Live integration stays explicitly unmet until configured providers and owner session are available.
Ruling: U4 includes the small P4 cover-frame fix exposed by review; the saved first-frame choice must affect the generated cover.

- [x] G8: First-frame covers follow animation while default covers retain the complete last frame.
  CHECK: /tmp/tiny-soho-vision-check/bin/python -m pytest creative-vision/tests/test_finish.py -q
  EXPECT: passed
  EVIDENCE: automatic-evidence=v1; definition-sha256=03c7b4bcaf1e1158b3a3a627c032f9e52305a23d5f22be1cfa4679f2c624cad3; exit=0; EXPECT=matched; output-sha256=2e9441d9eb1b58353763ea0c06cc191ca98a8347d93a8416e8d88671d9cd4556; output-bytes=110; shell=/bin/sh; cwd=/Users/pratik.nandoskar/.codex/worktrees/creation-ui/tiny-soho-studio; path=5c2abfba0001/29 entries
