# FROZEN — MCP trial pricing (evidence, not a redesign)

**Pricing is FROZEN as of 2026-08-25.** The 100-credit signup grant and per-tool prices
are unchanged. This file records the evidence gathered so it is not rediscovered later as
*"someone thought 100 credits seemed expensive."*

**Record, don't redesign.** Re-open only when the freeze lifts or a second independent
user reproduces the capability-match pattern below.

## What triggered the investigation

A user (Maria Vazquez, `abcrossfit@hotmail.com`) reported during a live session that her
credits were "all used up." She had 15 remaining — but had spent 85 of 100 in about five
minutes, hit `rejected_no_credits` mid-session, and experienced it as a wall.

## The aggregate — measured, and it did NOT support a pricing change

126 trial users · 62 activated (≥1 successful call).

| bucket | n | % of activated |
|---|---:|---:|
| never hit the wall | 40 | 64.5% |
| **hit wall DAY 1** | **15** | **24.2%** |
| hit wall days 2-7 | 5 | 8.1% |
| hit wall later | 2 | 3.2% |

Day-1 cohort: median **11 successful calls**, median **14 minutes** to the wall, **57%**
of pre-wall calls were exploration tools.

**The wall correlates with ENGAGEMENT, not abandonment:**

| cohort | n | returned ≤7d | converted |
|---|---:|---:|---:|
| hit wall day 1 | 15 | **60.0%** | 40.0% |
| never hit the wall | 40 | **15.0%** | 35.0% |

Users who hit the wall return at **4x** the rate of those who never do. That is why
pricing was NOT changed.

⚠️ Caveats that must travel with those numbers: n=15 is small, the 40% vs 35% conversion
gap is inside noise at that size, and this is correlation — engaged users both hit the
wall and return.

**Credits are spent on:** exploration is 36.9% of all credits despite
`search_sam_opportunities` being by far the most-called tool (644 calls). The single
largest consumer is `generate_market_report` — **17.6% of all credits from just 33 calls**.
So the pattern is *many cheap searches, a few expensive reports*; cheaper exploration alone
would not move the aggregate.

## ⚠️ THE FINDING TO ACT ON WHEN THE FREEZE LIFTS

**`capability_market_match` costs 100 credits — exactly equal to the signup grant.**

Observed once (`coachbimpe2011@gmail.com`), verbatim from the ledger and call log:

| time | event |
|---|---|
| 2026-08-22 20:47:38 | `signup_grant` **+100** |
| 2026-08-22 23:17:51 | `capability_market_match` — **success, 100 credits charged, 12,158 ms** |
| 2026-08-22 23:22:47 | `search_contractors` — **rejected_no_credits** |
| — | **never returned** |

The charge is CORRECT: `TOOL_CREDITS` lists it at 100 and it was charged 100. **This is not
a billing defect.** It is a structural one — a 100-credit tool inside a 100-credit trial
means one specific first move leaves zero room for anything else.

It is also the most intuitive first action: *"match my capabilities to a market"* is
exactly what a new user wants, and it is what company setup naturally leads toward.

### Two patterns that both end in `rejected_no_credits` and are NOT the same problem

| | **Maria pattern** | **Capability-match pattern** |
|---|---|---|
| shape | many calls → learned the product → exhausted the trial **through engagement** | **one intuitive first action** → entire trial consumed → next action blocked |
| calls before wall | 17 | **1** |
| returned after | yes | **no** |
| what it says | the allowance is small for an engaged user | a single action can end the trial before the user understands the product |

Treating these as one problem — "users run out of credits" — would hide the second, which
is the more serious of the two.

### The question to open with when the freeze lifts

**Not** *"should this cost 50 instead of 100?"* but:

> **Should any single normal first-session action be capable of consuming 100% of the free
> trial without explicit user awareness?**

That is broader and admits better answers: repricing, a first-use allowance, a confirmation
when a call will consume most of the remaining balance, or packaging the capability match
differently.

**n=1. Record, do not redesign.**

## Customer recovery already applied — NOT a pricing change

Tagged `courtesy_credit_restore_first_session` so it can never be mistaken for policy
issuance or counted as a paid grant in economics analysis.

| | |
|---|---|
| `abcrossfit@hotmail.com` | +85 (her exact first-session spend) |
| 7 further day-1 wall users, never paid | **+555 total**, per-user amounts |
| verified | 8 adjustments · balances reconcile · **no original debit modified** |

**Deliberately NOT restored:**

* `coachbimpe2011@gmail.com` — never returned, and 100 credits back into the same
  structure would let them repeat the identical one-call trial. Recovery here is an
  outreach decision, not a ledger one.
* `rochbuf@gmail.com` — spent 5 credits, then made 97 calls. Not the same case.
* 6 users who hit the day-1 wall and **later converted to paid** — restoring theirs would
  be a discount, not a recovery.

## ⚠️ A methodological note worth keeping

This investigation produced a **fabricated finding** before it produced a real one. A query
selected `tool, status, credits` — columns that do not exist on `mcp_call_log`. PostgREST
failed the whole query and returned `count = null`; `?? 0` turned that into "0 tool calls",
and a **19% fleet-wide logging gap** was reported as fact. The true gap was **1 row** — a
probe inserted during the investigation itself.

The same session also reported "51% of trial users never activate." That was an artifact of
defining *activated* as *made an MCP call*: **49 of those 64 were active Mindy users** who
had simply never used MCP. Genuine non-users: **15 of 126 (11.9%)**.

Both were caught by insisting the numbers reconcile. **Bind `{ data, error }`; a failed
query must never read as a measured zero.**
