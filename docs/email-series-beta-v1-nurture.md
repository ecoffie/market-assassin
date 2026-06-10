# Email Series — Beta → Mindy 1.0 Nurture (7 emails)

**Why a series:** Dashboard (June 10): **481 eligible, 359 (75%) profile-incomplete,
16 expired, 270 enabled-but-blocked.** One email won't convert a 75%-incomplete base.
Each email teaches ONE real feature AND gives a reason to log in + finish setup. The
incomplete profile is the conversion bottleneck — the series chips at it.

**Audience:** the 725 `beta_preview_v1_extension` cohort (trial through 2026-07-30).
**From:** GovCon Giants <hello@govcongiants.com> · **Send:** `sendEmail()` batched (#58 cap).
**Link (every email):** `https://getmindy.ai/setup-account?email={{email}}` → set
password → `/app/onboarding` → Auto-setup. (For already-set-up users it lands them in
the app.) **Voice:** plain language, "Mindy/Mindy Pro", no jargon.

**Cadence:** Day 0, 2, 5, 8, 12, 18, 26 (front-loaded, tapering) — all land before
the July 30 expiry, leaving room for a final "your trial ends" note.

---

## The 7 emails (feature per send)

| # | Day | Subject (draft) | Feature taught | The "log in" hook |
|---|-----|-----------------|----------------|-------------------|
| **1** | 0 | **We upgraded. You kept your access (through July 30).** | The switch + Auto-setup (#12) | "Set your password once — Mindy configures your profile from one line." |
| **2** | 2 | Stop guessing NAICS codes — just type what you sell | Keyword-first research (#11) | "Type 'drones' — Mindy finds the $243M market across 70+ codes you'd never list." Log in to try your own keyword. |
| **3** | 5 | See who's *really* buying — past the agency, to the office | Office-level buyer intel (#2) + full rosters (#9) | "Mindy drills to the buying office + the real contacts. Finish your profile so it targets YOUR agencies." |
| **4** | 8 | Who holds this contract now? (one click) | "Who holds this now?" incumbent intel (#8) + award drill-down (#4) | "On any open opportunity, see the incumbent, the ceiling, when it expires. Log in and try it on a live one." |
| **5** | 12 | The contracts expiring in your market — 6-18 months early | Recompete intelligence (#5) | "Mindy shows expiring contracts you can recompete. Set your NAICS so it shows YOURS." |
| **6** | 18 | Upload a solicitation — Mindy drafts the response | Proposal Assist (#6) | "Mindy reads the whole RFP, builds the compliance matrix, drafts sections. Log in and drop one in." |
| **7** | 26 | Your 30 days end July 30 — here's what you'd keep | Recap + pipeline (#10) + convert CTA | "You've got [X] saved. Keep Mindy Pro past July 30 →" (Stripe). Honest "or drop to free, alerts stay on." |

**Profile-completion thread:** emails 2, 3, 5 explicitly tie the feature to "finish
your setup so it's about YOUR market" — directly targeting the 359 incomplete.

**Guardrails:** suppression list honored every send; anyone who completes setup +
converts drops out of the remaining sequence; `{{first_name}}` → "there" fallback.

---

## Email #1 copy (subject B — APPROVED lead)
**Subject:** We upgraded. You kept your access (through July 30).
**Preview:** The beta is now the full product. Log in to pick up where you left off.

> **The beta is now Mindy 1.0 — and your access came with you.**
>
> Hi {{first_name}},
>
> For the last few months you've been using **Mindy** in beta — daily federal
> opportunities, market research, the works. That beta was scheduled to end June 30.
>
> Here's the good news: **we didn't shut it off. We shipped the real thing.**
>
> Mindy **1.0** is live — faster, sharper, and with the tools the beta only hinted
> at. And because you helped us get here, **your full access is extended 30 more days,
> through July 30** — so you can try the real version, not the beta.
>
> **One small step:** the beta logged you in by email. Mindy 1.0 uses a real account.
> **Set your password once** and you're in — Mindy will even set up your profile from
> a one-line description of what you do.
>
> → **[Log in & claim your 30 days →]**(https://getmindy.ai/setup-account?email={{email}})
>
> Pick up right where you left off. — The GovCon Giants team
>
> *Your extended access runs through July 30. Questions? Just reply.*

---

## Build order
1. ✅ Email #1 copy (above). HTML: `docs/email-beta-v1-launch-1.html`.
2. Emails #2–#7 copy + HTML — build after #1 is approved (reuse the template).
3. A small `sendEmail()`-backed sequence runner OR schedule via the existing
   email pipeline; gate each send on "still in cohort + not converted + not unsubbed".
