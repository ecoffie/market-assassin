# Email Series — Beta → Mindy 1.0 (VALUE-FIRST, Eric's voice)

**Rewritten to the GovCon Giants email playbook** (`~/Bootcamp/EMAIL-SEQUENCE-10-DAY-NURTURE.md`):
- **Value/insight first, product second.** Each email teaches a real GovCon win; Mindy
  is the *quiet enabler* (usually in the P.S. / soft CTA), NEVER the headline.
- **Eric's first-person voice:** "Hey {{first_name}}", contrarian insight, real numbers
  as proof, *homework*, signed Eric, P.S. teasing the next email.
- Subject lines = curiosity/value, never "feature X is live."

**Audience:** 725 beta cohort (`trial_ends_at=2026-07-30`). 75% have incomplete
profiles → the "win" in several emails REQUIRES finishing setup (that's the nudge).
**Link:** `https://getmindy.ai/setup-account?email={{email}}` (set password → onboarding
→ Auto-setup). **Send:** `sendEmail()` batched (#58 cap), drop-on-convert/unsub.
**Cadence:** Day 0, 2, 4, 7, 11, 16, 24 (ends before July 30).

---

## The arc — each email is a WIN, the feature is the payoff

| # | Day | Subject (value/curiosity) | The GovCon win it teaches | Mindy in the P.S. |
|---|-----|---------------------------|----------------------------|-------------------|
| **1** | 0 | We upgraded. You kept your access (through July 30). | "The beta you used is now the real thing — and you didn't lose a day." (re-entry + goodwill) | "Log in once, set a password, and Mindy rebuilds your whole setup from one sentence." |
| **2** | 2 | The $243M market hiding behind ONE wrong code | Most contractors search ONE NAICS and miss 72% of their market (drones = 70+ codes). Search by what you SELL, not a code. | "Mindy does this for you — type a word, it finds the whole market. Try yours →" |
| **3** | 4 | Stop pitching the agency. Pitch the office that actually buys. | The "agency" doesn't buy — a specific office does. Find the office + the person, skip the gatekeeper. | "Mindy drills to the buying office + the real contacts. Finish your setup so it shows YOURS →" |
| **4** | 7 | Who's holding the contract you want? (find out in 10 seconds) | Before you bid, know the incumbent — their ceiling, when it expires, whether they're beatable. That's where capture starts. | "On any opportunity, Mindy shows who holds it now. Try it on one in your pipeline →" |
| **5** | 11 | The contracts in your backyard expiring in the next 18 months | Expiring contracts = the agency MUST rebuy. Get in 6-18 months early, before the RFP. Your unfair-advantage list. | "Mindy shows the expiring contracts in your NAICS. Set yours so it's about your market →" |
| **6** | 16 | I read a 142-page solicitation in 4 minutes (here's how) | The proposal grind kills small teams. The win: a compliance matrix + first-draft sections, fast — so you can actually bid more. | "Drop a solicitation into Mindy — it reads it, builds the matrix, drafts the sections →" |
| **7** | 24 | Your 30 days are almost up — here's what you'd walk away from | Recap the wins they've had access to; honest choice: keep it or drop to free (alerts stay). | "Keep Mindy Pro past July 30 →" (Stripe). "Or do nothing — your free alerts keep coming." |

**Profile-completion thread:** #2, #3, #5 make the win *require* their real profile
("so it shows YOURS") — that's how we convert the 359 incomplete without nagging.

---

## EMAIL 1 (Day 0) — APPROVED subject B · re-entry + goodwill
**Subject:** We upgraded. You kept your access (through July 30).
**Preview:** The beta you've been using is now the real thing.

> Hey {{first_name}},
>
> For the last few months you've had **Mindy** working in the background — federal
> opportunities in your inbox, market research a click away.
>
> That beta was set to end June 30. Instead of shutting it off, **we shipped the real
> thing** — and gave you **30 more days** on it, free, through July 30. Call it a
> thank-you for being early.
>
> Here's the one thing to do: the beta knew you by email. The real Mindy uses a real
> account. **Set a password once** — and Mindy rebuilds your entire setup from a single
> sentence about what you do. Two minutes, and you're further along than the beta ever
> got you.
>
> **[Log in & pick up where you left off →](https://getmindy.ai/setup-account?email={{email}})**
>
> More this week — I'll show you a few things the beta couldn't do yet.
>
> Eric
>
> *P.S. Tomorrow: the $243M mistake almost every contractor makes with a single NAICS code.*

---

## EMAIL 2 (Day 2) — the value lesson (Mindy in the P.S.)
**Subject:** The $243M market hiding behind ONE wrong code

> {{first_name}},
>
> Here's a mistake I see almost every contractor make:
>
> They pick **one NAICS code** and search it. Done.
>
> Problem: a real market doesn't live in one code. Take "drones" — federal buyers
> spent **$243M** on them last year, spread across **70+ NAICS codes**. The single
> obvious one (336411, Aircraft Mfg)? **28% of the money.** Search it alone and you
> miss **72% of your own market.**
>
> The fix is simple: **search by what you SELL, not by a code.** A keyword catches the
> work no matter how the contracting officer classified it.
>
> Your homework: think of the ONE phrase a buyer would use for what you do. That's
> your real search — not a code.
>
> Eric
>
> *P.S. This is the first thing I rebuilt in Mindy 1.0 — type that phrase, and it maps
> the whole market for you, every code, automatically. [Try yours →](https://getmindy.ai/setup-account?email={{email}})*

---

## Build order
1. ✅ Series rewritten value-first (above). #1 + #2 copy done.
2. Draft #3–#7 copy in the same voice, then HTML (template = `email-beta-v1-launch-1.html`,
   restyled for body-text-forward, less "feature box").
3. Wire send (gated: in-cohort, not converted, not unsubbed). Eric sends after review.
