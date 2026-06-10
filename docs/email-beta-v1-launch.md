# Launch Email — Beta → Mindy v1.0 (the 725 trial-extension cohort)

**Audience:** 725 beta-preview users seeded `trial_source='beta_preview_v1_extension'`,
`trial_ends_at=2026-07-30`. They have full Mindy Pro right now; this email tells them
the beta became v1.0 and drives the LOGIN (which creates their profile → Auto-setup).

**From:** GovCon Giants <hello@govcongiants.com>
**Send via:** `sendEmail()` (Resend primary), batched per the #58 per-recipient cap.
**Link:** `https://getmindy.ai/setup-account?email={{email}}` (email → set password →
`/app/onboarding`). Pre-fills their email so it's one step.

**Voice check (vocab rule):** plain language. Say "Mindy" / "Mindy Pro". No "MI",
no "TAL/ICP/GTM". Honest, warm, not hypey.

---

## Subject line options (pick one — A is the lead)
- **A.** `Your beta just became Mindy 1.0 — 30 more days, on us`
- B. `We upgraded. You kept your access (through July 30).`
- C. `{{first_name}}, your Mindy access didn't expire — log in to claim v1.0`

**Preview text:** `The beta is now the full product. Log in to pick up where you left off.`

---

## Body copy (the words)

**Headline:** The beta is now Mindy 1.0 — and your access came with you.

Hi {{first_name}},

For the last few months you've been using **Mindy** in beta — daily federal
opportunities, market research, the works. That beta was scheduled to end **June 30**.

Here's the good news: **we didn't shut it off. We shipped the real thing.**

Mindy **1.0** is live — faster, sharper, and with the tools the beta only hinted at:
keyword-first market research, expiring-contract intel, pipeline tracking, and
proposal help. And because you helped us get here, **your full access is extended 30
more days — through July 30** — so you can try the real version, not the beta.

**One small step:** the beta logged you in by email. Mindy 1.0 uses a real account.
**Set your password once** and you're in — Mindy will even set up your profile from a
one-line description of what you do.

→ **[Log in & claim your 30 days](https://getmindy.ai/setup-account?email={{email}})**

That's it. Pick up right where you left off.

— The GovCon Giants team

*Your extended access runs through July 30. Questions? Just reply to this email.*

---

## What happens when they click (the conversion path)
1. `getmindy.ai/setup-account?email=…` → set password (one step, email pre-filled)
2. → `/app/onboarding` → Auto-setup (paste one line → grounded profile + alerts)
3. → full Mindy Pro (trial, through July 30) → a real `user_profiles` row is created
4. Before July 30: convert to paid, or drop cleanly to free.

## QA before send
- [ ] Test send to yourself — link resolves to getmindy.ai/setup-account, email pre-fills.
- [ ] Send via `sendEmail()` batched (per #58 cap) — NOT one blast.
- [ ] Suppression list honored (don't email anyone who unsubscribed).
- [ ] `{{first_name}}` falls back gracefully to "there" if missing.
- [ ] Resend dashboard: watch bounce/complaint rate on the first batch before scaling.
