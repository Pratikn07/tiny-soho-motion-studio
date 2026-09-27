# Saved Carousel workflow

Implements the single-slide journey approved in chat: save artwork and edits, suggest a five-second story, review movement and protected text, generate through WAN, restore original artwork outside movement, and reopen/download the result. Retain the editorial interface and source aspect ratio. Cinema, Canvas, batch rendering and model marketplace are out of scope.

Reuse owner-gated projects/assets/jobs and the CPU Vision worker. Store validated Carousel documents with a revision on their existing project; conditional updates reject simultaneous edits. Asset IDs, not expiring URLs, are durable references. Uploads go directly to private storage using short-lived upload authorization, then server-side decoding registers the owned asset. No service key reaches the browser.

NVIDIA analysis is server-side, explicitly configured, bounded, and treated as untrusted suggestions. Users review text rectangles, motion clearance and story; analysis is never represented as accurate segmentation. Manual editing remains available when analysis is unavailable. Editing a reviewed plan revokes review.

Before submission save an immutable run snapshot and idempotency keys. Reuse existing model acknowledgement gates. Repeated network requests recover the same generation; composition similarly has a stable key. Browser reentry resumes tracking and composition. Jobs remain durable when closed; finalization resumes when Studio reopens. Generated results never silently replace the source or sample.

The compositor uses the original image outside the approved motion rectangle, protects marked rectangles, and feathers only inside the permitted area. Rescale generated frames to the original canvas while retaining exact display aspect ratio for odd dimensions. This prevents text regeneration but cannot guarantee natural motion or eliminate clipping: leave room for the entire action and require visual review of the result. Do not mark outputs publish-ready automatically.

Verification covers ownership, stale saves, malformed analysis, async race/retry recovery, all example layouts, protected pixel identity before encoding, decoded-video tolerance, odd dimensions, existing tests and both builds. A new live WAN test must wait until the connected workflow is ready; do not generate merely to test the UI.
