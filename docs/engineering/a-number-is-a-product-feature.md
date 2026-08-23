# A number is a product feature

**Frozen as a Mindy engineering principle, 2026-08-23, after the measurement-integrity audit.**

> If Mindy displays `10,667`, `47%`, `$1.8B`, `80 suppliers`, or `3.4 bidders`, that number
> deserves the same product discipline as a button, a workflow, or an API. It needs
> provenance, completeness, current semantics, honest failure behavior, and a test
> protecting those properties.
>
> — Eric

---

## Why this is a principle and not a preference

The audit that produced it found the failure mode twice in one week, and neither instance
crashed anything:

| surface | displayed | true | consequence |
|---|---:|---:|---|
| `admin/onboarding-funnel` | understated stages 3–5 | full population | drop-off looked worse than it was — "our onboarding is collapsing after signup" is a sprint you might spend on a severity that was partly a measurement artifact |
| `admin/user-breakdown` | **1,000 users** | **10,667 users** | activation, market size, support load and roadmap priority all read differently |

Eric's framing:

> **Mindy's most dangerous data bugs are not errors that crash the product; they are numbers
> that look plausible enough to influence a decision.**

and on the cap specifically:

> It "was not creating small errors. It was creating **different realities**."

A crash announces itself. A truncated read returns a confident figure a human then acts on.

---

## The five properties every displayed number owes you

A number is not "done" when the query returns. It is done when all five hold.

| property | the question | how it fails silently |
|---|---|---|
| **Provenance** | where did this come from, and can we point at the source? | an LLM guess or a hardcoded constant reads identically to a measured value |
| **Completeness** | is this the whole population? | PostgREST caps at 1,000 rows with no error, no warning, no flag |
| **Current semantics** | does the classification still match the product? | `feature-usage` matched legacy URLs after the product consolidated to `/app` |
| **Honest failure** | does the UI say *unknown*, or invent a zero? | `count ?? 0` turns "I don't know" into a load-bearing 0 |
| **A test** | does something fail when one of the above breaks? | a green build proves compilation, not correctness |

The first four are the `RUNS / COMPLETE / CURRENT / HONEST` contract in
`src/lib/analytics/measurement-integrity.ts`. The fifth is what stops a verified number
from quietly decaying back.

### Two rules that fall out of it

Both are load-bearing, and both are already enforced in code:

1. **Don't assert what the system can derive.** The integrity block's audit date reads the
   newest `verifiedOn` in the ledger. A hand-entered date would have been a tiny,
   harmless-looking factual error *inside a dashboard dedicated to preventing tiny,
   harmless-looking factual errors*.
2. **Don't turn unknown into zero.** An unreadable gate baseline renders `unknown`. A
   missing table returns `count=null, error=null, HTTP 204` — no error at all — so `?? 0`
   destroys the only signal separating *missing* from *empty*.

---

## Two rules learned the hard way (frozen 2026-08-23)

### 1. Never infer write impact from a capped RETURNING payload

> A write can be **correct** while its receipt is **truncated**.

`UPDATE … .select()` updates every matching row, but PostgREST returns at most 1,000 of them.
Counting that payload under-reports the work done. Measured: the recompete prune runs against a
**137,186-row** candidate set, so a backlog prune silently reported "≤1,000 pruned".

**Rule:** when the write population can exceed the response cap, ask for an **exact affected-row
count** (`{ count: 'exact' }`) — never `data.length`. And a `null` count is *unknown*, so surface
it as a failure rather than reporting "0 affected".

This generalises: **any** count derived from a response payload inherits that payload's cap.

### 2. A verification must be able to prove the change actually landed

`aggregate-profiles` was reported fixed and wasn't. A string-replace whose anchor didn't match
**wrote nothing and exited 0** — the operation "succeeded", the commit message said fixed, the
code was unchanged, and it kept reading 1,000 of 1,364 rows.

**Rule:** after any programmatic edit, **re-read the target and confirm the new symbol is
present**. Prefer a per-line audit (is this specific line paged / counted / bounded / waived?)
over a summary gate — a headline count can go down while an intended fix never landed. A probe
that cannot fail proves nothing; see the negative-results rule.

---

## Why this matters more in the government market

A contractor seeing a wrong dashboard count is bad.

A **contracting officer** using an incorrect supplier count, competition measure, or
market-research conclusion in an **acquisition decision** is a materially higher bar. Market
research feeds set-aside determinations and Rule-of-Two analysis; a fabricated "80 suppliers"
or a truncated "3.4 average bidders" is not a UI defect at that point.

So the integrity work is **not a detour from the government product — it is the
infrastructure that makes the government product credible.**

This is also why `docs/strategy/` treats grounding as an invariant rather than a nicety: the
number and its defensibility ship together, or neither ships.

---

## What to actually do

**Adding a surface that displays a number:**
1. Name its population and read it completely (paginate, or use `count:'exact'`).
2. Confirm the classification matches the *current* product, not how it used to work.
3. Make failure render `unknown` / `unavailable` — never a plausible zero.
4. Write the test that fails when one of those breaks, and **watch it fail** before trusting
   it (`inject → red → revert → green`).
5. If it is a claim-producing route, add it to `CLAIM_ROUTES_UNVERIFIED` — it becomes
   verified when a human checks all four against live data, not when it merges.

**Reviewing one:** a suspiciously round figure in an admin dashboard is a lead. Three
identical `1000`s side by side is the cap's signature, not a coincidence.

**Triage for what remains (Eric, 2026-08-23):** *fix only when the route can materially change a
human decision or silently mutate incomplete data — otherwise prove boundedness and document the
waiver.* Paginating a six-row dead-letter queue because a static analyzer lacks business context
is motion, not progress.

**Prioritising:** the goal is **not zero warnings**. It is *no important decision being made
from a number Mindy cannot defend.* Rank by consequence and population size. Some findings
deserve fixes; others deserve documented boundedness (`// truncation-ok: <why the cap cannot
affect correctness>`).

---

## Current state of the audit

Read the live block first — `GET /api/admin/platform-health` → `decisionMetricsIntegrity`:

```
Decision Metrics Integrity
  Claim-producing routes: 10/10 verified
  Unverified claim routes: 0
  Operational risks: 10
  Known truncation findings: 118
  Last integrity audit: 2026-08-23
```

**Where this sits on the roadmap is deliberately NOT recorded here.** This file is a
permanent engineering constraint; priorities change weekly and a stale hierarchy inside a
permanent doc is exactly the confidently-wrong instruction this whole principle exists to
prevent. The current order lives in `CLAUDE.md` under "Current priority order" — read it
there.

What IS permanent: **the goal is not zero warnings.** Remaining findings are ranked by
consequence, and integrity debt yields to work that is in front of the business. Tier by
CONSEQUENCE, not by directory — `cron/daily-alerts` carries baseline findings but is a
*delivery* path users see every morning, which makes it reliability work, not cleanup.

## See also

- `docs/engineering/postgrest-1000-row-cap.md` — the mechanism, and all four incidents
- `src/lib/analytics/measurement-integrity.ts` — the ledger and the four-part contract
- `src/lib/analytics/integrity-status-block.unit.test.ts` — the anti-rot tests
