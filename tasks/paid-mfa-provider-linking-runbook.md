# Paid-MFA + Provider-Linking — Go-Live Runbook (P0)

The code is shipped + E2E-proven. This runbook is the **config + canary** steps that
are Eric's (dashboard/env, not code), plus how to prove it live and roll it out safely.

## What shipped (code, already merged)
- **Paid-MFA login gate** (`src/app/api/auth/mi-login/route.ts`): when `MFA_ENFORCED_PAID`
  is on AND the account is paid (`hasProAccess`), a password sign-in issues an email OTP
  and returns `{ mfaRequired: true }` instead of a session. Free accounts unaffected.
  OAuth users never hit this route (provider MFA upstream). **Fail-open** on any error.
- **Client** (`src/app/app/page.tsx`): `loginWithPassword` branches on `mfaRequired` →
  the existing 6-digit code step (`two-factor/verify` mints an `authLevel:'2fa'` token).
- **OTP hardening** (`src/lib/mindy/two-factor-code.ts`): the code row is written first;
  a mail-delivery failure no longer throws (which would have silently failed the gate
  open) — it returns `ok:true, delivery:'failed'` so the challenge stands + Resend works.
- **provider/aal** surfaced additively on `verifyUserSession` (`src/lib/api-auth.ts`) for
  future paid=OAuth-only enforcement.
- **Migration** `supabase/migrations/20260714_two_factor_codes.sql` — RUN + verified live.

## Step 1 — Canary the gate on ONE account (Eric)
The flag defaults OFF (unset = off). Turn it on for Eric's account only is not possible
per-user via env, so canary = flip it on in **Preview/your own deploy** first, or accept
that flipping prod on affects all paid users at once. Recommended: verify on a preview
deploy with the flag set, using a throwaway paid test account, before prod.

```bash
# On the deploy you're canarying (preview or prod), set:
vercel env add MFA_ENFORCED_PAID production   # value: on
# (or Preview scope for a canary deploy first)
```

Then prove it end-to-end:
1. Sign in to `/app` with a **paid** account + password.
2. Expect: "For your security, we sent a verification code to <email>" + the code step.
3. Check the inbox — the OTP email arrives from `mindy@mail.getmindy.ai` (verified Resend
   sender; the same pipeline as daily briefings). Enter the code → dashboard loads.
4. Sign in with a **free** account → straight to dashboard, no code step (unchanged).

> ⚠️ Local-dev note: local `sendEmail` can't use Resend (govcongiants.com unverified in
> local Resend config) and falls back to O365, which Gmail may drop. Real-inbox delivery
> must be verified on a DEPLOY (Resend/getmindy.ai sender), not locally. The gate + OTP
> row are already E2E-proven locally (`scripts/e2e-paid-mfa-gate.mjs`).

## Step 2 — Supabase automatic account linking (prevents NEW OAuth dups)
Dashboard-only (no code). Prevents a Google/Microsoft sign-in with an existing email from
creating a SECOND auth identity (the dup vector OAuth introduced — Keidra-class).

1. Supabase Dashboard → project `krpyelfrbicmvsmwovti` → **Authentication** → **Providers**
   (or **Auth → Settings** depending on dashboard version).
2. Find **"Allow manual linking" / "Automatic account linking"** (Supabase links identities
   that share a **verified** email). Enable it.
3. Confirm Google + Microsoft (azure) providers each have email scope so the email is
   returned + verified (they do — current OAuth flow already requests it).

**This does NOT retro-merge already-duplicated accounts** — those are the deferred
admin-merge flow. It only stops NEW dups.

## Step 3 — (Optional, deferred) "Link Google/Microsoft" nudge in Settings
A thin Settings CTA for paid password users using `supabase.auth.linkIdentity({ provider })`,
so they can move onto OAuth without lockout. The email-OTP bridge already unblocks them, so
this is a follow-up, not a blocker.

## Rollback
Set `MFA_ENFORCED_PAID` to `off` (or remove it) → the gate is fully bypassed, paid users
sign in with password as before. No data cleanup needed (OTP rows expire on their own).

## Verification recipes
- Gate fires (local): `MFA_ENFORCED_PAID=on npm run dev` then `node scripts/e2e-paid-mfa-gate.mjs`
  → expect 🎉 E2E PASS (paid→mfaRequired+OTP row; free→token).
- Table exists: Supabase RO MCP `describe_table two_factor_codes` → ok.
- Prod content-type (not just 200): the route returns `application/json`, not the SPA shell.
