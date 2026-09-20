# Tiny Soho Zero Cost Media Transport Policy

Status: active product constraint as of 20 September 2026.

Tiny Soho must not create or activate Alibaba OSS, Amazon S3, Cloudflare R2, paid tunnels, a new hosted database, or another billable storage or transport service. The application must never silently fall back to one of these services.

Images use inline Base64 data URLs only where the exact model contract permits them. Local video and audio need a provider-accepted URL, so they are allowed only when the exact workspace and model have a verified zero-cost transport. An already existing provider-output URL may be reused privately until it expires. An explicitly supplied public HTTPS URL may be used only after server-side validation; the browser never fetches it and never receives a temporary provider locator.

The current capability state for Bailian temporary upload is `probe-required`. The official `bl` CLI is not installed on this machine, and no local runtime credential is present. Tiny Soho must not auto-install the CLI, switch regions, reverse engineer an upload endpoint, or submit a generation task to test this capability. An operator may run the documented no-generation probe after installing the official CLI and confirming that the active Singapore profile matches the application workspace. A failed probe is a supported outcome: the application must report local URL-required media as unavailable while retaining image-only and approved existing-public-URL paths.
