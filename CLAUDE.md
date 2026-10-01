# Tiny Soho Studio

The product is `hosted/` (Next.js + Supabase, deployed on Vercel). `creative-worker/` runs jobs,
`creative-vision/` is the Python vision service. The root Next.js app (`app/`, `/legacy`, local SQLite)
is the old local studio: leave it alone unless asked, but CI still builds it, so don't break it.

## Checks (run the ones for the package you touched; this is what CI runs)
- hosted: `npm --prefix hosted test` · `npm --prefix hosted run check` · `npm --prefix hosted run build`
- creative-worker: `npm --prefix creative-worker test` · `npm --prefix creative-worker run check`
- creative-vision: `python -m pytest creative-vision/tests -q` (locally use `.venv/bin/python`; create it with
  `python3 -m venv .venv && .venv/bin/pip install pytest==8.4.2 -r services/vision/requirements.txt`)
- root: `npm test` · `npm run check` · `npm run build`
- services/vision: `python -m unittest discover -s services/vision/tests -p "test_*.py"`
Report failures with the failing test name and error, not the full log.

## Dev servers
hosted on 3002 (`npm --prefix hosted run dev`) · root on 3001 (`npm run dev`, also starts the worker) ·
root UI only on 3011 (`npm run ui:dev`). Use `.claude/launch.json` entries, not Bash.

## Where things are
- Task specs: `docs/tasks/<ID>.md` (T0, B1-B5, P1-P5, U1-U4, O1-O2). Read the one for the task, not all.
- Current state: `docs/architecture/current-runtime-state.md`. Product: `PRODUCT.md`. UI: `DESIGN.md`.
- Migrations: `supabase/migrations/`. `supabase/proposed/` and `supabase/staging/` are drafts, not applied.

## Database: ask first
The only Supabase project is the shared `insta-automation` one (also used by the Instagram app). No
separate staging, no backups. Never run `supabase db push`, apply a migration, or write data without
the owner's explicit yes in chat. When approved: push from a clean `origin/main` checkout, run
`supabase migration list --linked` and `supabase db push --dry-run` first, take a schema-only dump,
then push and `supabase unlink`. Never put the DB password or keys in chat.

## Shared checkout
Several agents work on this repo, often in sibling worktrees (`tiny-soho-u1`, `tiny-soho-u2`). Run
`git branch --show-current` before editing; this checkout may be on another agent's branch.
