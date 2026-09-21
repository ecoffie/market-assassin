# Security Hardening — Plan (2026-07-09)

**Trigger:** prospects asking about security (they framed it as AWS: MFA / CloudTrail / GuardDuty / VPC Flow Logs).
**Reality:** Mindy runs on Vercel + Supabase + Upstash + GCP/BigQuery + Stripe — **no AWS**. Each AWS ask maps to a real control on our stack (below). Audit grounded in code (agent aeb2fe1f, 2026-07-09).

## The AWS-ask → real-control map (for the sales answer)
| Prospect said (AWS) | Real capability | Our equivalent | Status |
|---|---|---|---|
| MFA | strong login, no shared secrets | Supabase 2FA (TOTP + magic link) | ✅ EXISTS (user); ⚠️ admin = shared password |
| CloudTrail | audit log (who/what/when) | `audit_log` table + Vercel logs | ⚠️ PARTIAL (console only) |
| GuardDuty | threat/abuse monitoring | Upstash rate-limit + abuse flags + Slack | ⚠️ PARTIAL (no failed-login track/alert) |
| VPC Flow Logs | network/access boundary | Supabase **RLS** | ❌ MISSING (never applied) |

---

## STATUS (2026-07-10): P0 ✅ · P1 ✅ · P2 ✅ · P3 🟡 core shipped (3a) · P4 plan-only

## P3 — Per-user admin — 🟡 PHASE 3a SHIPPED (commit cc67af4f)
src/lib/admin-identity.ts verifyAdminAuth() = session/2FA(admin role) OR shared-password fallback.
Wired into grant-ma-access; audit now records real actorEmail. Verified all 4 auth paths live.
TODO: (3b) fan out the one-line swap to the other ~225 verifyAdminPassword routes in batches;
(3c) set MI_ADMIN_EMAILS in Vercel + admins log in via 2FA; (3d) flip ADMIN_PASSWORD_BREAKGLASS_ONLY=true.


## P0 — Leaked DB credential (CRITICAL) — ✅ DONE (commit ee590a9a)
Password rotated in Supabase (Eric) + 5 scripts de-hardcoded via scripts/lib/db-url.js.

## P1 — Structured audit_log — ✅ DONE (commit 6d70c82c)
Table live (verified), src/lib/audit-log.ts recordAudit(), admin read endpoint, wired into grant-ma-access.

## P2 — Failed-login + Slack alerts — ✅ DONE
src/lib/login-abuse.ts: KV windowed counters (email≥5 / IP≥12 per 15m) → one de-duped sendOpsAlert() + audit row. Wired into two-factor/verify (bad code + lockout, clears on success) and admin/grant-ma-access (admin-password failures). Verified live: threshold trips at 5, alert de-dupes to 1/window, counter clears on success, real Slack post ok. To tune: EMAIL_THRESHOLD / IP_THRESHOLD / WINDOW_SECONDS in login-abuse.ts.

## P0 — (original notes) Leaked DB credential (CRITICAL, in progress)
- **Finding:** `scripts/run-migration-pg.js:8` — plaintext prod Postgres URL+password, committed (commit 4a2aee9d, in git history).
- **Fix:** (1) **Eric rotates** DB password in Supabase + sets `DATABASE_URL` in Vercel → invalidates leaked one. (2) Claude rewrites script to `process.env.DATABASE_URL`, removes hardcoded line, commits.
- **Note:** deleting the line does NOT remove it from history — rotation is the actual fix. (History-scrub via git-filter-repo optional later; rotation makes the leaked value dead regardless.)
- Also audit other `.env.*` files present on disk are **untracked** (confirmed: `git ls-files | grep ^.env` = none). Good.

## P1 — Structured audit log ("CloudTrail")
- **Gap:** admin grant/revoke/tier-change are `console.log` only (Vercel logs, not queryable).
- **Plan:**
  - New table `audit_log` (id, ts, actor_email, actor_ip, action, target_email, target_table, detail jsonb, request_id). MIGRATION = hand-run in Supabase (DB has no in-app DDL).
  - New helper `src/lib/audit-log.ts` → `recordAudit({actor, action, target, detail, req})` — service-role insert, never throws (best-effort, logs on failure).
  - Wire into the sensitive admin routes: grant-ma-access, grant-database-access, revoke, tier changes, apply-rls-migration, user-audit actions.
  - Admin read route `/api/admin/audit-log` (password-gated) to view/query.

## P2 — Failed-login + security Slack alerts ("GuardDuty")
- **Gap:** no failed-login tracking; `sendOpsAlert()` exists but only for infra crons, not security events.
- **Plan (reuses ops-alert.ts):**
  - Count failed 2FA/login attempts per email+IP in KV (short TTL window).
  - On threshold (e.g. ≥5 fails / 15 min for one email, OR one IP hitting many emails) → `sendOpsAlert({subject:'🔐 Login abuse', ...})` to Slack.
  - Also alert on: admin-password failures (any), abuse-flag crossing 250/500.
  - Optional: soft account lockout (KV flag) after N fails — DECIDE with Eric (UX tradeoff).

## P3 — Per-user admin + MFA
- **Gap:** single shared `ADMIN_PASSWORD` for all admins (no per-person accountability; can't revoke one person).
- **Plan (staged, low-risk):**
  - Add an `admin_users` allowlist (email + role) and require an authenticated Supabase session whose email ∈ allowlist, layered so the shared password still works during migration (feature-flag, then remove).
  - Reuse existing 2FA for the admin login. `verifyAdminPassword()` stays as break-glass behind an env flag.
  - Ties into P1: audit_log.actor_email becomes a real person, not "admin".

## P4 — RLS rollout (PLAN ONLY — do not apply this session)
- **Gap:** RLS never applied; all data access via `SUPABASE_SERVICE_ROLE_KEY` (374 uses) which bypasses RLS. If that key leaks → all customer data readable. Biggest posture gap; #1 thing enterprise/CMMC reviewers check.
- **Risk:** enabling RLS wrong = app locked out / routes 500. MUST be staged.
- **Staged plan:**
  1. **Inventory** which of the ~69 tables hold customer PII vs config/public (measure first).
  2. Draft idempotent SQL: `ENABLE ROW LEVEL SECURITY` + a `"service_role full access" FOR ALL USING (true)` policy per table **first** (so nothing breaks — service-role keeps working), then add user-scoped SELECT policies for anon/authenticated on PII tables.
  3. Hand-run in Supabase per-table in batches, verify app still works after each batch (curl gated routes for 200 + non-empty).
  4. Address the security-definer views that would bypass RLS (`apply-rls-migration.js:110-131`).
- **Existing scaffold:** `scripts/apply-rls-migration.js` (dry-run only), `/api/admin/apply-rls-migration` (validates, can't execute).

---

## Order of execution
1. **P0 now** (Eric rotates → Claude cleans file). ← blocking
2. **P1 audit log** (self-contained, high compliance value, low risk).
3. **P2 failed-login alerts** (reuses ops-alert, low risk).
4. **P3 per-user admin** (staged, medium).
5. **P4 RLS** (plan reviewed, applied later in careful batches).
6. Optional: **security one-pager** for sales once P0–P2 shipped (honest, roadmap items labeled "(coming)").

## Non-negotiables honored
- Migrations hand-run in Supabase (pbcopy SQL, confirm "Success", verify columns) — no in-app DDL.
- No secrets in code. Ask before bulk/irreversible writes. Full `npm run build` before ship.

## P4 — RLS — ✅ DONE (2026-07-10)
Supabase Advisor flagged "RLS Disabled"; probe found ALL 127 public tables anon-readable
(NEXT_PUBLIC anon key → real rows from purchases/user_profiles/contacts/audit_log/...).
Live PII+payment leak. Safe to fix: app uses service-role only (287 routes; 0 client anon reads).
Migration migrations/20260710_enable_rls_all_public.sql: ENABLE+FORCE RLS + service_role
policy + REVOKE anon/authenticated/PUBLIC grants, dynamically over every public table.
Tested single-table first (signup_events: anon 401, service-role 200), then ran full.
VERIFIED: anon-readable 127→0; service-role reads 9/9 critical tables OK; live prod route
read user_target_list (523 rows, HTTP 200). Leak closed, app intact.
