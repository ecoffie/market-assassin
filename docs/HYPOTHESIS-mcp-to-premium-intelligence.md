# HYPOTHESIS: MCP → Premium Intelligence

**Status:** **FIRST READ DONE 2026-09-08 — hypothesis NOT supported (0 purchases of 198 rejections)** · **Opened:** 2026-08-23 · **Freeze lapsed:** 2026-08-30 · **Next:** a decision on where the boundary SITS — not a copy change

> ⚠️ **The read is done — do not re-run it as if it were still collecting.** Measured
> 2026-09-08 over 2026-08-23 → 09-07: **198 rejections · 32 users · 3 checkout-starts ·
> 0 purchases.** Questions 2 and 3 below are unanswerable by construction (a zero
> denominator, and no converters to compare), which is the correct outcome, not a gap.
> Cross-checked against `mcp_credit_ledger`: **zero `stripe_topup` rows** in the window,
> so this is genuinely "nobody bought," not a tracking miss. Shape: **197
> `insufficient_credits` vs 1 `requires_pro`** — an ALLOWANCE boundary, not a tier one.
>
> ⚠️ **The window is TWO cohorts, not one.** `PAYWALL_OFFER_VERSION` was bumped **v1 → v2
> on 2026-08-28** (`5cc57e71`, #1390) — four days INSIDE the freeze. It was done correctly
> via the escape hatch (a version bump, not a silent copy edit — exactly what the
> `offer_version` column is for), but any later analysis MUST split on it:
>
> | version | window | rejected | checkout starts | purchased |
> |---|---|---|---|---|
> | v1 | Aug 23 → 28 | 40 | 3 | **0** |
> | v2 | Aug 28 → Sep 7 | 158 | **0** | **0** |
>
> Both converted zero, so the headline holds either way. **v2 is still collecting and was
> never given its own read date.** Do NOT conclude "v2 is worse" from 3 v1 checkout-starts —
> the windows differ in length and traffic as well as copy.

> MCP is primarily an acquisition and discovery surface rather than a substitute for the
> Mindy application. MCP usage exposes questions that create demand for structured,
> proprietary Mindy intelligence products such as Market Reports.

This is recorded as a hypothesis, not a strategy change. It resolves — if it holds — the
open tension in Working Backwards #1 §9, where MCP looked like it might be the channel most
efficient at *preventing* the destination habit from forming. The funnel reading says MCP
creates demand for something only we have; the substitute reading says the relationship
lives in someone else's chat window. §9 says shipping without choosing chooses substitute
by default.

---

## What actually prompted this

Mindy Day (2026-08-22) put 104 new users on MCP. Five reached the end of the free 100-credit
grant; three of those spent the whole grant on a single premium call.

**The tempting read was "4 of 4 repeat-report users bought." That does not survive the
timestamps.** Checked against `purchases.created_at`:

| User | First premium report | First purchase | Order |
|---|---|---|---|
| jgruber@claveworkforce.com | 08-17 18:29 | 08-17 19:12 | **report → purchase, 43 min** |
| westover105@gmail.com | 07-21 16:20 | 06-23 12:09 | bought 28 days FIRST |
| louis.reed@reedasolutions.com | 08-22 11:48 | 07-28 21:14 | bought 25 days FIRST |
| rochbuf@gmail.com | 08-20 | — | 7 premium runs, **never bought** |

**Real evidence today: one clean report→purchase conversion.** Two were already customers
using a feature they had paid for; one heavy user has not converted at all. Any claim
stronger than "worth measuring" is unsupported.

What *is* structurally interesting, and independent of the sample: a market report answers
one NAICS in one geography. A contractor has several codes, adjacent states, and a market
that moves. One report is a sample of their market, not their market — so recurrence is
built into the product rather than manufactured.

## Named test

Among new MCP users, measure the percentage who subsequently generate a premium report,
attempt another premium action, and convert to paid — **versus comparable non-MCP users**.
Without the control arm this measures nothing: heavy users buy things.

## The funnel we now instrument

Shipped 2026-08-23 in `mcp_paywall_attempts`. Every refused premium call writes one row
carrying the whole path:

```
rejected_at → checkout_started_at → purchased_at → resumed_at → completed_at
```

The transition that matters most is the one that was previously invisible:

- **"Never wanted another report"** — no attempt row after the first success.
- **"Wanted another, hit the wall, did not buy"** — an attempt row with `rejected_at` set
  and `purchased_at` null.

Those are opposite product problems. A large second group means fix the offer. A large first
group means the report itself should surface the next market question ("You're strong in
Virginia under 541512 — want to see how Maryland compares?"), so the report creates the
second-report intent.

Before this table existed, both looked identical: silence.

## Cohorts

The wall changed on **2026-08-23**. That deliberately contaminates the experiment, and the
trade was made knowingly — preserving a wall we knew was weak, purely for measurement
purity, would have cost real conversions.

- **Cohort A** — refused before 2026-08-23. Saw: *"This tool costs 100 credits; your balance
  is 0. Top up at getmindy.ai/mcp."* Request discarded. Includes the three Mindy Day users.
- **Cohort B** — refused on or after 2026-08-23. Sees a per-tool offer naming what they got
  and what upgrading unlocks, with the request preserved through checkout.

Read them separately. Cohort A has no attempt rows at all, so its funnel is unmeasurable
beyond `mcp_call_log.status = 'rejected_no_credits'`.

## What would kill this hypothesis

- MCP users convert at or below non-MCP users once the control arm exists.
- Attempt rows accumulate with `purchased_at` null and the offer copy does not move it —
  the demand was never there, and the premium report is not the monetization surface.
- Repeat-report behavior stops predicting purchase as n grows past ~25. One clean
  conversion is a story; the pattern has to survive volume.

## What we are NOT doing

**Not changing the free allowance.** 100 credits is a sample, not a working allowance, and
it is currently running a useful natural experiment: one report is enough to understand the
product, and a serious user's actual market is not one NAICS × one geography. Adding
friction here would degrade the exact flow we are trying to measure.


---

## FROZEN 2026-08-23 — do not touch before the first read

`v1` is collecting a clean cohort. Until 2026-08-30, **do not** change:

- the offer copy, the CTA, or the checkout destination
- the free allowance (100 credits)
- premium tool pricing
- "small improvements" to the continuation flow

Any of those splits the cohort and the first read stops meaning anything. If a genuine
defect appears, fix it — and **bump `PAYWALL_OFFER_VERSION`**, which is what the version
column exists for. A silent copy fix is the failure mode this freeze exists to prevent.

## The first read answers three questions, in this order

Run `npx tsx scripts/paywall-funnel.ts`. Answer only these before discussing anything else:

1. **Do people who hit the premium boundary buy?** — `purchased / rejected`
2. **After buying, does continuation actually work?** — `completed / purchased`
   A gap here means people paid and never got their saved request. That is friction, and it
   makes question 1 flatter us.
3. **Does MCP exposure raise the probability of reaching and converting at that boundary,
   versus the control?** — MCP-origin users vs comparable non-MCP users. Without the control
   arm this measures nothing: heavy users buy things.

Only after those three does **MCP → premium intelligence** earn a move from hypothesis into
growth strategy.

## Why this record exists

The evidence that started this was a 4-of-4 conversion story. It did not survive the
timestamps — two of the four bought weeks *before* their first report, and a seven-run heavy
user has never bought. Real evidence was **one** clean report→purchase conversion.

Everything shipped on 2026-08-23 is instrumentation to find out whether the loop is real.
It is not a bet that it is. A future reader who finds this doc should treat the hypothesis
as unproven until the three questions above have numbers attached.

### One control that outlived its lesson

The pre-push gate blocked `scripts/paywall-funnel.ts` on its first push for an un-ranged
select. PostgREST caps at 1,000 rows, so the funnel would have computed on a silently
truncated set once attempts crossed that — the same class of failure that made an earlier
engagement table undercount ~47-fold. The lesson is now an engineering control rather than
a thing to remember, and it caught a measurement-integrity bug before the table held a
single row.

---

# FROZEN BASELINE — `capability_market_match` at 100 credits (pre-change cohort)

**Captured 2026-09-08, immediately before PR #1418 (100 → 50) merged.** Recorded here so
the post-change comparison never depends on re-deriving it, and so a later reader can tell
the two cohorts apart without trusting anyone's memory.

**Cohort definition (reproducible):** non-staff users (`user_email NOT LIKE '%@govcongiants.com'`)
whose FIRST `reason='tool_call'` ledger row is `capability_market_match`. At 100 credits every
such user was charged `delta = -100`, which is why the ledger alone separates the cohorts —
**no schema work, no flag, no backfill.**

| metric | value at 100 credits |
|---|---|
| users who OPENED with the tool | **8** |
| one-and-done (exactly 1 call ever) | **7 (87.5%)** |
| returned on another day | **1 (12.5%)** |
| reached 10+ actions | **1 (12.5%)** |
| avg calls per user | **7.0** |

**Reference population:** users who opened with ANY OTHER tool — **4 of 89 one-and-done
(4.5%)**, avg 31 calls. That ~19× gap is what motivated the change.

## How to read the treatment cohort

```sql
-- TREATMENT = post-change users; every capability_market_match row is delta = -50
SELECT ... FROM mcp_credit_ledger
WHERE reason = 'tool_call' AND tool_name = 'capability_market_match' AND delta = -50;
-- CONTROL   = the historical rows above; delta = -100
```

⚠️ **Wait for ~15-25 post-change users who actually invoke the tool before re-running.**
n=8 produced a large effect, but small-n effects regress; reading the treatment arm early
is how a real signal gets mistaken for noise or vice versa. Re-run the SAME six measures:
one-and-done rate · actions after the match · another-day return · % reaching 10 actions ·
time to wall · paid conversion.

⚠️ **This is a before/after comparison, not a randomized test.** The cohorts are separated by
TIME, so anything else that changed in the interval (traffic mix, a marketing push, seasonality)
is confounded with the price. It answers "did the early-session failure stop?" — it does not
prove the price alone caused whatever happens next. That distinction is the whole reason the
introductory-deliverable allowance is being held back rather than shipped alongside.
