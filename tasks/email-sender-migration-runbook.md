# Email Sender Migration — govcongiants → getmindy (sequenced)

**Goal:** Move outbound email onto the Mindy/getmindy sending identity **without
breaking the daily alerts** the ~1,337 active users depend on. The ordering matters:
warm the new sending domain on a small audience FIRST, then move the alerts.

**Owner ask (Eric, June 10):** beta emails come from getmindy now; alert migration is
"ready, intentionally deferred." Keep them SEPARATE until the deliberate flip.

---

## Current state (as of June 10, 2026) — SEPARATED, on purpose

| Stream | Sends FROM | Provider | How it's set |
|---|---|---|---|
| **Beta emails** (725 cohort) | `Mindy <hello@mail.getmindy.ai>` | Resend (verified) | **per-send `from` override** in `scripts/send-beta-v1-email.ts` (`BETA_FROM`). Reply-To `hello@getmindy.ai`. |
| **Daily alerts / welcome / resets** (~1,337) | `alerts@govcongiants.com` | Office365 SMTP | the **global** `EMAIL_FROM` default in `src/lib/send-email.ts` |

**They do NOT share a from-address.** The beta runner passes its own `from` per send,
so sending beta email has ZERO effect on the alerts. The only thing that merges them
is the `EMAIL_FROM` env flip (below) — which is deferred.

**Infra ready (Eric set up June 10):**
- Google Workspace on getmindy.ai: `hello@` + `support@` shared Group inboxes (Annelle
  monitors), `eric@`, `social@`. → RECEIVES.
- Resend Pro (50K/mo): `mail.getmindy.ai` verified for SENDING.
- `MINDY_FROM_NAME=Mindy` set in Vercel (Production). 19 hardcoded sender names →
  `process.env.MINDY_FROM_NAME || "Mindy"`.
- 3 cold-email domains acquired (getmindyai.com, trymindyai.com, mindygovcon.com).

---

## The sequence (DO NOT reorder — this is the whole point)

### Phase 1 — Send the beta emails (warms the new domain)
Run `scripts/send-beta-v1-email.ts --email=N --send` to the 725 cohort, RAMPED:
- `--limit=25` first → watch Resend bounce/complaint rate.
- then the full 725, then the rest of the 7-email series on cadence.
This sends real Mindy email from `mail.getmindy.ai` to a smaller, engaged audience —
**warming the sending domain's reputation** before it ever touches the alert volume.
Alerts keep running on govcongiants/Office365, untouched.

### Phase 2 — Watch deliverability (a few days)
Monitor Resend (bounces, complaints, spam-rate) + that beta replies land in
`hello@getmindy.ai`. Confirm `mail.getmindy.ai` is landing in inboxes, not spam.
Only proceed when the new domain looks healthy at the beta volume.

### Phase 3 — Flip `EMAIL_FROM` (moves the alerts) — THE deferred step
In Vercel (Production): `EMAIL_FROM` `alerts@govcongiants.com` → `alerts@mail.getmindy.ai`.
After this, ALL email (alerts, welcome, resets, briefings) sends as
`Mindy <alerts@mail.getmindy.ai>` via Resend. ~2-minute change, instantly live.

**⚠️ Before flipping, know the risks:**
1. **Office365 fallback breaks for getmindy from-addresses.** `sendEmail()` falls back
   to Office365 SMTP if Resend fails. Office365 CANNOT send "from" an
   `@mail.getmindy.ai` address (not authorized) → a fallback would bounce. So after the
   flip, Resend must be reliable, or set up an alt fallback that can send as getmindy.
2. **Volume jump.** The alerts are the big daily volume (~1,300/day). The flip puts
   that on `mail.getmindy.ai` at once — which is WHY Phase 1+2 warm it first.
3. **DMARC/SPF/DKIM** for `mail.getmindy.ai` must be aligned (Resend auto-added via
   Vercel DNS — verify before the flip).

### Phase 4 — Decommission govcongiants sending (later, optional)
Once everything's stable on getmindy, the govcongiants Office365 send path can be
retired. No rush; it's harmless to leave as a dormant fallback.

---

## The rule
**Beta email warms the domain; the alert migration is the deferred `EMAIL_FROM` flip,
done deliberately AFTER the domain is proven — never bundled with the beta send.** A
brand-new sending domain's first big send must NOT be the daily alerts.

*Related: `scripts/send-beta-v1-email.ts`, `src/lib/send-email.ts` (EMAIL_FROM +
replyTo), `docs/mindy-brand-kit.md` (email branding rules), the beta cohort runbook
`tasks/beta-v1-trial-extension-runbook.md`.*
