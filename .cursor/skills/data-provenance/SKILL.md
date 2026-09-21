---
name: data-provenance
description: Applies Market Assassin failure semantics and provenance rules (unavailable vs not_found, empty success vs confirmed zero, cache/BQ labeling, as-of coverage, four-clock freshness, capability anchor grounding). Use when rendering empty results, entity lookup misses, contractor history gaps, awards warehouse staleness, or any claim about what the system knows.
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

### Four-clock freshness (awards warehouse)

9. Treat awards freshness as **four independent clocks**, not one `last_built` stamp: source action max, acquisition time, merge time, recipients rebuild time. Encode/decode via `src/lib/awards-ingest/clocks.ts`; legacy rows may synthesize from a single date — label that honestly as unmeasured granularity, not four verified timestamps.
10. **Fail-closed serving** when clocks are missing, ingest is broken, or upstream is stale beyond the SLA (`AWARDS_INGEST_STALE_DAYS`). Never present a false zero or a live label when the warehouse is unhealthy. Post-apply verification must fail the run when the v1 clock block is absent from `data_sources[bq_awards].notes`.
11. **Bounded acquisition polling** is fail-closed: aborting early while USASpending still reports `running` is an ingest failure, not success. Production poll budget must cover measured completion plus post-acquisition buffer (download → MERGE → rebuild → stamp → verify).

### Capability / market-anchor grounding

12. **`grounded: true` requires unique identity evidence** — corroborated SAM or award NAICS aligned with the anchor, high anchor confidence, and no sector contradiction. Ambiguous name matches (`identity: ambiguous`), missing UEI resolution, generic unigrams, or dominance without corroboration → `grounded: false` with an honest `anchor_note`.
13. **Uncertainty is product output**, not a quieter empty state. Surface `anchor_confidence`, `anchor_note`, and resolution vocabulary; never remap `unavailable` or unverified anchors into plausible market facts.

Open `src/mcp/decision-chain/FAILURE-TAXONOMY.md`, `src/mcp/decision-chain/VERIFICATION-PROVENANCE-RULE.md`, and `src/mcp/decision-chain/ENGINEERING-STANDARD-decision-integrity.md` before inventing a new empty-state story.

## Procedure

1. Classify the failure with the decision-chain taxonomy before editing product copy or fallbacks.
2. For awards ingest / BQ warehouse work, read `workflow-control.ts` first — **apply mode requires the exact confirmation string before acquisition**; scheduled runs must not inherit manual-only dispatch inputs.
3. Run the referenced unit fixtures (do not duplicate them):

```bash
npx vitest run \
  src/mcp/tools/sam-entity-empty-success.unit.test.ts \
  src/lib/sam/entity-local-fallback-parity.unit.test.ts \
  src/lib/sam/entity-failover.unit.test.ts \
  src/lib/sam/resolve-uei.unit.test.ts \
  src/lib/contractor/history-by-uei.unit.test.ts \
  src/lib/awards-ingest/awards-ingest.unit.test.ts \
  src/lib/awards-ingest/post-apply-verify.unit.test.ts \
  src/lib/market/capability-anchor.unit.test.ts \
  src/mcp/tools/capability-market-match-grounding.unit.test.ts
```

These encode CHAIN-1, NS-1, DEFECT-7, UEI-history resolution, four-clock freshness, fail-closed acquisition, and capability-anchor grounding shapes.

4. Run the seam suite when the change touches decision-chain code:

```bash
npm run test:chain
```

5. For live acceptance only when authorized and credentials exist:

```bash
npx tsx scripts/verify-decision-chain.mts
node scripts/verify-sam-both-paths.mjs
npx tsx scripts/bq-awards-post-apply-verify.ts
```

If `.env.local` or live keys are missing, report live checks as unverified. Do not claim they passed.

## Pass / fail

- Pass when resolution labels, provenance fields, clock blocks, and fixtures agree.
- Never coerce missing evidence into a world fact (`count ?? 0` class).
- Never claim `grounded: true` on capability market output without unique-identity corroboration.
- Stop at the authorization boundary. No production data mutation from this skill.

## Anti-patterns

- Relabeling an upstream outage as "company not found"
- Calling BQ/KV history "live USASpending"
- Treating a single `last_built` as proof of four-clock health
- Keyword/name competitor queries when anchor grounding forbids them
- Copying defect write-ups into a new diary instead of pointing at the fixtures
