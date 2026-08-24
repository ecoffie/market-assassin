# DEFECT-7 — RESOLVED. `lookup_sam_entity` returned degraded:true for every query

> **STATUS: FIXED AND MERGED** — PRs **#1319** (`fix(sam): outage reported as "not registered"
> + charged for the failure`) and **#1320** (`chore(sam): key inventory, 429-only pattern
> sweep, both-paths acceptance`), fixed in a separate thread and verified on the real outage
> path.
>
> What changed: dead/throttled SAM keys now fall back to the local registry; degraded +
> ungrounded results are **not charged**; false "not registered in SAM" answers are gone.
>
> **Still open as ops work:** SAM API key rotation. The code no longer misreports an outage,
> but the underlying key exhaustion is an operational matter.
>
> The original investigation notes below are retained as the record of how it was found —
> during P0-1 fixture sourcing, not as part of that defect.

---

## Original filing

**Not part of P0-1.** Filed separately so this PRD does not absorb every MCP defect it
touches. Discovered while sourcing P0-1 fixtures; unrelated to market classification.

## Reproduction (deployed Mindy MCP, 2026-08-23)

| Call | Result |
|---|---|
| `lookup_sam_entity(uei="SLSAVMPJXTD8")` (NAMMO POCAL) | `entity:null, matches:[], grounded:false, degraded:true` |
| `lookup_sam_entity(name="NAMMO POCAL")` | same |
| `lookup_sam_entity(name="Lockheed Martin")` | same |

Lockheed Martin is the control. A canonical, unambiguously registered entity returning
zero matches is not a miss — `degraded:true` means the upstream call failed.

Credits were charged on each failed call (5 each).

## Not yet determined

Whether the cause is an expired/absent `SAM_API_KEY` in the deployed env, SAM.gov 429
quota exhaustion (the repo has `entity-429-failover.unit.test.ts`, so multi-key failover
exists and may itself be failing), or an upstream SAM outage. **Not investigated** — it
would have pulled P0-1 off course.

Local probe was inconclusive: this worktree has no `SAM_API_KEY`, so a direct
`api.sam.gov` call returned 404. That says nothing about production.

## Severity

Meaningful. `lookup_sam_entity` is the registration/set-aside-eligibility check. Silent
degradation means a user asking "is this vendor real and 8(a) eligible?" gets a
not-found-shaped answer for a company that IS registered. `grounded:false` is honest in
the payload, but reads as "no such entity" to anyone not inspecting `_meta`.

## Architectural note for P0-1 provenance

SAM's entity API returns registration data — UEI/CAGE, NAICS, certifications, POC names —
**not free-text capability narrative.** So SAM could not have supplied the classification
evaluation prose even had the tool been healthy.

**The P0-1 evaluation set is NOT a "SAM capability-statement benchmark"** and must never be
described as one. Its provenance is FY2025 USASpending **award descriptions** for firms
registered in each NAICS. See `fixtures/classification-set.json` `_readme`.
