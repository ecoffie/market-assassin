# Mindy Integrity OS — Phase 1: From Incident Taxonomy to Enforced Contracts

**Status:** Phase 1 shipped 2026-08-23. Phases 2–4 specified, not built.

> **Mindy should never make a consequential claim without being able to establish the evidence
> supporting it.**

## Why now

This PRD exists because a completed audit produced its requirements — not the other way round.
118 flagged locations were individually examined; **0 remain unresolved**; **11 classes of
silent failure** were observed in production, each with a real incident behind it.

An earlier draft of these contracts was written *during* the audit and deliberately reverted for
being ahead of the evidence. This one is written after it.

**Hard constraint, enforced by CI:** every Phase 1 contract traces to at least one `INT-###`
class. `contracts.unit.test.ts` fails the build if a type is added without a traceable class, if
a nonexistent class id is cited, or if anyone introduces a score. All three proven by injection.

## What Integrity OS is — and is not

It is the **enforcement layer underneath Mindy**, not another dashboard. Platform Health already
renders the surface.

**Not in scope, deliberately:** no 0–100 integrity score (a composite hides the uncertainty it
should surface), no AI, no public productisation. Government users should never hear the phrase
"Integrity OS"; they should simply experience a product that is unusually clear about what it
knows and what it does not.

## The conceptual result of the audit: a claim is not just a number

The audit found these forms, all the same kind of object:

| form | example | class |
|---|---|---|
| measurement | "10,667 users" | INT-001 |
| absence | "0 sources" | INT-003 |
| ordering | "these are the top markets" | INT-010 |
| population | "these users should receive this" | INT-011 |
| execution | "the job succeeded" | INT-006 |
| coverage | "94.5% coverage" | INT-003 |
| mutation | "137,186 records updated" | INT-005 |
| eligibility | "these customers qualify" | INT-011 |

## Phase 1 — shipped

`src/lib/integrity/contracts.ts` encodes the five principles the audit earned:

- **No source ≠ zero** (INT-003) — an unestablished relation renders as unavailable, never `0`
- **No execution ≠ success** (INT-006) — success needs evidence of the intended effect
- **Unknown ≠ broken** (INT-002) — and neither is a number
- **A missing result is preferable to a misleading one**
- **A number is a product feature**

`canDefendClaim(kind, evidence)` answers the one question the system exists to answer, and cites
the class id when it refuses.

## Phase 2 — automate the classes that have no control

**This is where the engineering should go next.** The honest baseline today:

| class | control |
|---|---|
| INT-001 truncated list as population | ✅ `audit-api-truncation.mjs` |
| INT-002 `null → 0` | ✅ `audit-supabase-errors.mjs` (rule B) |
| INT-007 monitor sees partial population | ✅ `audit-api-truncation.mjs` |
| INT-009 edit without semantic change | ✅ `verify-edit.mjs` |
| INT-003 missing relation as empty | ❌ none |
| INT-004 legacy classification | ❌ none |
| INT-005 capped RETURNING receipt | ✅ `audit-mutation-receipts.mjs` (Phase 2) |
| INT-006 dead operation reports success | ❌ none |
| INT-008 invalid diagnostic probe | ❌ none |
| INT-010 partial population corrupts ordering | ❌ none |
| INT-011 truncation before batching | ✅ `audit-audience-reachability.mjs` (Phase 2) |

**6 of 11 have controls** (Phase 2 in progress: INT-005 and INT-011 closed 2026-08-23, each proven by re-injecting its ORIGINAL production incident and watching the gate block it). The objective is *not* "everything is caught by a linter" — some of
these are not statically detectable. The maturity measure is **every known failure class has a
control**, whichever kind fits:

- **CI-preventable** — INT-005 (a `.select()` on an `update`/`upsert` whose count is consumed),
  INT-011 (an audience read that is filtered/batched downstream)
- **Runtime-detectable** — INT-003 (a `count === null && error === null` probe on startup or in
  the health check), INT-006 (a job whose processed-count is 0 while its audience is non-zero)
- **Health-check verifiable** — INT-004 (assert a classifier still matches live data shapes)
- **Postcondition-only** — INT-008, INT-010

## Phase 3 — claim contracts on high-consequence surfaces

Evidence travels with the result, so the UI stops inventing confidence language:

```
value: 10667   state: known   population: complete   source: user_notification_settings
value: 48      state: known   population: sampled    sampleSize: 80   methodology: OBS-009
```

## Phase 4 — the dependency graph

`source → query → claim → dashboard → recommendation`, so that when a source fails the system can
answer **"what claims can I no longer defend?"** and degrade them automatically — rather than
showing yesterday's number as though nothing happened.

The external manifestation is eventually one link: **"Why Mindy says this →"**, behind which sits
provenance, population, methodology, limitations and freshness.

## Where this sits

Integrity OS is not a product alongside the Observatory; it is **below everything**: *can we
defend what we know?* → *what did we measure?* → *what can we publish?* → *what should we do?*

⚠️ The Observatory is not in this repo (it lives in `/research`), so Phase 4's research edge is
specified here but cannot be wired from this codebase today.

## See also
- `docs/engineering/silent-failure-registry.md` — the 11 classes and their incidents
- `src/lib/integrity/failure-classes.ts` — the machine-readable registry
- `docs/engineering/a-number-is-a-product-feature.md` — the standing principle
