# PRD — Trial vs Full-Paid Access (Migration Entitlement + Switch)

**Status:** Required for the mi→getmindy migration. Decided June 10, 2026.
**Owner ask (Eric):** "Make sure the right users get FULL access (paid Mindy), and
the others get TEMPORARY access to the new Mindy — so we can turn that switch on/off."

---

## 1. The entitlement model (from CLAUDE.md — already documented)

| Tier | Price | Access | Marked by |
|---|---|---|---|
| **Mindy Free** | $0 | Market Research (4 reports, 5/mo) + Daily Alerts | default |
| **Mindy Pro** | $149/mo (or $49 loyalty) | **Everything** (10 reports, AI Briefings, Forecasts, Pipeline, CRM, FHC) | KV `briefings:{email}` + `tier:briefings` |

**Grandfathered → map to access:** `legacy_bundle` (Starter/Pro Giant/Ultimate) →
**lifetime Mindy Pro**; `legacy_briefings` ($49/mo) → briefings only; `legacy_oh_pro`
→ agency search only.

**Enforcement (the triple-write, `src/lib/access-codes.ts` + `src/lib/briefings/access.ts`):**
**Vercel KV `briefings:{email}` is the PRIMARY gate**, backed by Supabase
`user_profiles.tier` + Stripe. `hasProAccess(tier)` is the check.
`MITier = 'free' | 'pro' | 'team' | 'enterprise'`.

---

## 2. Two decisions (locked, June 10)

### A. FULL PAID = active Stripe + lifetime/bundle
The "they really paid" set:
- **Active Stripe subscription** ($149 or $49 loyalty), AND
- **`legacy_bundle` / lifetime** entitlement (Starter / Pro Giant / Ultimate buyers).

> **Source of truth = Stripe + the KV gate, NOT `user_notification_settings`.**
> (Measured: `paid_status`/`products_owned` on the notif table are empty/null — the
> real entitlement lives in KV `briefings:{email}` + Stripe. `user_profiles.tier`
> only exists for the ~85 real accounts.) Reuse `admin/backfill-stripe` +
> `admin/grant-briefings-all` to resolve the true paid list before the switch.

### B. TRIAL = per-user `trial_ends_at` (full access until then → drops to Free)
Everyone not in the full-paid set gets a **temporary full-access trial** with a
per-user expiry. After expiry → Mindy Free.

> **⚠️ THE SCAR (CLAUDE.md, never repeat):** a hardcoded global `BETA_END_DATE`
> once silently collapsed daily sends 922→1 when the date passed. So the per-user
> trial MUST:
> - be **per-user** (`trial_ends_at`), NEVER one global calendar gate;
> - **fail OPEN gracefully** — an expired/missing trial drops the user cleanly to
>   **Free** (still gets alerts + limited research), NEVER to broken/no-access;
> - have an **override switch** (below) that doesn't depend on a date.

---

## 3. The access resolution (one function, the order of precedence)

`resolveAccess(email) → 'pro' | 'free'`:
1. **Full paid?** (active Stripe OR lifetime/bundle in KV) → **pro** (permanent).
2. Else **trial active?** (`trial_ends_at > now` AND the global trial switch is ON)
   → **pro** (temporary).
3. Else → **free**.

So a paid user is always pro; a trial user is pro until their date OR until you flip
the switch off; everyone else is free. **Failing any check → free, never broken.**

---

## 4. The on/off switch (env-flag, switchable, no calendar gate)
`MINDY_TRIAL_OPEN` (env, like the existing `DAILY_ALERT_BETA` pattern):
- **ON** (launch window): trial users (within their `trial_ends_at`) get full Mindy
  — the "try everything" period.
- **OFF**: trials immediately stop granting pro; only real-paid keep full access.
  (Honors the per-user date when ON; a hard global kill when OFF.)

Two levers, both safe: the **global switch** (instant on/off) + the **per-user
date** (natural expiry). Neither is a hardcoded calendar gate in code.

---

## 5. Schema (hand-run migration — no in-app DDL)
Add to `user_profiles`:
```sql
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS trial_ends_at  TIMESTAMPTZ,   -- per-user trial expiry
  ADD COLUMN IF NOT EXISTS access_source  TEXT;          -- 'stripe' | 'lifetime' | 'trial' | 'free' (audit)
```
(KV stays the hot gate; this is the durable record + audit trail.)

## ✅ Build status (June 10, 2026 — wired, dormant, awaiting seed)
- [x] Schema: trial_ends_at + access_source on user_profiles (hand-run, VERIFIED queryable).
- [x] resolveAccess() — src/lib/access/resolve-access.ts. Paid > trial(date AND switch) > free, fail-open.
- [x] MINDY_TRIAL_OPEN switch (defaults open; off/false/0/no = closed).
- [x] Admin split view — GET /api/admin/access-split (paid/trial-active/trial-expired/free).
- [x] Wired into the 3 USER-FACING gates (briefings/latest, briefings/verify, lindy/intelligence). Admin analytics left RAW (count real payers). Regression-tested: real paid->pro, free->free.
- [ ] **SEED TRIALS** — the remaining lever. Set trial_ends_at on a chosen cohort, then the switch opens the window. Eric: prove plumbing first (done) → seed deliberately.
LIVE LANDSCAPE (June 10): 85 profiles · 26 paid · 0 trials · 59 free · 9,916 alert audience.

## 6. Build phases
1. **Resolve the true paid list** — run `admin/backfill-stripe` + reconcile KV
   `briefings:` → the definitive full-paid set. Tag `access_source`.
2. **Schema** — `trial_ends_at` + `access_source` (above).
3. **Seed trials** — everyone NOT full-paid gets a `trial_ends_at` (the migration
   trial window). Set `MINDY_TRIAL_OPEN=on`.
4. **`resolveAccess()`** — the precedence function (§3), used by the gate +
   `hasProAccess`. Fail-open to free.
5. **The switch** — `MINDY_TRIAL_OPEN` env wired into step 2 of resolution.
6. **Admin view** — counts: full-paid / trial-active / trial-expired / free, so you
   can see the split before/after flipping the switch.

## 7. Success criteria
- [ ] Every active Stripe / lifetime user resolves to **pro**, verified vs Stripe.
- [ ] Trial users get full Mindy while `MINDY_TRIAL_OPEN=on` and within their date.
- [ ] Flipping `MINDY_TRIAL_OPEN=off` instantly drops trials to Free — paid unaffected.
- [ ] An expired trial drops to **Free cleanly** (alerts still work) — NEVER broken.
- [ ] No global calendar gate anywhere (the 922→1 scar does not recur).
- [ ] Admin shows the paid/trial/free split.

## 8. Relation to the migration
This runs WITH the cutover (`tasks/mi-to-getmindy-cutover-runbook.md`) +
`docs/PRD-migration-onboarding.md`. The audience PRD says WHO to onboard (warm vs
bootcamp); THIS PRD says WHAT ACCESS each gets (paid vs trial) + the switch. Order:
resolve paid list → seed trials → migrate domain → flip trial switch as the launch
lever.

*Reuse: `src/lib/access-codes.ts`, `src/lib/briefings/access.ts`,
`admin/backfill-stripe`, `admin/grant-briefings-all`, `MITier`/`hasProAccess`.
Pattern for the env switch: `DAILY_ALERT_BETA` (no calendar gate).*
