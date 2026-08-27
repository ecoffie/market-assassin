---
name: cross-surface-parity
description: Verifies shared behavior across Map, in-app routes, and MCP by locating the gold-master service, enumerating consumers, and proving one business-logic path. Use after fixing a tool that has siblings on another surface, or when Map and MCP disagree.
disable-model-invocation: true
---

# Cross-surface parity

One business rule must not fork into Map-only, app-only, and MCP-only copies. Path authority lives in `scripts/ma-skill-registry.json` under `crossSurfaceParity`.

## Proven example (not a universal freeze)

`getContractorHistoryByUei` in `src/lib/contractor/history-by-uei.ts` is the current gold master for UEI contractor history. Consumers include Map company-detail, in-app sales-history, and the MCP contractor award-history tool. Use it as the procedure template. Do not treat its cold-policy knobs as the only allowed architecture for every future shared feature.

## Procedure

1. Name the behavior under test in one sentence.
2. Identify the gold-master module (shared lib preferred over a route or MCP wrapper).
3. Enumerate consumers from the registry. Grep for the shared symbol if the registry is incomplete for a newer seam.
4. Confirm each consumer calls the gold master rather than re-implementing fetch, empty, or provenance logic.
5. Run the shared unit tests:

```bash
npx vitest run \
  src/lib/contractor/history-by-uei.unit.test.ts \
  src/mcp/tools/contractor-award-history-uei.unit.test.ts \
  tests/unit/route-sales-history.test.ts
```

6. For a different shared seam, substitute that seam's gold master and consumer tests. Keep the same steps. Update `scripts/ma-skill-registry.json` when a new shared service becomes the proven example worth checking offline.

## Pass / fail

- Pass when consumers share one service and the fixtures cover the resolution vocabulary.
- Fail when a surface invents a parallel query or remaps `unavailable` into a quieter empty.
- Report surfaces not exercised. Unverified is not passed.

## Anti-patterns

- "Fixed on MCP" while Map still forks the query
- Freezing today's consumer list into product code comments as eternal law
- Building a second verify-app skill beside `npm run verify:*` (BLOCKED by instruction precedence)
