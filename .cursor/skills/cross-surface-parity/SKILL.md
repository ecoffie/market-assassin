---
name: cross-surface-parity
description: Verifies shared behavior across Map, in-app routes, and MCP by locating the gold-master service, enumerating consumers, and proving one business-logic path. Use after fixing a tool that has siblings on another surface, when Map and MCP disagree, or when cron drains must self-report backlog honestly.
disable-model-invocation: true
---

# Cross-surface parity

One business rule must not fork into Map-only, app-only, and MCP-only copies. Path authority lives in `scripts/ma-skill-registry.json` under `crossSurfaceParity`.

## Proven examples (templates, not universal freeze)

| Seam | Gold master | Typical consumers |
|------|-------------|-------------------|
| Saved-search schedule + Map URL restore | `src/lib/saved-searches/service.ts` | Map saved UI, `schedule_market_search` MCP tool, `saved-search-alerts` cron |
| UEI contractor history | `src/lib/contractor/history-by-uei.ts` | Map company-detail drawer, in-app sales-history, MCP contractor award-history |

Use whichever row matches the seam under test. Do not treat either row's knobs as the only allowed architecture for every future shared feature.

## Cron terminal self-reporting and bounded backlog draining

Shared alert drains (`runSavedSearchAlertDrain` in `alert-drain.ts`) must:

1. **Page due rows inside one invocation** until drained, time budget, or row ceiling — not stop after the first batch silently.
2. **Set terminal `outcome`** (`success` | `partial` | `error`) from processed counts + `remaining`, never from "no exception thrown."
3. **Capacity exhaustion is not success** — when `stopReason` is `time_budget` or `row_ceiling`, report `remaining` backlog and surface `errorSummary` (e.g. `capacity_exhausted=1,backlog=N`).
4. **Delivery readiness** (`delivery-readiness.ts`) trusts route-authored terminal status in the expected daily window — a cron that exits 200 without stamping terminal success did not deliver.

MCP scheduling must call the saved-search service for persist + Map URL encoding; the cron must call the same filter vocabulary as the Map viewport (`map-filters.ts` / `applyMapFilters`).

## Procedure

1. Name the behavior under test in one sentence.
2. Identify the gold-master module (shared lib preferred over a route or MCP wrapper).
3. Enumerate consumers from the registry. Grep for the shared symbol if the registry is incomplete for a newer seam.
4. Confirm each consumer calls the gold master rather than re-implementing fetch, empty, provenance, or schedule logic.
5. Run the shared unit tests for the seam under test:

**Saved-search / MCP schedule / cron drain:**

```bash
npx vitest run \
  src/lib/saved-searches/service.unit.test.ts \
  src/lib/saved-searches/map-url.unit.test.ts \
  src/lib/saved-searches/alert-drain.unit.test.ts \
  src/lib/saved-searches/delivery-readiness.unit.test.ts \
  src/mcp/tools/schedule-market-search.unit.test.ts \
  src/lib/alerts/saved-search-email-deeplink.unit.test.ts
```

**Contractor history (second proven seam):**

```bash
npx vitest run \
  src/lib/contractor/history-by-uei.unit.test.ts \
  src/mcp/tools/contractor-award-history-uei.unit.test.ts \
  tests/unit/route-sales-history.test.ts
```

6. For a different shared seam, substitute that seam's gold master and consumer tests. Keep the same steps. Update `scripts/ma-skill-registry.json` when a new shared service becomes the proven example worth checking offline.

## Pass / fail

- Pass when consumers share one service and the fixtures cover the resolution vocabulary.
- Pass on cron work when a simulated backlog yields `partial`/`error` with honest `remaining`, not a silent success.
- Fail when a surface invents a parallel query or remaps `unavailable` into a quieter empty.
- Report surfaces not exercised. Unverified is not passed.

## Anti-patterns

- "Fixed on MCP" while Map still forks the query
- Reporting cron success when `remaining > 0` after capacity stop
- Freezing today's consumer list into product code comments as eternal law
- Building a second verify-app skill beside `npm run verify:*` (BLOCKED by instruction precedence)
