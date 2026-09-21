# PRD — Self-Serve Change-Email Flow + Enforced MFA (+ Admin Merge)

**Status:** Proposed · **Author:** Eric (via Claude) · **Date:** 2026-07-13
**Trigger:** Keidra Norwood / Egan Rose support ticket — signed up twice (`hello@` → `keidra@`), paid plan + workspace stranded across two identities. "People change emails all the time." Eric add (2026-07-13): **verification-click is mandatory and MFA must be enforced — these are government contractors.**
**Related memory:** [[change_email_duplicate_account_pattern]], [[workspace_keyed_by_email_domain]], [[two_settings_surfaces]], [[mi_auth_token_lifecycle]]

> **⚠️ Superseded as lead artifact by [`PRD-identity-model.md`](./PRD-identity-model.md) (2026-07-13).** Eric's call: rethink identity (email-as-key → stable `account_id`) FIRST. Change-email + merge + MFA become downstream phases of that PRD and get much simpler once identity ≠ email. This doc is retained for the detailed re-key surface (§3) and self-serve UX (§5a), which the identity PRD's P3 reuses. **MFA scope changed:** paid users only, not everyone (see identity PRD §5).

**Security posture (why this is not optional):** Mindy's users are federal contractors who are themselves assessed against **NIST 800-171 / CMMC** identification-and-authentication controls (IA-family: multi-factor auth, re-verify on credential change). A change-email flow that doesn't re-verify identity, or an auth surface without enforced MFA, is a takeover vector into accounts holding their capability data, past performance, and (in Vault) EIN/clearance PII. So: **verification-click on every email change is standard practice, no opt-out; MFA is enforced for all users, no per-user toggle.**

---

## 1. Problem

Mindy uses **the email string as the primary key everywhere** — there is no stable internal account ID that survives an email change. Consequences when a user's email changes:

- There is **no way to change your email in-app.** A user who wants a new address just **signs up again** → a brand-new FREE account with none of the old account's purchases.
- Purchases + Stripe subscription + `access_*` flags stay on the OLD email. New login is free → the app correctly but confusingly **keeps prompting them to upgrade** a plan they already pay for.
- Workspace data splits: because workspaces are **keyed by email domain** ([[workspace_keyed_by_email_domain]]), both signups at one company land in the same shared workspace as two members → dropdowns show BOTH identities (the visible half of the Keidra ticket).
- Support has to hand-reconcile 3 systems (Supabase, KV, Stripe) per incident. Doesn't scale; there are almost certainly more silent duplicates.

**This is a recurring class, not a one-off.** Every email change today manufactures a duplicate.

### What "good" looks like
Email is an **editable attribute of one account**, not the identity — the HubSpot / Linear / Notion / Stripe model. Changing it updates the address in-place on the SAME account; nothing splits, no purchase is lost, no duplicate is born.

---

## 2. Reuse check (grep BEFORE building — rule #14)

| Already exists | Reuse it for |
|---|---|
| `src/app/api/admin/delete-mindy-user/route.ts` | **Authoritative list of email-keyed tables** (`USER_EMAIL_TABLES`, 19 tables) + the `supabase.auth.admin` user-lookup pattern + the count→act dry-run shape. The re-key sweep mirrors this list exactly — extract the list to a shared const so they can't diverge (same lesson as the vault-omission audit 2026-07-05). |
| `src/lib/vault/…` `VAULT_TABLES` / `deleteAllVaultData` | The 5 Vault (PII) tables + Storage files — re-key via the shared vault lib, never a second hand-list ([[vault_data_protection_audit]]). |
| `src/lib/two-factor-session.ts` (`createMIAuthSessionToken`/`requireMIAuthSession`, 30-day signed token) | Re-mint the session token under the new email after the change ([[mi_auth_token_lifecycle]]). |
| `POST /api/auth/two-factor/request` + `/verify` + `two_factor_codes` table + `login-abuse` lockout | **The email-OTP MFA already exists and works** — reuse for both the change-email step-up AND the global MFA enforcement (§5d). "Turn on MFA" = enforce this in every login path, not build new. |
| `src/lib/briefings/access.ts` (`grantBriefingsAccess`/`revoke…`), `src/lib/access-codes.ts` | KV re-key (`briefings: ma: contentgen: recompete: dbaccess: dbtoken: ospro: access:`). |
| Stripe MCP + `mcp__stripe__search_customers` | Find + update the Stripe customer email so billing follows the login. |
| `src/lib/app/workspace.ts` `getWorkspaceId` | The domain-workspace collapse — the change-email sweep must also fix the `mi_beta_team_members` duplicate-member case ([[workspace_keyed_by_email_domain]]). |

**No dedicated change-email or merge route exists today** (searched `api/**` for change/update-email — only `email-guard`/`email-history`, unrelated). So: build one shared **`reKeyAccountEmail(from, to)`** lib; the self-serve flow and the admin merge both call it.

---

## 3. The re-key surface (the full blast radius — measured, not guessed)

`reKeyAccountEmail(oldEmail, newEmail)` must move ALL of:

1. **Supabase Auth user** — `auth.admin.updateUserById(id, { email })` (in-place; keeps the same `user_id`). This is the anchor that makes it a *move*, not a copy.
2. **`user_profiles`** — keyed on `email` (NOT `user_email`). One row.
3. **19 `user_email` tables** — the `USER_EMAIL_TABLES` list (user_notification_settings, user_business_profiles, user_pipeline, user_teaming_partners, user_referrals, user_engagement, user_engagement_scores, mi_beta_user_settings, mi_beta_team_members, mi_beta_activity, alert_log, briefing_log, briefing_feedback, signup_events, opportunity_shares, purchases, + 2 dead-but-swept). UPDATE `user_email`, don't delete.
4. **5 Vault tables + Storage** — via vault lib (PII; must not be orphaned).
5. **KV** — 7 namespaces: `briefings: ma: contentgen: recompete: dbaccess: dbtoken: ospro: access:`. Copy value old→new key, delete old.
6. **Stripe** — update the customer email (or, if `to` already has a customer, reconcile — see §5 merge).
7. **Session token** — re-mint under `newEmail`, invalidate the old (30-day signed token is email-scoped).
8. **Domain-workspace duplicate** — if `oldEmail` and `newEmail` share a domain and both have `mi_beta_team_members` rows in the same `workspace_id`, collapse to one owner row (the exact 2-write fix run for Keidra on 2026-07-13).

**Ownership-transfer columns** (not `user_email` but still identity): `user_pipeline.owner_email`, `mi_beta_*` `invited_by`/`invited_email`, `opportunity_shares` sharer/recipient. Audit + include.

---

## 4. Scope

### In scope
- **Self-serve change-email** (the primary ask): Settings → step-up MFA → "Change email" → **mandatory verify-click on the NEW address** → `reKeyAccountEmail` on the SAME account → re-mint session.
- Shared **`reKeyAccountEmail(from, to)`** lib with **dry-run mode** (count rows per table, no writes) — reused by both flows.
- **Admin change-email** (`/api/admin/change-email`, dry-run default) for support to run it on a user's behalf.
- **Enforced MFA** (§5d): make the existing email-OTP a required step in every session-minting path; no per-user toggle; trusted-device remember + step-up for sensitive actions.

### Explicitly deferred (labelled "coming")
- **Full admin merge-accounts** where BOTH emails already have real data/purchases (Keidra's exact case). Merge = re-key + *conflict resolution* (two Stripe customers, two profiles, two workspaces). Strictly harder than change-email. Ship change-email first; merge second. *(Eric picked "self-serve change-email" + "just fix Keidra for now" on 2026-07-13.)*
- **Duplicate-detection report** (same company_name/phone/Stripe-metadata-name) — a later leverage add.

### Non-goals
- Not changing the email-as-key architecture wholesale (too invasive). This makes email *editable in place*, which solves the real pain without a data-model rewrite.

---

## 5. Design

### 5a. Self-serve flow (Settings — the full `UnifiedSettingsPanel` Security section, [[two_settings_surfaces]])
1. **Re-authenticate the CURRENT session with MFA** before anything (step-up auth — a credential change is a sensitive action). Reuse the existing OTP: `POST /api/auth/two-factor/request` → user enters the 6-digit code. No code → no change. (GovCon standard; not optional.)
2. User enters **new email** → server checks it's not already a Mindy account (if it is → "That email already has an account. Contact support to merge." — routes to the deferred merge, never silently clobbers).
3. **Verify ownership of the NEW address — MANDATORY, no opt-out**: send a signed, TTL'd confirmation link to the NEW email (reuse `email-tracking-tokens`/`invitation_tokens` pattern). The change does NOT apply until that link is clicked. This is the standard-practice control Eric requires — prevents account-takeover by typo/malice and satisfies re-verify-on-change.
4. On click → `reKeyAccountEmail(old, new)` runs **in a guarded sequence** (auth user first as the anchor; then DB tables; then KV; then Stripe; then session). Each step idempotent + logged to `audit_log`.
5. Re-mint session under new email; old session invalidated. Confirmation email to BOTH addresses ("your Mindy email was changed to X"). Security-event notice to the OLD address so a hijack is visible to the real owner.

### 5b. Failure handling (the DB has no transactions across KV+Stripe+Auth)
- **Order matters**: Auth user + `user_profiles` + purchases FIRST (the entitlement-critical rows) so the user is never left un-paid mid-run. KV/Stripe are re-runnable.
- **Resumable + idempotent**: every step re-checkable; a re-run of `reKeyAccountEmail` on a partially-moved account completes the rest, never double-moves. Stamp `email_change_log` with per-step status.
- **Fail loud, fail safe**: if any critical step errors, STOP, log, alert — never leave the user unable to sign in with EITHER email. Old email stays valid until the new one is fully provisioned.

### 5c. Guardrails (rule #11 — this is a multi-row write across billing + auth)
- Admin route **dry-run by default** (`?mode=preview` → per-table row counts + a sample), execute only on `?mode=execute` — mirrors `delete-mindy-user`.
- Rate-limit self-serve (1 change / 24h / account) to blunt takeover attempts.

### 5d. Enforced MFA (Eric add — "we have to turn on MFA")

**Finding — the mechanism already EXISTS; the gap is ENFORCEMENT, not build (grep'd 2026-07-13):**
- `POST /api/auth/two-factor/request` — generates a 6-digit code, `sha256(email:code:secret)`, stores in `two_factor_codes` (10-min TTL, 60s resend throttle), emails it. **Works.**
- `POST /api/auth/two-factor/verify` — validates (max 5 attempts, `login-abuse` lockout, IP/UA logged) → mints the signed 30-day session (`createTwoFactorSessionToken`). **Works.**
- **THE GAP:** `mi-login` mints the session straight from password (`createMIAuthSessionToken`) with **no OTP step**; magic-link is a separate passwordless path. So 2FA is real but **bypassable** at login.
- **THE SCAR (don't re-derive):** the homepage 2FA *toggle* was removed June 10-11 2026 as "decorative — it enforced nothing" ([[mi_auth_token_lifecycle]], CLAUDE.md). Correct lesson: a per-user opt-in toggle is theater. **Enforcement must be global and non-optional**, not a setting.

**What "turn on MFA" means here:**
1. **Make OTP a required step in EVERY session-minting path** — `mi-login` (post-password), magic-link, account-setup, password-reset completion. No login route may call `createMIAuthSessionToken`/`createMIAuthSession` directly; all must route through `two-factor/verify`. Add a client-auth-audit rule (the pre-push gate, [[test_infra]]) that FAILS if a login route mints a session without a preceding verified OTP.
2. **No per-user MFA toggle.** MFA is on for everyone. (This is the anti-pattern that got removed; do not reintroduce a choice.)
3. **Trusted-device remember (usability, not a bypass):** after a full OTP, set a signed device cookie so MFA is re-prompted every N days (e.g. 30) or on new-device/IP, not every login. Keeps the 30-day session UX while making the FIRST auth on any device MFA-gated. Government-appropriate default: re-prompt on credential change, new device, and 30-day expiry.
4. **Step-up for sensitive actions** regardless of device trust: change-email, change-password, Stripe/billing changes, Vault export → require a fresh OTP even inside a trusted session.
5. **Roadmap (coming, labelled):** TOTP authenticator-app + WebAuthn/passkey as stronger second factors (email-OTP is the enforced baseline; some GovCon customers will want app-based/phishing-resistant MFA — 800-171 rewards it). SMS OTP already exists (`/api/app/sms/verify`, via GHL [[sms_via_ghl_not_twilio]]) as an alternate channel.

**Guardrail:** enforcing MFA on all login paths is a change that can lock users out if botched. Roll out behind an env flag (`MFA_ENFORCED`) defaulting ON in a canary, with the fail-OPEN-to-email-OTP-resend safety (never fail-closed to "no way in"). Prove with a real login E2E before flipping globally — the 922→1 briefing collapse is the cautionary tale for silent global auth gates.

---

## 6. Phases

| Phase | Deliverable | Proof (rule #2) |
|---|---|---|
| **P0 — MFA enforcement** | Make email-OTP required in every session-minting path (`mi-login`, magic-link, account-setup, password-reset); no toggle; `MFA_ENFORCED` env flag + canary; pre-push client-auth-audit rule forbidding direct session-mint without verified OTP; trusted-device cookie | E2E: a login that skips OTP is rejected; a full OTP login succeeds and sets a trusted-device cookie; audit rule fails a deliberately-bypassing route in CI |
| **P1** | `reKeyAccountEmail(from,to)` shared lib (table list extracted to a shared const with `delete-mindy-user`) + `email_change_log` table (hand-run migration, [[cron_use_dispatcher]] rules) + `/api/admin/change-email` (dry-run default) | tsx dry-run on a seeded test pair prints correct per-table counts; execute on a throwaway pair → new email fully Pro (`hasProAccess=true`), old email 404s; `audit_log` rows present |
| **P2** | Self-serve UI in `UnifiedSettingsPanel` Security section: step-up MFA → **mandatory new-email verify-click** → session re-mint | Browser: change email end-to-end on a test account; change does NOT apply until the verify link is clicked; sign in with new email, Chat works, dropdowns show only new email; old email rejected |
| **P3 (coming)** | Admin **merge-accounts** (two-real-accounts conflict resolution) + dup-detection report; TOTP/passkey second factors | Merge Keidra-shaped fixture: one canonical account, one Stripe sub, one workspace owner |

---

## 7. Acceptance criteria

- [ ] **No session is minted anywhere without a verified OTP** — every login path (password, magic-link, setup, reset) enforces MFA; a route that skips it fails the pre-push audit.
- [ ] **MFA has no per-user off switch** — it's global; there is no toggle to reintroduce the "decorative 2FA" anti-pattern.
- [ ] An email change does NOT take effect until the **verify-click on the new address** is completed — no exceptions, no admin-silent path that skips ownership verification for self-serve.
- [ ] Sensitive actions (change-email, change-password, billing, Vault export) require a fresh OTP even inside a trusted session.
- [ ] A user changes their email in Settings and keeps the SAME account: all purchases, Pro status, pipeline, vault, workspace intact under the new address.
- [ ] After the change, the OLD email is not a usable account and appears in NO dropdown / member list.
- [ ] `hasProAccess(newEmail) === hasProAccess(oldEmail-before)` — entitlement is preserved, not re-granted.
- [ ] Stripe customer email == new email; the $/mo sub is uninterrupted (no cancel/re-subscribe).
- [ ] Attempting to change TO an email that already has an account is blocked with a clear message (no silent clobber).
- [ ] Admin route dry-run shows exact scope (counts + sample) before any write; execute is a separate explicit call.
- [ ] A partially-failed run is resumable and never leaves the user locked out of both emails.
- [ ] Marketing literature updated (rule #8): What/Why/SEO/Proof appended to `MARKETING-FEATURE-LITERATURE.md` in the same PR.

---

## 8. Defer-or-execute

**Execute first:** P0 (MFA enforcement) — the security baseline the rest sits on, and independently valuable for a GovCon user base. Env-flagged canary so it can't lock everyone out.
**Execute next:** P1 (shared re-key lib + admin dry-run route) — the reusable core AND immediately lets support fix future duplicates cleanly instead of by-hand-across-3-systems.
**Then:** P2 self-serve UI once P0's step-up OTP + P1's lib are proven on real re-keys.
**Defer (labelled coming):** P3 merge + dup-detection + TOTP/passkey — genuinely harder (two-real-account conflict resolution) and not needed to stop NEW duplicates. Keidra herself is already fixed (workspace de-duped 2026-07-13); her residual is only the Stripe-email-on-`hello@` cosmetic, handle in P1's first real admin run.

**Decided (Eric, 2026-07-13):** verification-click on every email change is MANDATORY (no instant-change option); MFA is enforced for all users with no per-user toggle. These are GovCon-standard controls, not configurable trade-offs.
