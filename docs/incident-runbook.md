# Security incident runbook

For anyone who has to act on a suspected breach, leaked secret or data exposure. Work through the steps in order and write down what you do and when, as you go.

## 1. Triage (first hour)

- What happened, how it was noticed, and since when.
- Which workspaces (customers) and which data are affected. The audit log (`audit_log`, per workspace) and the per-user security log (`security_events`) show who did what and from where.
- Is it still happening? If yes, go to step 2 before investigating further.

## 2. Contain

| Situation | Action |
| --- | --- |
| A user account is compromised | Delete all its rows in `sessions` (logs it out everywhere). Make the user reset their password. Check `security_events` for the IPs used. |
| A workspace is being misused | Remove the attacker's membership in that workspace. Turn on "require two-factor login" for it. |
| `BETTER_AUTH_SECRET` leaked | Set a new secret and redeploy. Every session and 2FA secret is invalidated; users log in again and set up 2FA again. |
| Database credentials leaked | Change the password of `app_user` (and the owner role if exposed), update Railway, redeploy. Check Neon's connection logs. |
| SMTP / Sentry / Stripe keys leaked | Rotate the key in the provider, update Railway/Vercel, redeploy. |
| A bug exposes data across workspaces | Deploy a fix, or turn off the route at once (return 503) and fix after. |

## 3. Preserve evidence

Before cleaning up, export the relevant `audit_log` and `security_events` rows, the Railway and Vercel request logs, and the Sentry events. Take a Neon branch (snapshot) of the database at that moment.

## 4. Fix

Fix the cause, add a test that would have caught it (the cross-workspace test in `apps/api/src/routes/__tests__/cross-tenant.test.ts` is the place for isolation bugs), and deploy.

## 5. Notify (GDPR)

We process our customers' personal data as their **processor**. For a personal data breach:

- **Tell every affected customer (the controller) without undue delay**, with what happened, which data, how many people, what we have done, and a contact. Our customers then decide whether to notify IMY and the people affected.
- For breaches of our own data as controller (for example user accounts and billing details), **report to IMY within 72 hours** of becoming aware, unless the breach is unlikely to put people at risk: https://www.imy.se. If the risk to people is high, tell them directly too.
- Keep a record of every breach (facts, effects, actions), even ones that need no notification.

## 6. Afterwards

Within a week, write a short blameless post-mortem: timeline, cause, what worked, and action items with owners. Review this runbook if a step was missing or wrong.

## Contacts

Fill in before go-live: who is on call, the customer contact list, the Railway/Vercel/Neon/Sentry/email provider accounts and who has access, and the security contact in `apps/web/public/.well-known/security.txt`.
