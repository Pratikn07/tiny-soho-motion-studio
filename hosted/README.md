# Tiny Soho Motion Studio (hosted)

This is a standalone, owner-only Vercel application. Configure its Vercel project with `hosted` as the Root Directory and Node.js `24.x`.

## Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TINY_SOHO_STUDIO_ADMIN_EMAILS`
- `DASHSCOPE_API_KEY`
- `ALIBABA_WORKSPACE_ID`

Only the two `NEXT_PUBLIC_` variables are exposed in the browser. All other values stay server-side. The `creative-studio` Supabase Storage bucket is private; the app creates short-lived signed URLs only after server-side owner checks.

## Local commands

```bash
cd hosted
npm install
npm test
npm run check
npm run build
```

## Scope boundary

This app provides only the hosted Motion Studio UI, owner-gated API routes, and browser-triggered Wan job status checks. It does not run Instagram automation, Meta webhooks, Railway workers, a permanent provider worker, or any scheduled job.
