# Creative Worker

The worker executes durable creative jobs and exposes `/health`. Modal LTX and Alibaba generation behavior is unchanged by the billing display.

`GET /billing/modal?month=YYYY-MM` is a read-only summary for the current UTC month. The hosted owner-only server signs the exact method, path/query and timestamp with the existing shared `SUPABASE_SERVICE_ROLE_KEY`. Requests must arrive within one minute; raw keys are never transmitted. `/health` remains public. Invalid billing requests cannot start a provider call.

The Docker image includes Python and the pinned official Modal SDK 1.6.0 because its documented `Workspace.billing.summary` API is available in Python. `src/modal_billing.py` normalizes amounts after non-credit adjustments, then adds back applied credits to derive usage before credits. Tokens come from `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` in the worker environment. Do not put them in Vercel. Local development can set `MODAL_BILLING_PYTHON` to a Python executable with that SDK installed; production defaults to `/opt/modal-billing/bin/python`.

Each summary has a 12-second subprocess timeout and a 16 KB output limit. Concurrent reads share a request and results are cached for one minute. Failure retains same-month figures with a stale marker and the original update time; another month starts unavailable. No remaining-credit balance is inferred. Neither the billing read nor its normalization invokes a Modal function or starts GPU generation.

Validate with `npm test`, `npm run check`, and `python3 -m unittest discover -s tests -p 'test_*.py'`. Deploy the worker before enabling `CREATIVE_WORKER_BILLING_URL` on the hosted app. Each production deploy requires its own user approval.
