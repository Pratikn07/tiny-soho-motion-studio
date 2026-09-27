# Approved Carousel Studio UI

Mode: Operate. Approved by the user after the in-chat design on 2026-09-27.

Build the existing local Next.js entry point into a light editorial workspace. Retain the previous interface at /legacy. The first view uses an ordered slide rail, a generous source image stage, and a focused story inspector. The three supplied images start as labelled examples. Use the existing meal-prep video as the sole sample preview. Do not contact generation APIs or start the provider worker.

The creator can add images through file selection, drag and drop, or clipboard paste; inspect original dimensions; switch and reorder slides; edit the action; adjust a bounded movement rectangle; toggle its overlay; preview the available sample; compare it with its original; and download the sample video or a reusable story plan. New uploads start with an empty story and editable region, never fabricated analysis or a substituted sample video. Sample content must stay attached to its matching original. All interactive controls need truthful disabled states and useful recovery copy.

Use white and very light warm-gray surfaces, near-black controls, GFS Didot display lettering, and a system sans for working controls. At desktop the image dominates; on narrow screens the slide rail becomes horizontal and the inspector follows the image. Preserve source aspect ratio at every viewport. No forced crop, stretched preview, real provider progress, or false success state.

Acceptance: GATES.md. Verification includes meaningful state/geometry tests, production build, actual browser interactions and desktop/mobile visual review. The user's current approval covers implementation of this brief; do not reopen settled design choices.
