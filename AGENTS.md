## Cursor Cloud specific instructions

This repo has no root workspace. Install and run each app in its own directory (`apps/mobile`, `apps/admin`, `apps/facade-tool`, `wpress-converter`, `outreach`). Standard scripts are in each `package.json` and in the root `README.md`.

- Local Supabase does not start from systemd here. Start Docker with `sudo dockerd` if the socket is missing, then run `supabase start` in the repo root. API is `http://127.0.0.1:54321`, Postgres `54322`, Studio `54323`. Put the anon key from `supabase status -o env` into `apps/mobile/.env`, `apps/admin/.env`, and `apps/facade-tool/.env.local`.
- Signup fails on this local stack until `ALTER FUNCTION public.handle_new_user() SET search_path = public;` has been applied. The auth role does not see `public.profiles` otherwise.
- Creating a project as a signed-in admin returns Postgres `42P17` (infinite recursion on `project_members`) with the checked-in policies. The admin UI cannot create a project until those policies stop selecting `project_members` or `profiles` from inside their own policies.
- `apps/admin` `npm run lint` currently exits non-zero on `react-hooks/set-state-in-effect` in the page components.
- `outreach` is a browser app (`npm run dev` → http://localhost:3100): upload CSV, analyze, preview, send. For Vercel deploy use a dedicated repo with Upstash Redis (`UPSTASH_REDIS_REST_*`). See `outreach/README.md`. and writes `out/tulokset.csv`. It does not send mail unless `--send` is passed. Free path: PRH + site scrape + Instagram via `curl` + `MAIL_PROVIDER=gmail|brevo`. AI is optional (`AI_API_KEY`). See `outreach/README.md`.
