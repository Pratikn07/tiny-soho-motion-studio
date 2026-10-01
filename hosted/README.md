# Tiny Soho Studio (hosted)

This is a standalone, owner-only Vercel application. Configure its Vercel project with `hosted` as the Root Directory and Node.js `24.x`.

## Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TINY_SOHO_STUDIO_ADMIN_EMAILS`

## Creation release flag

`TINY_SOHO_CREATIONS_V2=true` makes the creation flow the home screen at `/`.
It is a server-only setting and defaults to off; unset, `false`, or an invalid value retains the old home.
Both flows require the existing Supabase sign-in and owner allowlist check. The server passes only the
flag's boolean to the browser, and reads it per request rather than freezing it into a static home page.

The creator can open **Tools → Old studio** (`/?studio=legacy`) while the flag is on.
`/?studio=creation` remains available for owner testing while it is off. Sample-data mode
(`/?studio=creation&mock=1`) works only in development and is never an authorization bypass in production.

Enable the flag in the existing hosted Vercel project's Production environment only after the ordered
backend deployment and verification in [the release checklist](../docs/architecture/hosted-creative-suite-release.md).
Redeploy the hosted app after a Vercel environment change. Set the flag to `false` and redeploy for a UI rollback.

Only the two `NEXT_PUBLIC_` variables are exposed in the browser. All other values stay server-side. The `creative-studio` Supabase Storage bucket is private; the app creates short-lived signed URLs only after server-side owner checks.

`MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `DASHSCOPE_API_KEY` and `ALIBABA_WORKSPACE_ID` belong only to the separately deployed Creative Worker. They must not be configured in Vercel.

## Local commands

```bash
cd hosted
npm install
npm test
npm run check
npm run build
```

## Scope boundary

This app provides the creation and legacy Studio interfaces, owner-gated API routes, and job-status reads. The separate Creative Worker routes generation to configured providers; creative-vision handles CPU finishing and checks. This Vercel app does not run Instagram automation, Meta webhooks, Railway workers, a permanent provider worker, or any scheduled job.
