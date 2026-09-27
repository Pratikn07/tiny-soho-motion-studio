# Saved Carousel workflow

The hosted Carousel now persists projects, source image IDs, stories, protected areas, review state, and a generation snapshot. Save project uploads the initial draft; later edits autosave. A project URL reopens the saved document after refresh. Saves use revision checks and keep local edits on conflict. Download a story plan before discarding a conflicting local draft.

Uploads use a private, short-lived Supabase upload URL, then server-side image validation before registration. Blob URLs and signed download URLs are never stored in project documents. Existing allowlist authentication and owner predicates apply to every route. No new public table or storage bucket is introduced.

## Image suggestions

Set server-only `NVIDIA_API_KEY` and `NVIDIA_VISION_MODEL` in the hosted Vercel project. The model must accept image input at NVIDIA's chat completions endpoint. The adapter downsizes only the analysis copy, validates structured output, and treats image text as data. It does not run OCR or verified segmentation. Missing configuration leaves manual editing available and produces an explicit unavailable message.

References: [NVIDIA image input](https://docs.nvidia.com/nim/large-language-models/latest/advanced-use-cases/multimodal-input.html), [NVIDIA hosted vision example](https://build.nvidia.com/meta/llama-3.2-90b-vision-instruct/deploy).

## Generation and finishing

The fixed first implementation uses existing WAN 2.7 I2V for five seconds, 720P, locked camera instructions and no prompt expansion. Existing model/billing acknowledgement is required. This is not a live quota monitor; Alibaba Free Quota Only must be configured at the provider if needed.

A reviewed source/story/area snapshot and stable generation/compose keys are saved before submission. Repeated submissions recover the original jobs. The browser tracks WAN and schedules final composition when it is complete. Closing Studio does not cancel WAN; finalization resumes when the project reopens. Failures pause tracking and expose Resume saved request. Review a new attempt is explicit and may create a new billable generation.

The Vision worker must publish a `carousel_compose` heartbeat newer than five minutes before WAN submission. It restores original source pixels outside the permitted rectangle, feathers only inward, and scales WAN output to the source canvas. Encoded dimensions double for odd-sized images to keep even H.264 dimensions and the exact ratio. Exports above 16 megapixels are rejected rather than silently resized. MP4 compression can alter pixel values slightly; typography is copied from the source, never regenerated.

A rectangle and prompt cannot guarantee character identity, natural movement or no clipping. All finished videos require visual review. Preserve clearance for the whole action, including hair and hands. The original meal-prep sample remains labeled as a previous test with a known boundary defect.

## Release and verification

Apply `20260927185712_carousel_drafts.sql` before the hosted release. Deploy the updated `creative-vision` service before enabling generation. It now recovers from HTTP transport errors, refreshes capabilities every 30 seconds and extends a claimed job lease for CPU composition.

Run hosted/root tests, typechecks and builds, plus `python -m pytest creative-vision/tests -q` with FFmpeg installed. Tests cover ownership, stale saves, malformed analysis, saved retries after an interrupted response, source geometry, static text and worker recovery. Live NVIDIA access and real output quality require separate verification; a mocked-provider test does not establish them.
