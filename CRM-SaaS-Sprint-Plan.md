# CRM SaaS Sprint Plan

Oct 12, 2026 · @lucas · v2

## How this plan works

Ten one-week sprints (0–9) take the CRM from the current scaffolds to a sellable MVP on production by Dec 18, 2026. Phase 2 (Sprints 10–16) then brings it to a standard sales CRM at the level of Pipedrive, in an order set by beta feedback. Claude writes the code. Each sprint, your job is to start it, test the listed functions, demo it to the client, and then approve it or send it back.

**Words used in this plan**

- **Workspace:** one customer account (a tenant), for example Acme AB. Everything in a workspace is isolated from other workspaces.
- **Company:** a CRM record for an organisation that a workspace sells to. It is a record inside a workspace, not a workspace itself.

**Sprint calendar**

| Sprint | Week of | Name |
| --- | --- | --- |
| 0 | Oct 12 | Foundation |
| 1 | Oct 19 | Auth, workspaces and settings |
| 2 | Oct 26 | Contacts and companies |
| 3 | Nov 2 | Deals and pipelines |
| 4 | Nov 9 | Activities, tasks and notifications |
| 5 | Nov 16 | Import, export, search and duplicates |
| 6 | Nov 23 | Dashboard, roles and audit log |
| 7 | Nov 30 | Custom fields and files |
| 8 | Dec 7 | Billing and plans |
| 9 | Dec 14 | GDPR, hardening and go-live |
| Beta | Jan 11, 2027 | 2–3 beta workspaces, 2 weeks of feedback, then a fix sprint |

**Sprint loop (every sprint)**

1. **Kickoff (Monday):** paste the kickoff prompt (last section) into Claude Code in the repo.
2. **Build:** Claude creates a branch `sprint-N`, builds the stories, writes unit tests and a Playwright test for each "You test" item it can automate, runs everything, and opens a PR.
3. **Run it:** run `pnpm dev`, open `localhost:5173`, and log in as the seed users.
4. **Test:** tick each box under "You test". Send anything broken back to Claude using the bug report prompt.
5. **Review:** skim the PR using the review checklist and check that CI is green.
6. **Merge:** merge to `main`. Staging redeploys automatically.
7. **Demo (Friday):** walk the client through staging for 20 minutes. The client approves the sprint or lists changes. A change that is outside the sprint's scope goes to the backlog, not into the running sprint.

The Playwright tests accumulate across sprints, so CI re-checks the old features in every later sprint. That means your manual testing only has to cover the new work.

**Seed users (created in Sprint 0, used in every test)**

| User | Workspace | Role |
| --- | --- | --- |
| anna@acme.test | Acme AB | Owner |
| adam@acme.test | Acme AB | Admin |
| erik@acme.test | Acme AB | Member |
| vera@acme.test | Acme AB | Viewer |
| sara@beta.test | Beta AB | Owner |

Comparing Acme and Beta is how you test isolation by hand: Beta must never see anything from Acme. All seed passwords are `Password123!` (dev and staging only).

**Seed data:** `pnpm seed` gives Acme 200 contacts, 30 companies, 40 deals and some activities. Some of the names contain å, ä and ö, and some deals are deliberately stale or overdue. `pnpm seed:large` adds 20,000 contacts for performance checks.

## Before Sprint 0: confirm with the client

Every decision below has a default. If the client doesn't answer, Claude builds the default.

| Decision | Default | Needed by |
| --- | --- | --- |
| Is this a SaaS sold to many companies, or a CRM for the client's own team only? | SaaS (this plan). If it is for their own team only, drop Sprint 8 and the super-admin page. | Sprint 0 |
| Who owns the accounts (GitHub, Vercel, Railway, Neon, Stripe, Sentry, email domain)? | The client owns them and invites you as admin. | Sprint 0 |
| Product name, domain, logo, colours | Placeholder name and neutral theme | Sprint 0 |
| Languages | Swedish and English, chosen per user | Sprint 0 |
| Leads: a separate Lead object, or a lifecycle stage on Contact? | Lifecycle stage (lead > qualified > customer), which is simpler | Sprint 2 |
| Plans, prices and limits | Starter and Pro, per seat per month in SEK, with a 14-day trial | Sprint 8 |
| Who reviews the privacy policy, DPA and terms? | The client's lawyer | Sprint 9 |
| Do their target customers mostly use Gmail or Outlook? Do they use Fortnox? | Gmail first, Fortnox in Phase 2 | Phase 2 order |

## Sprint 0: Foundation

**Goal:** an empty app that runs locally and on staging, with tenant isolation, the audit log, background jobs, translations and error tracking in place before any feature exists.

**Claude builds**

- Monorepo: move `CMR-facility/` to `apps/web` (React + Vite) and `Backend/` to `apps/api`, switching the API to Fastify (the current Express code is a hello-world, so nothing is lost). Add `packages/shared` for zod schemas. Use pnpm + Turborepo on Node 24 LTS. Make the first commit and push to GitHub.
- Postgres in Docker, Drizzle migrations, and an `app_user` role without BYPASSRLS.
- `tenants`, `users` and `memberships` tables with RLS, plus the `withTenant()` helper.
- A `audit_log` table and an `audit()` helper that every mutation calls from Sprint 2 onward. The viewer comes in Sprint 6.
- Background jobs with pg-boss on the same Postgres, used later for reminders, imports and emails.
- i18n (Swedish and English) and sv-SE formatting for dates, numbers and money (`1 999,50 kr`), with Europe/Stockholm as the default timezone.
- UI kit: shadcn/ui + Tailwind, with the client's logo and colours as theme tokens.
- Sentry for web and API, and structured logs in the API.
- Tests: Vitest for unit and integration tests, Playwright for e2e with a login helper per seed user, the RLS isolation suite, and the meta-test that fails if any tenant table lacks RLS.
- The seed scripts, including the five seed users.
- GitHub Actions CI (lint, typecheck, unit, integration, e2e) and a staging deploy (Vercel + Railway + Neon, all in an EU region).

**You test**

- [ ] `pnpm dev` starts web and API with one command
- [ ] `pnpm test` runs, and the isolation tests pass
- [ ] The staging URL loads a placeholder page in the client's colours
- [ ] Switching the language between Svenska and English changes the placeholder text
- [ ] A test error thrown from the API shows up in Sentry
- [ ] A push to `main` redeploys staging automatically
- [ ] CI goes red if you break a test on purpose

## Sprint 1: Auth, workspaces and settings

**Goal:** a new customer can sign up, create their workspace, set it up, and invite a colleague.

**Claude builds**

- Signup, email verification, login/logout (httpOnly session cookie) and password reset.
- Rate limits on login, signup, password reset and invites.
- Transactional email through a provider (for example Resend or Postmark, with EU data storage) using SPF/DKIM on the staging domain. Mailpit catches email locally.
- Workspace creation (name, slug, optional org number).
- Invitations with a role (Owner, Admin, Member, Viewer). Owners and Admins can remove a member.
- A workspace switcher, and the app shell (sidebar, top bar, settings page).
- Settings: workspace profile, currency (SEK), timezone and date format. Each user also picks their own language.

**You test**

- [ ] Sign up with a new email; the verification email arrives (in Mailpit locally, in a real inbox on staging) and the link works
- [ ] After verifying, you create a workspace and land in an empty app
- [ ] Invite a second email as Member and accept the invite in another browser; both users see the same workspace
- [ ] An expired or already-used invite link is rejected
- [ ] Logged out, every app URL redirects to login, and after logging in you land on the page you asked for
- [ ] Password reset works end to end
- [ ] 10 wrong passwords in a row gets you rate-limited
- [ ] Remove Erik from the workspace; his open session loses access on the next click
- [ ] Switch to Svenska; the whole app shell is translated

## Sprint 2: Contacts and companies

**Goal:** the core of the CRM, which is storing customers.

**Claude builds**

- Contacts with name, emails, phones, title, company, owner, lifecycle stage, lead source, address, tags, and consent (marketing opt-in and its legal basis).
- Companies with name, org number (validated), VAT number, domain, industry, size, address and owner. A new contact is suggested to belong to the company whose domain matches their email.
- List views with server-side pagination, search, filters, sorting and a column chooser.
- Saved views, either private or shared with the workspace.
- Detail pages with related records.
- Soft delete with a Trash page where items can be restored for 30 days.
- An audit entry for every create, edit and delete.

**You test**

- [ ] Create 5 contacts and 2 companies; link contacts to a company
- [ ] Search by name and by email finds the right contact
- [ ] Filter by owner and tag, and sort by created date
- [ ] Save the filtered list as "My leads"; it is still there after a reload. Erik sees it only after you share it.
- [ ] Two contacts with the same email in the same workspace are blocked; the same email in Beta AB is allowed
- [ ] An invalid org number (wrong checksum) is rejected
- [ ] Delete a contact; it disappears from lists. Restore it from Trash; it comes back with its links intact.
- [ ] With `seed:large` loaded, the contact list and search each respond in under 1 second
- [ ] **Isolation:** log in as sara@beta.test; Acme's contacts are invisible, and opening an Acme contact URL directly shows "not found"

## Sprint 3: Deals and pipelines

**Goal:** follow sales from first contact to won or lost.

**Claude builds**

- Multiple pipelines with editable stages, each stage with a win probability.
- Deals with name, value (stored in öre), currency, stage, owner, expected close date, contacts and company.
- A Kanban board with drag-and-drop, a list view, and stage totals (count and sum).
- Won/lost, where a lost deal needs a reason.
- A stage history with time spent in each stage.
- A stale indicator on deals with no activity for N days (default 14).
- A picklist editor in settings for lead sources, lost reasons and industries.

**You test**

- [ ] Create a deal from a contact page; it appears in the first stage
- [ ] Drag a deal between stages and refresh; it stays where you put it
- [ ] Stage totals (count and SEK sum) update correctly
- [ ] Mark a deal lost; you must pick a reason, and the reasons can be edited in settings
- [ ] Rename, add and reorder stages in settings
- [ ] Create a second pipeline called "Renewals" and switch between the two boards
- [ ] Values like 1 999,50 kr display and save without rounding errors
- [ ] The seeded stale deal shows as stale on the board

## Sprint 4: Activities, tasks and notifications

**Goal:** log every interaction and never miss a follow-up.

**Claude builds**

- Activities on contacts, companies and deals: notes (rich text, can be pinned), calls (with outcome and duration), meetings, and manually logged emails.
- A unified timeline.
- @mentions in notes.
- Tasks with title, due date and time, assignee, priority and related record.
- A "My tasks" view split into Today, Overdue and Upcoming, with overdue highlighting.
- The next task's date shown on each deal card.
- Reminder emails sent by a background job in each user's own timezone.
- An in-app notification bell for assigned tasks, reminders and @mentions.

**You test**

- [ ] Log a call on a deal that has a contact and a company; it shows on all three timelines
- [ ] Create a task due yesterday; it shows as overdue in My tasks
- [ ] Assign a task to erik@acme.test; it appears in his My tasks (not yours), and he gets a notification
- [ ] @mention Erik in a note; he gets a notification that links to the record
- [ ] Complete a task; it moves to done
- [ ] The reminder email for a task due today arrives that morning (Stockholm time)
- [ ] The deal card shows the date of the deal's next task

## Sprint 5: Import, export, search and duplicates

**Goal:** customers can bring in their existing data, keep it clean, and find anything fast.

**Claude builds**

- CSV import for contacts, companies and deals, running as a background job, with column mapping and a preview.
- Dedupe on import (contacts by email, companies by org number or domain), an error report, and undo for a whole import.
- CSV export of any list using its current filters, in an Excel-friendly format (UTF-8 BOM, semicolon separator).
- Global search with Ctrl/Cmd+K, plus a list of recently viewed records.
- Bulk edit, reassign and delete.
- A duplicate finder for contacts, and a merge where you pick which value to keep for each field.

**You test**

- [ ] Import a CSV of 500 contacts (Claude provides a sample with some bad rows)
- [ ] Bad rows are listed in the error report, and good rows are imported
- [ ] Importing the same file twice creates no duplicates
- [ ] Undo an import; everything it created is removed
- [ ] Export a filtered list; the CSV opens correctly in Excel with å, ä and ö intact
- [ ] Ctrl/Cmd+K finds a contact, a company and a deal
- [ ] Bulk reassign 20 contacts to Erik
- [ ] Merge two duplicate contacts; the activities and deals from both end up on the surviving contact

## Sprint 6: Dashboard, roles and audit log

**Goal:** managers see the numbers, and permissions are enforced everywhere.

**Claude builds**

- A default dashboard that can be filtered by user and period. It shows pipeline by stage, weighted pipeline, won/lost this month, win rate, activities per user and overdue tasks.
- Roles (Owner, Admin, Member, Viewer) enforced in both the API and RLS, plus a permission-matrix test that checks every route against every role.
- An optional "members see only their own records" setting.
- An audit log viewer for Admins, filterable by user, record and date.

**You test**

- [ ] The dashboard numbers match what you count by hand
- [ ] As erik@acme.test (Member), settings and user management are hidden, and calling those API routes directly returns 403
- [ ] adam@acme.test (Admin) can manage users but cannot delete the workspace or see billing
- [ ] Turn on "own records only"; Erik sees only his own contacts and deals
- [ ] Edit a contact; the audit log shows who changed what, with before and after values
- [ ] vera@acme.test (Viewer) cannot create or edit anything, through the UI or the API

## Sprint 7: Custom fields and files

**Goal:** every customer can fit the CRM to their own business without asking for code changes.

**Claude builds**

- Custom fields on contacts, companies and deals. The types are text, number, currency, date, dropdown, multi-select, checkbox, user and URL, and each field can be marked required.
- Custom fields appear in forms, detail pages, list columns, filters, import mapping, export and the audit log.
- File attachments on any record, stored privately under a workspace prefix and served through signed URLs, with a size limit and a preview for images and PDFs.

**You test**

- [ ] Add a dropdown called "Region" to contacts; it appears in the form, as a list column, as a filter, in import mapping and in the export
- [ ] A required custom field blocks saving when it is empty
- [ ] Upload a PDF to a deal and preview it
- [ ] Copy the file link and open it as sara@beta.test; access is denied
- [ ] Delete a custom field; it disappears everywhere, and no existing records break

## Sprint 8: Billing and plans

**Goal:** workspaces can pay, Swedish VAT (moms) is handled correctly, and plan limits are enforced.

**Plans:** every workspace starts with a 14-day trial with all features. After that it needs Starter or Pro, priced per seat in SEK, monthly or yearly. When a trial ends without payment, the workspace becomes read-only.

**Claude builds**

- Stripe Checkout and the Customer Portal.
- Stripe Tax: 25% moms for Swedish customers, and EU reverse charge when a valid VAT number is given. The org number and VAT number appear on invoices.
- Seat count kept in sync with Stripe in both directions, with proration.
- Idempotent webhook handling.
- Plan limits enforced in the backend.
- A trial banner.
- Read-only mode when a payment fails or a trial ends.
- Billing visible to Owners only.
- A super-admin page listing workspaces with plan, seats and MRR. Every super-admin access is written to the audit log.

**You test** (in Stripe test mode, with card 4242 4242 4242 4242)

- [ ] The trial starts at signup, and the banner shows the days left
- [ ] Upgrade through Checkout; the plan changes in the app within seconds
- [ ] Inviting a user increases the seat count in Stripe, and removing one decreases it
- [ ] A Swedish workspace's invoice shows 25% moms; a German workspace with a valid VAT number shows reverse charge
- [ ] Going over the Starter contact limit shows an upgrade prompt, and the API refuses the create
- [ ] Simulate a failed payment with the Stripe CLI; the workspace becomes read-only and its data is intact
- [ ] Let a trial expire (Claude provides a script to fast-forward it); the workspace becomes read-only

## Sprint 9: GDPR, hardening and go-live

**Goal:** safe to put real customer data in, running on production.

**Claude builds**

- GDPR tools: export everything about one contact; hard-erase a contact (redacted in the audit log); export a whole workspace; delete a workspace with a 30-day retention period.
- Security headers and CSP, and a dependency audit in CI.
- Backups (Neon point-in-time restore) with a tested restore.
- A production environment: its own database, a custom domain with HTTPS, Stripe live keys, Sentry tagged with the environment, and an uptime monitor.
- Onboarding: a getting-started checklist and optional sample data for new workspaces.
- Drafts for your review: privacy policy, DPA, sub-processor list and terms of service.

**You test**

- [ ] Export a contact; the file contains all of their data, including activities and files
- [ ] Erase a contact; it is gone everywhere, and the audit log shows the event without any personal data
- [ ] Restore staging from a backup
- [ ] Production loads on the custom domain over HTTPS, and staging and production use different databases
- [ ] A new signup on production sees the getting-started checklist
- [ ] The sub-processor list matches the services actually in use
- [ ] Read the legal drafts, and have the client's lawyer check them before launch

**After Sprint 9: MVP done.** Starting Jan 11, 2027, onboard 2–3 beta workspaces for free and collect feedback for 2 weeks. Then run one fix sprint before opening signups.

## Phase 2: Standard sales CRM

These are sprints of one to two weeks each. Reorder them based on beta feedback and on the answers to the client questions. Each one follows the same loop and review checklist as the MVP sprints.

**Sprint 10: Email**

- **Claude builds:** two-way sync with Gmail and Outlook (OAuth), emails matched to contacts and shown on the timeline, sending from the CRM, templates with merge fields, and a BCC address per workspace.
- **You test:** an email sent from Gmail appears on the contact's timeline. A template fills in `{{contact.first_name}}`. Disconnecting the mailbox stops the sync.

**Sprint 11: Calendar and booking**

- **Claude builds:** Google and Microsoft calendar sync, meetings on the timeline, and booking links that create a contact and a meeting.
- **You test:** a calendar meeting with a contact shows on their timeline. Booking through the public link creates the contact and the meeting.

**Sprint 12: Products and quotes**

- **Claude builds:** a product catalog (price, VAT rate, unit, recurring flag), line items on deals that drive the deal value, and a quote PDF with the workspace's branding, a public link and accept/decline.
- **You test:** the line items' totals and moms are correct to the öre. A customer accepts a quote through the link, and the deal shows it as accepted.

**Sprint 13: Workflow automation**

- **Claude builds:** a rule builder with a trigger, conditions and actions (set field, create task, send email, notify, assign owner, webhook), a run log, enable/disable, and loop protection.
- **You test:** "Deal moves to Proposal → create a follow-up task in 3 days" works. A rule that triggers itself stops instead of looping.

**Sprint 14: Reports and goals**

- **Claude builds:** a report builder (object, filters, group by, metric, chart), standard reports (funnel conversion, win rate, sales cycle length, lost reasons, lead source), goals per user, and scheduled email reports.
- **You test:** a "Won deals by owner this quarter" report matches the deal list. A goal shows progress. The scheduled report email arrives.

**Sprint 15: Web forms, API and webhooks**

- **Claude builds:** embeddable web forms with a consent checkbox, spam protection and UTM fields; a public REST API with scoped, hashed API keys and OpenAPI docs; and signed outgoing webhooks with retries.
- **You test:** a form submission creates a contact with consent recorded. An API key only reaches its own workspace. A webhook is retried when the receiver is down.

**Sprint 16: Fortnox**

- **Claude builds:** sync customers to Fortnox, and create a Fortnox invoice from a won deal's line items.
- **You test:** winning a deal creates a matching draft invoice in the Fortnox sandbox.

**Later (suite level):** support tickets and a shared inbox, email campaigns, lead scoring, AI record summaries and email drafts, teams and territories, SSO/SAML, and a React Native app.

## Review checklist and prompts

**Before merging any sprint**

- [ ] All "You test" boxes ticked
- [ ] CI is green, including the isolation, permission-matrix and Playwright tests
- [ ] Logged in as sara@beta.test, no Acme data is visible anywhere
- [ ] Every new table has RLS (the meta-test enforces this)
- [ ] Every new mutation writes the audit log
- [ ] Every new UI string exists in both Swedish and English
- [ ] Migrations run cleanly on staging data that already exists, not only on an empty database
- [ ] Loading, empty and error states look fine
- [ ] Works on a phone-width screen
- [ ] No secrets or `.env` files in the PR

**Kickoff prompt** (paste into Claude Code, changing N and the name)

```
Start Sprint N — <name> from CRM-SaaS-Sprint-Plan.md.
Use the skills crm-saas-builder, saas-multitenant-rls, saas-platform-essentials and crm-feature-catalog.
Read the plan and the current code first. Create branch sprint-N from main.
Build every item under "Claude builds" for Sprint N only, with unit and integration tests,
plus a Playwright test for each "You test" item that can be automated.
Every new table has RLS, every mutation writes the audit log, every UI string is in sv and en.
Run lint, typecheck and all tests, then push and open a PR.
Then give me: what was built, how to test each "You test" item by hand,
what you could not finish, and anything you were unsure about.
```

**Bug report prompt**

```
Bug in Sprint N (branch sprint-N): I did <steps> as <user>. Expected <X>, got <Y>.
Fix it, add a test that would have caught it, and tell me what caused it.
```

**Client change request prompt**

```
Client change request during Sprint N: <what they want and why>.
Don't build it yet. Tell me what it touches, roughly how much time it adds,
and whether it fits this sprint or should go to the backlog.
```

**When a sprint runs long:** finish and merge what works, and move the rest to the next sprint. A smaller working app beats a bigger broken one. Never carry over a bug in isolation, permissions or data loss, though: fix those before merging.
