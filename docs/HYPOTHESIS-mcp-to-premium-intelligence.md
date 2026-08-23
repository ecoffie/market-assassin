# HYPOTHESIS: MCP → Premium Intelligence

**Status:** FROZEN — collecting · **Opened:** 2026-08-23 · **First read:** 2026-08-30 · **Decision point:** 20–30 repeat-report users

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
