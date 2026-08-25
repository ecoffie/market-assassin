# Failure taxonomy — classify before you fix

**Adopted 2026-08-25, closing Decision Chain Hardening Phase 1.**

This replaces the defect ledger as the primary triage tool. Every failure in that sprint
fits one of five classes, and the class determines the fix — not the symptom.

> The biggest result of Phase 1 was not the number of bugs fixed. It is that **Mindy now
> fails differently.** It used to convert a missing-evidence failure into a confident
> world fact. It now abstains.

## The five classes

| # | class | the question | Phase-1 example |
|---|---|---|---|
| 1 | **Evidence missing** | do we hold it at all? | `usaspending_awards` holds 880 rows across 373 recipients |
| 2 | **Evidence exists but UNREACHABLE** | can retrieval get to it? | NS-2 — the company's own SABER ranked ~568 of 6,864 and was cut |
| 3 | **Evidence reached but MISINTERPRETED** | does it mean what we read? | NS-3 — FA4610 read as "Air Force"; it is Space Launch Delta 30 |
| 4 | **Evidence correct but IGNORED** | did the decision use it? | CHAIN-3 — six tables, no recommendation, market re-derived from keywords |
| 5 | **Genuinely insufficient → ABSTAIN** | *(not a defect)* | Booz Allen — 0 linkable awards, so no recommendation was made |

**Class 5 is the goal state, not a failure.** A correct abstention is a feature. The bug is
only ever an abstention that MISSTATES its reason — see GAP-B, where "no award history was
established" was said when the truth was "we hold 398 and could not link them."

## What ties them together

Classes 1-4 share one shape: **an evidence gap rendered as a world fact.** Same class as
`count ?? 0`. The old symptoms were all this:

    "company doesn't exist"   ·   "contractor has $0 history"
    "no small businesses exist"   ·   "these are the competitors"
    "Rule of Two not met"

Each was a failure to LOOK, presented as something learned.

## The behavioral fixtures

| company | tests | status |
|---|---|---|
| **North Star** | evidence significance / operational customer | frozen gate |
| **Fluidyne** | market grounding from real award history | frozen gate |
| **Atlantic Diving Supply** | untuned generalization | **worked blind, first try** |
| Central Kenworth | reachability — GSA vehicle prefixes (GAP-A) | future fixture |
| Booz Allen Hamilton | reachability — cross-UEI identity (GAP-B) | future fixture |

Atlantic matters most for confidence: North Star and Fluidyne became known fixtures, so
they can be tuned to. **Atlantic worked blind on the first attempt**, which is what makes
CHAIN-3 an architectural improvement rather than two tuned demos.

    npx tsx scripts/verify-decision-chain.mts                    # the frozen gate
    npx tsx scripts/verify-decision-chain.mts --company "Name"   # explore any company

## Phase 2 — usage, not construction

**Deliberately boring: stop changing the chain and use it.** Run 10-20 real companies and
questions through it, and classify every failure against the table above. Real usage — not
a backlog — decides whether GAP-A, GAP-B, or something unanticipated is next.

GAP-A and GAP-B stay FILED. Both are bounded reachability problems and neither requires
redesigning the decision architecture:

* **GAP-A** — valid non-DoD PIID/office prefixes must reach the existing organization
  resolver. The directory already resolves `47QMCA`; the identifier PATTERN blocks it.
* **GAP-B** — entity identity needs cross-UEI reconciliation when awards demonstrably
  exist under another identity.

## What this means for a demo

Mindy does not need to be perfect. It needs to be **trustworthy**: when it knows, show the
evidence and make the decision; when it does not, say so rather than manufacture an answer.
Phase 1 delivered the second half, which was the missing one.
