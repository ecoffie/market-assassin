# PRD — Stable Identity Model (account_id, not email-as-key)

**Status:** Proposed (parent PRD) · **Author:** Eric (via Claude) · **Date:** 2026-07-13
**Trigger:** Keidra / Egan Rose ticket exposed the root cause behind a whole class of bugs. Eric (2026-07-13): *"rethink the identity model more deeply first."*
**Supersedes-as-parent:** [`PRD-change-email-flow.md`](./PRD-change-email-flow.md) — change-email, merge, and MFA become PHASES downstream of this decision (several get much simpler once identity ≠ email).
**Related memory:** [[change_email_duplicate_account_pattern]], [[workspace_keyed_by_email_domain]], [[pro_population_is_a_union]], [[oauth_custom_domain]], [[mi_auth_token_lifecycle]], [[profile_table_source_of_truth]]

---

## 1. Problem — one root cause behind many tickets

**Email is Mindy's primary key everywhere.** Every identity-level bug this session traces to that single fact:

| Symptom (real) | Because email is the key |
|---|---|
| Keidra has 2 accounts, paid plan on the old one | Re-signup with a new email = a brand-new account; nothing links them |
| Her workspace shows BOTH her emails | Workspaces keyed by email *domain* ([[workspace_keyed_by_email_domain]]) |
| "Keeps asking me to upgrade" | Pro entitlement stranded on the other email |
| OAuth can create a 2nd auth identity for the SAME email | Password-user + "Sign in with Google" aren't linked → two `auth.users` rows |
| Support fixes = hand-reconcile Supabase + KV + Stripe | No single ID to move; everything is a string-match sweep |

Change-email, merge, provider-linking, and dedup-detection are all **patches on the same wound.** The durable fix is a **stable internal account ID** that email, OAuth providers, Stripe customers, workspaces, and all user-scoped data hang off of — so email becomes a mutable *attribute*, not the identity.

### The measured scale (grep, 2026-07-13)
- **345** code sites key on `email` / `user_email`; only **21** on `user_id`. ~16:1. This is a real migration, not a rename.
- **We do NOT need to invent an ID.** `user_profiles.user_id` already carries the Supabase `auth.users.id` (Keidra's row: `82261438-…`). The job is to **adopt the ID we already have** as the canonical join key, and demote email to a lookup attribute.

---

## 2. Reuse check (rule #14 — adopt, don't invent)

| Already exists | Use as |
|---|---|
| Supabase `auth.users.id` (UUID, immutable, survives email change) | **THE canonical `account_id`.** Don't build a parallel ID. |
| `user_profiles.user_id` | Already the auth id → becomes the seed of the email→account_id resolver. |
| `src/app/api/admin/delete-mindy-user` `USER_EMAIL_TABLES` (19 tables) + vault lib (5 tables) | The exact set of tables to add an `account_id` column to + backfill. Same list the re-key lib would have swept. |
| Supabase **identity linking** (`auth.users` can hold multiple `identities` — password + google + azure — under ONE user) | Collapses the OAuth-double-identity vector WITHOUT custom code. Configure, don't build. |
| Existing email-OTP (`two-factor/request`+`/verify`, `two_factor_codes`) + provider MFA (Google/MSFT) | MFA baseline — enforced for PAID only (§5). |
| `resolveAccess`/`hasProAccess` ([[pro_population_is_a_union]]) | The "is this a paid account" gate that scopes MFA enforcement. |

---

## 3. Target model

- **`account_id` = Supabase `auth.users.id`** — the single immutable identity. One human = one account_id, regardless of email or login method.
- **Email = a mutable attribute** on the account (+ a fast lookup index). Changing it updates one row, re-keys nothing.
- **OAuth providers = linked identities** on the same `auth.users` row (password + Google + Microsoft all resolve to one account_id via Supabase identity-linking).
- **Stripe customer** carries `account_id` in metadata (already partially there — Keidra's Stripe metadata had `user_id`). Billing follows the account, not the email.
- **Workspaces** keyed by an explicit `workspace_id` owned by an `account_id` — NOT derived from email domain (kills the shared-domain-commingling class).
- **All user-scoped tables** gain an `account_id` FK; `user_email` stays only as denormalized convenience/display, never the join key.

---

## 4. Scope

### In scope
- Adopt `account_id` (= auth user id) as the canonical key: add the column to the 19+5 user-scoped tables, backfill from email→user_id, dual-write, then cut reads over.
- **Configure Supabase identity-linking** so same-email password+Google+Azure = one account (fixes the OAuth dup vector).
- Reframe change-email as *"update the email attribute on this account_id"* — trivial once the 345 email-joins are account_id-joins.
- Reframe merge as *"repoint account_id B's rows to account_id A"* — one key to move, not a 3-system string sweep.
- **MFA enforced for PAID accounts only** (§5).

### Explicitly deferred (labelled coming)
- Full cutover of all 345 sites in one shot — phased (dual-write window), never big-bang.
- **Passkey/WebAuthn** second factor (TOTP is now IN for P0 per §5 decision #1; passkey is the next phishing-resistant step after).

### Non-goals
- Replacing Supabase Auth. We're adopting its user id as canonical, not migrating auth providers.

---

## 5. MFA + auth policy — DECIDED (Eric, 2026-07-13)

**Three decisions locked:**
1. **Paid MFA = choice of channel, not one forced channel.** Baseline is OAuth-provider MFA; where first-party MFA is needed (see below), the paid user PICKS among **email-OTP, SMS, or TOTP authenticator-app**. TOTP is therefore IN for P0 (moved out of "deferred") — some CMMC customers will want phishing-resistant app-based MFA.
2. **Free-tier password users: MFA optional** — no enforcement; offered as opt-in (trust signal), never blocks a free login.
3. **Paid accounts = OAuth-only.** To hold a paid plan you sign in with **Google or Microsoft**; password sign-in stays for FREE accounts only. This inherits the provider's MFA and eliminates the password+OAuth duplicate-identity vector for the accounts that matter.

**How #1 and #3 fit together (the interaction, made explicit so they don't read as contradictory):**
Because paid = OAuth-only (#3), the everyday "paid password user" case disappears — a paid user signs in via Google/MSFT and their MFA is the provider's. The first-party MFA *options* from #1 apply to exactly two narrower groups:
- **(a) Migration cohort** — existing paid users who currently have a password. They need a guided path onto OAuth (link Google/MSFT to their account) at next sign-in; until linked, they get first-party MFA (their choice of email-OTP/SMS/TOTP) so they're never unprotected mid-migration.
- **(b) No-SSO fallback** — a paid user whose email isn't on Google/MSFT (some GovCon shops self-host mail). They can't use provider MFA, so they authenticate with password + a first-party second factor of their choice. This is the ONLY steady-state paid-password lane, and it's MFA-enforced.

**Shared mechanics:**
- Gate on the Pro **union** — `hasProAccess(account)` ([[pro_population_is_a_union]]), NOT a single flag.
- Reuse what exists: email-OTP (`two-factor/verify` + `two_factor_codes`), SMS (`/api/app/sms/verify` via GHL [[sms_via_ghl_not_twilio]]).
- **TOTP = mostly CONFIGURE, not build (verified 2026-07-13):** `@supabase/supabase-js@2.90.0` ships **native MFA** — `supabase.auth.mfa.enroll()` (returns QR + secret), `.challenge()`, `.verify()`, and **AAL enforcement** (`getAuthenticatorAssuranceLevel()` → require `aal2` for paid). No custom secret storage or TOTP crypto to write. We do NOT call `auth.mfa` anywhere yet. **The only genuinely-custom build:** (1) **recovery/backup codes** — NOT native to Supabase, must be built (generate, hash, store, single-use consume) so a lost phone isn't a lockout; (2) the enrol/challenge UI; (3) enabling MFA in the Supabase dashboard (console step, not code). Supabase MFA also supports a native `phone` factor, but we keep GHL SMS for consistency.
- **Enroll at the moment of upgrade**, not retroactively — never lock an existing free→paid user out mid-session. Post-checkout flow: "link Google/Microsoft, or set up a second factor."
- **No per-user off toggle** for paid (the removed "decorative" toggle scar, [[mi_auth_token_lifecycle]]) — but the *population* it applies to is scoped to paid.
- Step-up 2nd-factor for sensitive actions (change-email, billing, Vault export) regardless of tier, when a session exists.

**Guardrail:** roll behind `MFA_ENFORCED_PAID` env flag + canary; fail-open to a factor-resend, never fail-closed to "no way in" (the 922→1 auth-gate cautionary tale). The paid=OAuth-only enforcement (#3) must NOT strand the migration cohort (a) — password login stays accepted for a paid account until it has linked a provider OR enrolled a first-party factor.

---

## 5b. CMMC / NIST 800-171 control mapping

MFA here is not generic hygiene — it maps to **named controls Mindy's users are themselves assessed against** (CMMC Level 2 is built on NIST SP 800-171, Identification & Authentication / IA family):

| Control | Requirement | How Mindy meets it |
|---|---|---|
| **IA.L2-3.5.3** (NIST 800-171 §3.5.3) | MFA for network access to non-privileged accounts (and local + network for privileged) | Enforced MFA for paid accounts (§5) — OAuth-provider MFA and/or first-party second factor |
| **IA.L2-3.5.4** (§3.5.4) | **Replay-resistant** authentication mechanisms | **TOTP** (time-window, one-time) is replay-resistant → the *reason TOTP is offered*, not just SMS. NIST 800-63B discourages SMS (SIM-swap); TOTP/authenticator-app is the stronger factor |

**Honest scope framing (rule #10 — do NOT overclaim):**
- **True + marketable:** *"Mindy satisfies the CMMC/NIST 800-171 IA MFA controls (3.5.3, 3.5.4)"* — a trust signal that the app is built to the standard, so entrusting CUI-adjacent data (capability statements, past performance, Vault EIN/clearances) to it does not weaken the customer's posture. Ties directly into the CUI-custody strategy ([[cmmc_cui_custody_strategy]]).
- **NOT claimable:** *"Mindy makes YOU CMMC compliant."* Their assessor checks MFA on THEIR systems; Mindy's MFA only ensures Mindy isn't the weak link. An assessor would puncture the stronger claim.
- Scope of the control-satisfaction is the Mindy app/enclave itself (Mindy-as-CUI-custodian), per [[cmmc_cui_custody_strategy]].

---

## 6. Phases (each independently shippable + provable)

| Phase | Deliverable | Proof (rule #2) |
|---|---|---|
| **P0 — Provider-linking + paid MFA + paid=OAuth-only** ✅ APPROVED (Eric, 2026-07-13) | Configure Supabase identity-linking (password+Google+Azure → one user); paid accounts = OAuth-only sign-in (password kept for free); first-party MFA options (email-OTP / SMS / **TOTP via native `supabase.auth.mfa`**) for the migration cohort + no-SSO paid fallback; **build recovery/backup codes** (not native); enroll-at-upgrade; enforce via **AAL2** for paid; `MFA_ENFORCED_PAID` flag + canary | Same email via password then Google resolves to ONE `auth.users` id; a NEW paid account can only sign in via Google/MSFT; an existing paid password user is guided to link a provider and isn't locked out mid-migration; a free login is unaffected; a Google login isn't double-prompted; TOTP enrol→verify round-trips (aal1→aal2); a recovery code logs in a user with a lost phone exactly once |
| **P1 — Adopt account_id (dual-write)** | Add `account_id` to the 19+5 user-scoped tables (hand-run migrations, [[cron_use_dispatcher]] rules); backfill from email→user_id; begin dual-writing account_id alongside user_email | Migration verified (column exists); backfill count == distinct users; new writes populate both keys; a spot-check user's rows all share one account_id |
| **P2 — Cut reads to account_id** | Migrate the hottest identity joins (auth, entitlements, workspace, vault, pipeline) from email → account_id; email demoted to attribute | `hasProAccess`, workspace membership, vault scoping all resolve by account_id; changing a test user's email leaves all access intact with ZERO re-key |
| **P3 — Change-email + merge become trivial** | Self-serve change-email = update the email attribute (+ mandatory verify-click on new address, [[change_email_duplicate_account_pattern]]); admin merge = repoint account_id B→A | Change email end-to-end: everything intact, old email freed, no dropdown leak; merge a Keidra-shaped fixture → one account, one Stripe sub, one workspace owner |
| **P4 — Workspace de-domain (coming)** | Workspaces keyed by explicit workspace_id/account_id, not email domain | Two same-domain signups do NOT auto-share a workspace |

---

## 7. Acceptance criteria

- [ ] One human with password + Google + Microsoft for the same email = ONE account (one `auth.users` id), not three.
- [ ] Changing a user's email updates ONE attribute; all purchases, Pro status, workspace, vault, pipeline intact with zero re-key sweep.
- [ ] Merging two accounts = repointing one `account_id`; no manual Supabase+KV+Stripe reconciliation.
- [ ] MFA is enforced for **paid** accounts (Pro union) and NOT required for free (free = opt-in only); OAuth users satisfy it via their provider; enrollment happens at upgrade, never a retroactive lockout.
- [ ] **Paid = OAuth-only**: a new paid account can sign in only via Google/Microsoft; password sign-in works for free accounts; existing paid password users are migrated onto a provider (or a first-party factor) without being locked out.
- [ ] Paid users can CHOOSE their second factor among email-OTP / SMS / TOTP (not a single forced channel); TOTP enrol+verify works.
- [ ] No per-user MFA off-toggle for paid users.
- [ ] All identity migrations are dual-write/phased with a proof at each step; no big-bang cutover of the 345 sites.
- [ ] Marketing literature updated (rule #8): the security/identity story appended to `MARKETING-FEATURE-LITERATURE.md`.

---

## 8. Defer-or-execute

**✅ APPROVED to build (Eric, 2026-07-13): P0 as a standalone** — provider-linking + paid-only MFA + paid=OAuth-only. Highest security ROI, smallest surface, stops NEW auth-layer duplicates immediately, doesn't wait on the big key migration.
**Execute next (not yet approved):** P1 (add + backfill account_id, dual-write) — the foundation everything else stands on; low-risk because it only ADDS a column and dual-writes.
**Then:** P2 → P3 (change-email/merge fall out nearly for free once P2 lands).
**Defer (coming):** P4 workspace de-domain; passkey/WebAuthn.

**Open questions — RESOLVED (Eric, 2026-07-13):**
1. **Paid MFA channel** → *choice* of email-OTP / SMS / TOTP (not one forced channel). TOTP is IN for P0.
2. **Free-tier password users** → MFA **optional** (opt-in, no enforcement).
3. **OAuth-only for paid?** → **YES.** Paid = Google/Microsoft sign-in; password kept for free.
