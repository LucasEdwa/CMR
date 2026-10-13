# CRM

Multi-tenant CRM SaaS. See [CRM-SaaS-Sprint-Plan.md](CRM-SaaS-Sprint-Plan.md) for the roadmap.

| Path | What |
| --- | --- |
| `apps/web` | React 19 + Vite, Tailwind + shadcn/ui, TanStack Query, i18next (sv/en) |
| `apps/api` | Fastify 5, Drizzle + Postgres (RLS), pg-boss jobs, Sentry |
| `packages/shared` | zod schemas, roles, money helpers shared by web and API |

## First-time setup

Needs Node 24, pnpm 11, Postgres 15+ on `localhost:5432` and Mailpit (`brew install mailpit && brew services start mailpit`), or run both with `docker compose up -d`.

```sh
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm db:setup     # creates roles crm_owner + app_user and databases crm + crm_test
pnpm db:migrate
pnpm seed
pnpm dev          # web on http://localhost:5173, API on http://localhost:3001/api
```

Seed users (password `Password123!`): anna@acme.test (Owner), adam@acme.test (Admin), erik@acme.test (Member), vera@acme.test (Viewer) in Acme AB; sara@beta.test (Owner) in Beta AB.

**Email in development** never leaves your machine: every email (verification, password reset, invitations) lands in Mailpit at http://localhost:8025.

## Everyday commands

| Command | Does |
| --- | --- |
| `pnpm dev` | Web and API with hot reload; the API also runs the job worker |
| `pnpm test` | Unit and integration tests (API tests run against the `crm_test` database) |
| `pnpm test:e2e` | Playwright, desktop and phone; starts the dev servers if they are not running |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | What CI runs |
| `pnpm seed` | Demo data: Acme AB (200 contacts, 30 companies, 40 deals incl. two stale ones, activities, and overdue/today/upcoming tasks per user) and Beta AB (10, 3, 5). Safe to rerun |
| `pnpm seed:large` | Adds "Stor Data AB" with 20 000 contacts for speed checks (Anna is owner) |
| `pnpm seed:sample --email <you> [--workspace "Name AB"] [--contacts 50] [--companies 10]` | Adds sample contacts and companies (plus 15 deals, activities and tasks if it has none) to your own company |
| `pnpm db:generate --name <name>` | New migration from `apps/api/src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations, set up pg-boss queues and grants |

## Tenant isolation rules

- The API connects as `app_user` (no superuser, no BYPASSRLS). Migrations run as `crm_owner`.
- Every table with `tenant_id` gets RLS **enabled and forced** plus policies in a hand-written migration (`pnpm db:generate --custom --name <name>_rls`). `src/db/rls-meta.test.ts` fails CI if one is missing.
- All tenant queries go through `withTenant(ctx, tx => ...)`, which sets the context transaction-locally.
- Every mutation calls `audit(tx, ctx, {...})` in the same transaction. The audit log is append-only for `app_user`.
- Roles are enforced twice: `inWorkspace(WRITERS | MANAGERS | OWNERS)` on each route, and restrictive RLS policies on `app.role` (migration 0017). Viewers cannot write records even with a direct query; members cannot change pipelines, lists, members or invitations. An RLS refusal becomes a 403.
- `src/routes/__tests__/permissions.test.ts` calls every route as every role. A new route without an entry in its rule table fails the test.
- The `system` role is for work the server starts after its own checks (default pipeline and lists, accepting a verified invitation, background jobs). It never comes from a request; use `asSystem(tx, ctx, fn)` and keep it rare.
- "Own records only" (workspace setting): members and viewers only see contacts, companies and deals they own, enforced in RLS.
- New queues go in `src/jobs/queues.ts`; job payloads always carry `tenantId` and `userId`. Run `pnpm db:migrate` after adding one: the migrate script creates the queues.
- Task reminders: one `tasks.reminder` job per task and due date, at 08:00 in the assignee's timezone (their own, else the workspace's). The job re-checks the task before emailing, so moved, reassigned or completed tasks are skipped.

## Import and export

- CSV import (`/import`): the browser reads the file (UTF-8 or Windows-1252 from Excel), suggests a column mapping and previews the first rows with the same rules the import uses (`mapRow` in `packages/shared/src/data.ts`). The `imports.run` job then imports 250 rows per transaction, one savepoint per row, so a bad row is reported without stopping the rest.
- Duplicates: contacts match on email, companies on org number (else domain), deals on name + company. Rows repeated within the file are skipped.
- Every record an import creates or changes is listed in `import_records`; undo erases what it created and restores what it overwrote. The uploaded file is deleted once the import has run.
- Export builds the CSV in the browser from `/<object>/export` (the list's filters, up to 50 000 rows): UTF-8 with BOM, semicolons, formula-looking cells prefixed with `'`.
- Sample file with deliberate errors: `apps/web/public/samples/kontakter-500.csv` (491 good rows, 7 bad, 2 repeated).

## Keeping workspaces apart

- Every customer table has `tenant_id` with forced RLS; the API's database role cannot bypass it; the workspace comes from the session and a membership check, never from the request.
- Inside a workspace only that workspace is visible, also in `tenants` and `memberships` (migration 0018). The cross-workspace view of one's own memberships exists only without a workspace (`withUser`).
- `src/routes/__tests__/cross-tenant.test.ts` fills one workspace with a marker word and calls every route from another workspace with those ids: the marker must never come back and nothing may change. New routes are covered automatically.
- API responses are `Cache-Control: no-store`; request logs keep the path only (query strings carry names and emails).
- Email jobs (which contain login and invitation links) are deleted a minute after sending.
- The web app sends a strict Content-Security-Policy and other security headers (`apps/web/vercel.json`); notes are never rendered as HTML.
- Accounts: passwords of at least 10 characters that are not in known breaches, two-factor login (a workspace can require it), sessions that expire after 3 idle days and 30 days at most, and a security log per user. Deleting a workspace needs the owner's password and waits 7 days so any owner can cancel.
- Limits per user and per workspace on exports, search, imports, bulk changes and the dashboard; every export is in the audit log; queries stop after 15 s.
- CI runs `pnpm audit`, gitleaks and Semgrep; actions and scanner images are pinned. Dependabot proposes updates after a 14-day cooldown.
- Incidents: `docs/incident-runbook.md`. Before go-live: real contact in `apps/web/public/.well-known/security.txt`, retention for audit diffs and import error rows, and an outside security review.

## Auth

- Better Auth handles signup, verification, login, sessions and password reset (`apps/api/src/auth/auth.ts`, mounted at `/api/auth/*`). Auth tables (`users`, `sessions`, `accounts`, `verifications`) are global; workspaces, memberships and invitations are tenant tables with RLS.
- The session stores the active workspace; `authContext` re-checks the membership on every request.
- Limits: 10 failed logins per IP + email per 15 minutes (`auth/login-failures.ts`), plus Better Auth's per-IP limits and 30 invitations per workspace per hour.
- Invitation links are `/invite/<tenantId>.<secret>`; only sha256(secret) is stored. Single use, 7 days.

## Staging (not yet provisioned)

Needs the client's accounts (see "Before Sprint 0" in the plan). Then:

1. **Neon** (EU region): create the database. As the owner role, run `create role app_user login password '<strong>' nobypassrls;` and `grant connect on database <db> to app_user;`.
2. **Railway** (EU region): new service from this repo, root `/`; Railway reads `railway.json` from the repo root. Env: `APP_ENV=staging`, `TRUST_PROXY` (number of proxies in front of the API, normally `2`: Vercel and Railway's edge; check that `request.ip` in the logs is the real client IP), `DATABASE_URL` (app_user), `DATABASE_OWNER_URL` (owner; migrations run before each deploy), `WEB_ORIGIN`, `BETTER_AUTH_SECRET` (`openssl rand -base64 48`), `SMTP_URL` and `EMAIL_FROM` from the email provider (Resend or Postmark, EU), `SENTRY_DSN`, `RELEASE`.
3. **Vercel**: new project with root directory `apps/web`. Put the Railway URL into `apps/web/vercel.json`. Env: `VITE_APP_ENV=staging`, `VITE_SENTRY_DSN`.
4. Both platforms deploy on push to `main`.
