---
name: data-provenance
description: Applies Market Assassin failure semantics and provenance rules (unavailable vs not_found, empty success vs confirmed zero, cache/BQ labeling, as-of coverage). Use when rendering empty results, entity lookup misses, contractor history gaps, or any claim about what the system knows.
disable-model-invocation: true
---

# Data provenance

Executable truth outranks prose. Path authority lives in `scripts/ma-skill-registry.json` under `dataProvenance`.

## Durable rules

1. `unavailable` is not `not_found`.
2. `not_found` is not a confirmed zero.
3. A successful empty upstream response must reconcile with the local mirror where applicable.
4. Cached or BigQuery-normalized data must not be labeled live.
5. Provenance must include source and applicable as-of or coverage information.
6. Request-time live USASpending is not the normal Map/MCP contractor-history path.
7. BigQuery/KV is the shared contractor-history gold master for that path.
8. `sam_entities` distinguishes registered-zero entities from unresolved entities.

Open `src/mcp/decision-chain/FAILURE-TAXONOMY.md`, `src/mcp/decision-chain/VERIFICATION-PROVENANCE-RULE.md`, and `src/mcp/decision-chain/ENGINEERING-STANDARD-decision-integrity.md` before inventing a new empty-state story.

## Procedure

1. Classify the failure with the decision-chain taxonomy before editing product copy or fallbacks.
2. Run the referenced unit fixtures (do not duplicate them):

```bash
npx vitest run \
  src/mcp/tools/sam-entity-empty-success.unit.test.ts \
  src/lib/sam/entity-local-fallback-parity.unit.test.ts \
  src/lib/sam/entity-failover.unit.test.ts \
  src/lib/sam/resolve-uei.unit.test.ts \
  src/lib/contractor/history-by-uei.unit.test.ts
```

These encode CHAIN-1, NS-1, DEFECT-7, and UEI-history resolution shapes.

3. Run the seam suite when the change touches decision-chain code:

```bash
npm run test:chain
```

4. For live acceptance only when authorized and credentials exist:

```bash
npx tsx scripts/verify-decision-chain.mts
node scripts/verify-sam-both-paths.mjs
```

If `.env.local` or live keys are missing, report live checks as unverified. Do not claim they passed.

## Pass / fail

- Pass when resolution labels, provenance fields, and fixtures agree.
- Never coerce missing evidence into a world fact (`count ?? 0` class).
- Stop at the authorization boundary. No production data mutation from this skill.

## Anti-patterns

- Relabeling an upstream outage as "company not found"
- Calling BQ/KV history "live USASpending"
- Copying defect write-ups into a new diary instead of pointing at the fixtures
