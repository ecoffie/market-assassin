# PRD — Migration Onboarding & Audience Segmentation

**Status:** Required BEFORE/AROUND the mi→getmindy migration. Decided June 10, 2026.
**Owner framing (Eric):** "Once we move everyone over to Mindy then we can deal with
[unconfigured users]." + "I'm not interested in vanity numbers — the bootcamp leads
we should do something else with."

> **READ ALSO:** `tasks/mi-to-getmindy-cutover-runbook.md` (the DOMAIN migration).
> This PRD is the AUDIENCE/onboarding plan that runs alongside it.

---

## 1. The real numbers (measured June 10, 2026 — strip the vanity)

| Segment | Count | Truth |
|---|---|---|
| `user_notification_settings` rows ("users") | **9,910** | a vanity number — mostly an imported list |
| **`bootcamp-batch-enroll` source** | **~8,200 (~83%)** | imported bootcamp contacts; **never opted into Mindy** |
| **Organic / non-bootcamp** | **~1,700 (~17%)** | actually signed up |
| **Alerts enabled (active audience)** | **1,337** | matches the dashboard's "1,336 active alert audience" |
| **Warm + configured** (alerts-on AND real non-default NAICS) | **~900–1,000** | the genuine product audience — **this is the business** |
| **Profile incomplete** (per dashboard) | ~359 | warm but unfinished setup |
| **Supabase auth accounts** (can actually log in / have a password) | **85** | the rest are email-token only, no login |

**The honest read:** the real user base is **~900–1,300**, not ~9,910. The other
~8,200 are a **top-of-funnel marketing list**, not users.

---

## 2. Two problems the DOMAIN migration does NOT fix

The cutover moves the URL. It does nothing about:
1. **No login** — ~9,825 of the alert audience have NO password/account; they auth by
   email-token (`ma_access_email` / 2FA token), not Supabase auth. They only *receive
   alert emails*.
2. **Generic profiles** — ~8,834 have only the default fallback NAICS
   (`541512/541611/541330/541990/561210`) or empty → generic/irrelevant alerts.

These are an **account-creation + activation project**, separate from the domain
cutover. Do NOT conflate them.

---

## 3. The plan — segment, then treat each segment differently

### 🟢 Segment A — Warm users (~1,300; the real base)
*Alerts-on, and/or organic signup, and/or a real configured profile.*
- **During migration:** keep email-token auth WORKING through the cutover (don't
  break their alerts). Links now resolve at getmindy.ai (301).
- **After migration (on stable getmindy.ai):** run **"claim your account"** — email
  each: *"Set your password + tell us what you do in one sentence"* → password set →
  **Auto-setup (#12, built)**: paste → grounded profile + keywords → relevant alerts.
- This list is small enough to email **safely** (batched, per the #58 cap) and
  high-intent enough to **convert** — the activation that's actually worth running.

### 🔴 Segment B — Bootcamp leads (~8,200; NOT users)
*`bootcamp-batch-enroll`, generic profile, never opted into Mindy.*
- **Do NOT** run "claim your account" on them — it's cold outreach, a deliverability
  bomb (8,200 cold sends would spam-flag the domain the warm users depend on), and a
  vanity-number chase.
- **Suppress their generic alerts.** Sending generic 541-IT alerts to people who
  never configured is spam-signal + brand damage. Turn off (or never start) their
  alert sends. *(Verify against the daily-alerts cron audience filter.)*
- **Move to low-frequency nurture** — an occasional GovCon-tips / value newsletter
  (the $82B story, market-research lessons), NOT the app.
- **Let content qualify them.** When one **self-selects** (clicks, replies, asks),
  THEN invite *that* person into the real onboarding (claim account + Auto-setup).
  Quality content promotes the few who are real; the rest stay a marketing list.

---

## 4. Sequence (locked)
1. **Domain migration** (cutover runbook) — email-token auth still works; nobody
   loses alert access; old links 301 to getmindy.ai. **Carefully flip the
   host-pinned auth redirects (runbook bucket C) — verify on prod before the 301.**
2. **Suppress bootcamp-lead generic alerts** + move them to nurture list
   (deliverability + brand protection first).
3. **"Claim your account" activation on Segment A only** (~1,300) → Auto-setup →
   real profiles + passwords + relevant alerts.
4. **Ongoing:** content-driven qualification promotes self-selecting bootcamp leads
   into Segment A over time.

## 5. Success criteria (honest, not vanity)
- [ ] Migration: zero warm users lose alert access; old email links resolve.
- [ ] Bootcamp leads no longer receive generic/irrelevant alerts (spam-signal gone).
- [ ] Segment A activation measured by **profiles configured + passwords set**, NOT
      "emails sent." Target the conversion of the ~1,300 warm, not 9,910.
- [ ] Domain deliverability protected (no mass cold-send event).
- [ ] A self-selecting bootcamp lead has a clean path into real onboarding.

## 6. What to build (mostly reuse)
- **Segmentation query** — tag each row warm (A) vs bootcamp (B) via
  `invitation_source` + `alerts_enabled` + non-default NAICS. (Add a `segment`
  column or compute on the fly.)
- **Alert suppression for Segment B** — extend the daily-alerts audience filter to
  exclude unconfigured bootcamp leads. (Reuse the #58 suppression mechanics.)
- **"Claim your account" flow** — Supabase invite / set-password link → onboarding.
  Lands on **Auto-setup (#12, already built)**. `auth.getmindy.ai` is already live.
- **Nurture list export** — Segment B → the marketing/newsletter system (GHL), out
  of the alert pipeline.

## 7. The principle
**Migrate the real ~900–1,300. Nurture the ~8,200. Never chase the 9,910.** The
domain cutover is safe and mechanical; the audience work is where the judgment is —
and the judgment is: *don't onboard people who never asked to be users.*

*Related: `tasks/mi-to-getmindy-cutover-runbook.md`, `docs/ROADMAP.md` (infra notes:
unconfigured users), Auto-setup = marketing literature #12.*
