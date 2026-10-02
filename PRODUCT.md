# Tiny Soho Studio

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
The owner and the owner's wife create parenting and recipe carousels. The hosted studio is private and owner-only; opening it to other creators is outside the current release.

## Product Purpose
Turn finished carousel designs into roughly five-second videos while preserving their layout and aspect ratio. Each slide has a background without words and a transparent text layer. The creator chooses an AI motion suggestion or checks her own idea, generates a take, reviews its checks, then chooses and downloads the result.

## Capabilities and Constraints
The live application is `hosted/`, deployed at [Tiny Soho Creative Studio](https://tiny-soho-creative-studio.vercel.app). With `TINY_SOHO_CREATIONS_V2=true`, the creation flow opens at `/`; **Tools → Old studio** retains the legacy hosted flow. The root local app is separate.

Gemini 3.5 Flash-Lite currently reviews the layers and flattened design, suggests motion and checks creator ideas. LTX-2.5 distilled on Modal is the default video model. Alibaba Wan remains selectable but is marked uncalibrated. Only the background is sent to the video provider; creative-vision composites the cleaned text layer with the chosen text animation and runs camera, text, collision and loop checks. The video model does not redraw the lettering. Pixel fidelity across a real ten-slide carousel still requires creator acceptance.

Creative Worker runs the durable pipeline independently of the browser. The UI reads saved per-take stages, displays elapsed time and recorded spend, and supports choosing a take, carousel preview and downloads. The private `creative-studio` bucket uses short-lived owner-authorized URLs. Provider credentials stay server-side.

The studio has a configured $50 monthly cap with reservations before provider calls and a spend ledger after jobs finish. The ledger's per-job cost is distinct from Modal workspace billing, which also includes startup/idle resources and other workspace activity. The budget popover reports that workspace billing separately; the live cap-refusal test remains outstanding.

## Brand Commitments
The user approved a light, premium editorial interface: ivory and white, black typography and controls, restrained serif headings, fine rules, generous space. The uploaded artwork leads the workspace. Controls use plain creator language.

## Evidence on Hand
As of 2 October 2026, implementation PRs #43 (LTX), #58 (takes/downloads), #65 (Gemini) and #66 (per-take progress) are merged. The #66 release recorded Vercel deployment `dpl_DsCC7gapqZRQbsPorfFJZn1Jgu4a` as Ready from main commit `4b90fb2`; production health was checked again on 2 October. Full receipts are in [the release checklist](docs/architecture/hosted-creative-suite-release.md).

The owner's first production potty-slide run `c17c7841-3982-4c16-8410-a991f4989c2e` completed with its first take accepted. Raw video, finished video and cover objects are present in the private bucket. The pipeline took about 4m 37s from run creation through final checks; the job and spend ledger record 59.1 GPU seconds and $0.0498. These figures are job-level records, not a reconciled Modal invoice. No chosen take was saved at the 2 October read-only verification.

## Remaining Acceptance Work

- Complete the real ten-slide creator workflow, including close/reopen recovery, comparison, selection and downloads; target at least eight slides accepted within two retries, with exact text and visible/capped spend.
- Record downloaded-video visual acceptance, the live cap-refusal test, Gemini's four-design quality benchmark and the optional Wan finishing/checks benchmark.
- Complete the publication checklist's AI-disclosure, licence and provider-data-terms review; this document does not certify those reviews or that a post's AI label has been enabled.
- Remove legacy compositor/region-editor paths only in a separate PR after two weeks of successful use.

## Product Principles
- Preserve the creator's finished artwork.
- Show a meaningful action with a beginning and reaction.
- Keep technical model choices out of the primary workflow.
- Keep motion clear of the text and review the suggested or custom action before generation.
- Distinguish demonstration content from an actual generated result.
