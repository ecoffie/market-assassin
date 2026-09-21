# A measurement must prove its own completeness

**Frozen 2026-08-25 (Eric).** Companion to `a-number-is-a-product-feature.md`.

That document governs numbers Mindy **displays**. This one governs numbers we **decide
from** — and the difference matters, because a wrong displayed number embarrasses us while
a wrong decision number sends us building the wrong thing.

> **Before a number can influence a decision, the system must prove how that number was
> obtained and whether the requested population was exhausted.**

> **A measurement must prove its own completeness before we are allowed to redesign the
> product around it.**

## Why this is a rule and not a preference

One investigation on 2026-08-25 produced **three** figures confident enough to act on, and
all three were artifacts of a query silently returning less than it was asked for:

| reported | mechanism | truth |
|---|---|---|
| "19% of charges have no call-log row" | selected columns that do not exist → PostgREST failed the WHOLE query → `count` came back `null` → `?? 0` printed it as zero | gap was **1 row** — a probe inserted by the investigation itself |
| "51% of trial users never activate" | *activated* defined as *made an MCP call* | **83% were active Mindy users** who had never used MCP |
| "49 used Mindy elsewhere / 15 genuine non-users" | `.slice(0, 500)` on the lookup list instead of paging | **54 and 11** — five active users fell outside the window |

Each was reported as a finding. Each would have justified work. **We nearly redesigned
onboarding around an activation crisis that mostly did not exist.**

## The same failure at three layers, on the same day

| layer | shape |
|---|---|
| **Product** | incomplete evidence became a confident answer — *"this company does not exist"*, *"\$0 award history"*, *"no small businesses in this market"* |
| **Data** | bounded samples became populations — an 880-row table answering *"does this contractor have federal history?"*; 6,864 contracts ranked, 50 returned, the company's own vehicle cut |
| **Analysis** | failed or truncated queries became business conclusions — the three above |

`unknown ≠ none` describes the symptom. The rule above describes the obligation: **the
burden is on the measurement to demonstrate its own coverage**, not on the reader to
suspect it.

## ⚠️ Diagnostic and analysis scripts are IN SCOPE — arguably more than production code

This is the part that is easy to get wrong. A script in `scripts/` feels disposable, so it
skips the guards that `src/` enforces. But **its output becomes the evidence used to decide
what to build**, and unlike a product bug there is no user to notice it is wrong.

Every script that produces a number someone might act on must:

* **bind `{ data, error }`** and surface the error — never `?? 0` on a count
* **page to exhaustion** — PostgREST caps a response at 1,000 rows regardless of `.limit()`
* **never hand-slice a lookup list** (`.slice(0, 500)`) in place of chunking + ranging
* **state its population and its definition** — "activated" meant "used MCP" and nobody said so
* **reconcile** — buckets must sum to the whole, and the whole must be stated

The pre-push gates (`audit-supabase-errors`, `audit-unranged-selects`) already enforce the
first three. **On 2026-08-25 the un-ranged-select gate blocked the commit that recorded this
very lesson**, and it was right: the analysis script still had a 500-row slice in it.

## What caught the three errors

Not the author. Every one was caught by something outside the reasoning that produced it:

1. **Insisting the numbers reconcile.** 1,953 debits vs 1,952 logs is a gap of one; 19% was
   not a plausible shape and did not survive being checked against a second query.
2. **Demanding a mutually exclusive accounting** before accepting an aggregate. Bucketing
   all 64 non-activators — rather than proposing an onboarding fix — is what revealed that
   most of them were active users.
3. **A pre-push gate** somebody built for exactly this class.

The practical implication: **a number that has not been reconciled against an independent
query has not been measured.** Sum the parts. Compare two paths to the same figure. If they
disagree, the disagreement is the finding.

## The test to apply before acting on any number

1. What population was requested, and how do we know it was fully returned?
2. What definition is behind the label — and would a reader guess it correctly?
3. Does it reconcile with a second, independent derivation?
4. If the query had failed, would the output be distinguishable from a real zero?

If **4** is "no", the number cannot influence a decision yet.

## Confidence is not evidence. Reconciliation is evidence.

Every wrong number on 2026-08-25 was held confidently at the moment it was reported. None
of them was caught by the reasoning that produced it. Confidence was the least reliable
signal available.

So the practical shortcut is the fourth question above, stated as a stop condition:

> **If this query failed, could its output look exactly like a legitimate zero?**
> If yes, stop. The number is not usable yet.

A dashboard count, funnel metric, market size, supplier population, conversion rate or
research finding does not become product strategy because a query returned it successfully.
It becomes usable when a second, independent derivation agrees.

## ⚠️ A later measurement contradicting an earlier conclusion is the process WORKING

This is the cultural half of the rule, and the easiest to lose.

When a new number overturns something we already decided, the instinct is to treat it as
the measurement process having failed — a wasted day, a bad call, something to defend
against. It is the opposite. **Several of the best decisions on 2026-08-25 came from
disproving something that initially looked obvious:**

* *"19% of charges have no log"* → disproven → **no logging defect existed**
* *"51% of trial users never activate"* → disproven → **onboarding was not redesigned around a crisis that was not there**
* *"the day-one wall is driving users away"* → disproven → users who hit it **return at 4x the rate** of those who do not, so pricing was left alone
* *"49 elsewhere / 15 non-users"* → corrected to **54 / 11** by a pre-push gate

Four conclusions overturned in one investigation, and every reversal prevented work that
would have been aimed at the wrong thing.

**Corollary:** a session that ends by disproving its own headline finding has done its job.
Treat a contradicted conclusion as a returned result, never as a defect in the person or
the process that produced it — otherwise the next contradiction gets argued with instead of
checked, and that is how a wrong number survives.

## The two disciplines belong together

| | |
|---|---|
| **Decision integrity** | Mindy never makes a consequential claim it cannot defend from evidence |
| **Measurement integrity** | *we* never make a consequential decision from a number that cannot prove its own completeness |

The first governs what the product says to a contractor. The second governs what we build
next. They are the same rule pointed in opposite directions, and neither survives long
without the other.
