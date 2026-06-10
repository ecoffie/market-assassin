# Cutover Runbook — `mi.govcongiants.com` → `getmindy.ai`

**Goal:** Make `getmindy.ai` the single canonical app domain and retire
`mi.govcongiants.com` to a redirect-only role — *without* breaking auth,
email links, Stripe flows, or in-flight users.

**Status:** 🔻 **SCHEDULED FOR NEXT SESSION** (Eric, "do the final migration
tomorrow"). On pickup, FIRST re-run the ref audit fresh (count may have grown since
this was written), THEN proceed through the sequence. Trigger phrase still works:
"do the final migration."
**Owner:** Eric (+ Claude for the code/verification steps).

> **PAIR WITH `docs/PRD-migration-onboarding.md`** — this runbook moves the DOMAIN;
> that PRD handles the AUDIENCE. Key: the real base is ~1,300 warm users (claim-
> account → Auto-setup); ~83% are imported bootcamp leads → suppress generic alerts +
> nurture, do NOT onboard. ACCESS: see `docs/PRD-trial-vs-paid-access.md` (full-paid = active Stripe + lifetime; everyone else = per-user trial with a MINDY_TRIAL_OPEN switch).
**Related:** `docs/strategy/DOMAIN-BRAND-CONSOLIDATION.md` (strategy),
`tasks/oauth-branding-runbook.md` (the OAuth/Supabase side — already done for
`auth.getmindy.ai`; do NOT re-do, just verify).

---

## 0. Why this is careful, not a find-replace

Both domains already run the **same code** via host-based rewrites in
`next.config.ts`. The danger isn't the app — it's the **edges that point at a
specific host**:

- **139 hardcoded `mi.govcongiants.com` references across 61 files** (as of
  2026-06-05). Three kinds, each handled differently below.
- **Email links already sent** — every alert/briefing/receipt email in inboxes
  points at `mi.govcongiants.com`. Those links must keep working *forever*, so
  the old domain becomes a **301 redirect**, never a hard shutdown.
- **Auth redirects** — `reset-password` / `setup-password` *force-redirect to
  mi.govcongiants.com* today. Flip naively and you break password flows on the
  new domain.
- **Stripe / OAuth callbacks** registered against specific URLs.

**Golden rule: the old domain keeps serving (as a redirect) indefinitely. We
move the *canonical* away from it; we don't kill it.**

---

## 1. Pre-cutover audit (run first, every time)

```bash
# Total surface — re-run to see if it grew since this doc was written.
grep -rln "mi.govcongiants.com" src/ | wc -l       # files (~61)
grep -rn  "mi.govcongiants.com" src/ | wc -l       # occurrences (~139)
```

Bucket them — the fix differs per bucket:

| Bucket | Pattern | Fix |
|---|---|---|
| **A. Env-var-driven** | `process.env.NEXT_PUBLIC_APP_URL \|\| 'https://mi.govcongiants.com'` (and `NEXT_PUBLIC_SITE_URL`) | Just **set the env var** to `https://getmindy.ai`. No code change — the fallback stops being used. Lowest risk. |
| **B. Hardcoded URLs** | string literals in `src/lib/send-email.ts`, `stripe-webhook`, `planner-email.ts`, `access-links.ts`, etc. | **Code change** — replace with the env var or `https://getmindy.ai`. These are the bulk of the 139. |
| **C. Host-pinned auth redirects** | `reset-password/page.tsx` + `setup-password/page.tsx` force-redirect *to* mi.govcongiants.com | **Flip the pin to getmindy.ai** (or remove the redirect so it stays on whatever host it loaded on). Auth-critical — test hard. |

---

## 2. The cutover sequence (in order — do not reorder)

### Step 1 — Infra/console (no deploy; reversible)
1. **DNS:** confirm `getmindy.ai` is a verified Vercel domain on the
   market-assassin project (it already serves the app — verify, don't add).
2. **Supabase Auth → URL config:** set **Site URL** to `https://getmindy.ai`;
   keep `https://mi.govcongiants.com/**` AND `https://getmindy.ai/**` BOTH in
   the allowed **Redirect URLs** during the overlap window.
3. **Google + Microsoft OAuth consoles:** ensure `getmindy.ai` (and the
   `auth.getmindy.ai` callback from the OAuth runbook) are authorized origins /
   redirect URIs. `auth.getmindy.ai` is already the OAuth surface — verify it.
4. **Stripe:** any success/cancel URLs or webhook-driven access links that name
   `mi.govcongiants.com` → add/repoint to `getmindy.ai`. Webhook endpoint
   itself is host-agnostic (same code), but the **links it emails** (Step 2
   bucket B) change.

### Step 2 — Code change (one PR)
1. **Set env vars** in Vercel (prod): `NEXT_PUBLIC_APP_URL=https://getmindy.ai`,
   `NEXT_PUBLIC_SITE_URL=https://getmindy.ai`. Fixes all bucket-A refs at once.
2. **Replace bucket-B hardcoded URLs** — prefer routing them through the env var
   so this never has to happen again. Centralize to one `APP_URL` constant if
   not already.
3. **Flip bucket-C auth redirects** to `getmindy.ai` (reset-password,
   setup-password). Re-read both files — they currently hard-pin the host.
4. **Update `next.config.ts`** so the **canonical/SEO** signals (and any root
   landing rewrite) treat `getmindy.ai` as primary. Keep the
   `mi.govcongiants.com` rewrites working (it still serves during overlap).
5. Build + typecheck + the pre-deploy test suite (`npm run test:pre-deploy`).

### Step 3 — Verify on prod (before flipping the redirect)
With BOTH domains live and getmindy.ai canonical, verify on `getmindy.ai`:
- [ ] Sign up (email) → onboarding lands on getmindy.ai
- [ ] Google + Microsoft OAuth → consent shows `auth.getmindy.ai`, returns to getmindy.ai
- [ ] **Password reset + setup-password** complete on getmindy.ai (bucket C)
- [ ] A daily-alert / briefing email's links open getmindy.ai
- [ ] Stripe checkout → access link emailed points at getmindy.ai
- [ ] `mi.govcongiants.com` STILL works end-to-end (in-flight users mid-session)

### Step 4 — Flip `mi.govcongiants.com` to redirect (the actual "final migration")
Only after Step 3 passes:
1. Add a **301 redirect** `mi.govcongiants.com/* → getmindy.ai/*` (path- and
   query-preserving, so old email links land on the right page). Two options:
   - Vercel domain-level redirect (cleanest), or
   - a `next.config.ts` `redirects()` rule gated on `host = mi.govcongiants.com`.
2. **Auth caveat:** keep `mi.govcongiants.com/**` in Supabase redirect URLs for
   a while even after the 301 — a mid-flight OAuth/magic-link started on the old
   host must still complete. Remove only after the overlap window.
3. Leave the 301 **permanently** — email links from years of sends depend on it.

---

## 3. Rollback

- **Before Step 4:** trivial — both domains serve; revert env vars + the PR.
- **After Step 4 (301 live):** remove the redirect rule to restore
  `mi.govcongiants.com` as a live app host (code is still there). Because we
  never deleted the old host's serving capability, rollback is a config flip.

---

## 4. What does NOT change (don't touch)

- The **app code / panels** — host-based rewrites already serve both. This is a
  URL/canonical/redirect migration, not an app rewrite.
- **`auth.getmindy.ai`** — already the OAuth surface (OAuth runbook). Verify only.
- **Supabase project, tables, KV, Stripe products** — same backend for both
  hosts. No data migration. Users don't re-auth (same Supabase session domain
  rules apply — confirm session cookie scope during Step 3).

---

## 5. Success criteria

- `getmindy.ai` is canonical: new signups, emails, Stripe links, OAuth all name it.
- `mi.govcongiants.com/*` 301s to `getmindy.ai/*`, preserving path+query, so
  every historical email link still resolves.
- Zero broken auth flows; no in-flight user logged out by the cutover.
- `grep mi.govcongiants.com src/` returns only intentional redirect/allow-list
  references (not live link-building).

---

## 6. Decision log
| Date | Decision | By |
|---|---|---|
| 2026-06-05 | Write the cutover as a sequenced runbook now; execute later on Eric's go. Old domain becomes a permanent 301, never a shutdown (historical email links). | Eric |
