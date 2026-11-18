# Forecast Gateway six-agency packet — dry-run readiness (2026-11-18)

**Authorization:** research + tooling prep only. **No agency refresh applied.**  
**Writer PR:** [#2161](https://github.com/ecoffie/market-assassin/pull/2161) (`feat/gateway-csv-writer`)  
**Release:** coordinator-controlled; do not merge/apply without explicit schedule.

## Source watermark (live read-only, 2026-11-18)

| Agency | Held `gsa_gateway_csv` | Agency total (all types) | Max CSV `last_synced_at` |
|--------|-----------------------:|-------------------------:|--------------------------|
| DOI | 3,033 | 6,164 | 2026-08-01T20:06:17Z |
| USDA | 2,519 | 5,028 | 2026-08-01T20:06:17Z |
| VA | 698 | 1,390 | 2026-08-01T20:06:17Z |
| DOT | 237 | 897 | 2026-08-01T20:06:17Z |
| GSA | 178 | 514 | 2026-08-01T20:06:17Z |
| DOL | 22 | 166 | 2026-08-01T20:06:17Z |
| **Sum CSV** | **6,687** | — | shared Aug-1 bulk |

Agency totals include superseded `api` twins — first CSV apply must **not** prune them.

## Packet status

| Step | Status | Evidence |
|------|--------|----------|
| Human Export CSV slices (per dept; DOI FY-split) | **HOLD** | No `forecast_export*.csv` on disk in operator Downloads (checked 2026-11-18) |
| `npm run verify:gateway-exports -- <dir>` COMPLETE | **HOLD** | Blocked on packet |
| DOI dry-run via `#2161` writer | **HOLD** | Blocked on COMPLETE packet |
| USDA→DOL dry-runs | **HOLD** | After DOI dry-run reviewed |
| Any `--apply` | **FORBIDDEN** under this authorization | — |

## Identity reconciliation (contract — not yet measured on a live packet)

Canonical key: `(source_agency, GW-L:<Listing ID>)` with `source_type=gsa_gateway_csv`.

Expected dry-run counters (per agency, once packet lands):

- `beforeCsvCount` / `afterCsvCount` (after remains equal on dry-run)
- `insert` — GW-L ids in packet, absent from held CSV
- `update` — same id, material field diffs
- `unchanged` — matched identical
- `absent_upstream` — held CSV not in packet (**report only; not deleted**)
- `twinApiOverlap` — same listing also held as non-CSV (**report only; not mutated**)
- `wrongAgency` / `parseRejected` / `duplicateSourceIds` / `conflicts`

Fixture proof of the planner (no prod write): PR #2161 unit tests **9/9** on `gateway-csv-reconcile.unit.test.ts`.

## Commands (when packet exists)

```bash
# 1. Public FCO UI → Export CSV per department (DOI: split by FY)
# 2. Save as forecast_export*.csv into a dated directory, e.g. packets/gateway-2026-11-18/

npm run verify:gateway-exports -- packets/gateway-2026-11-18
# must exit 0 COMPLETE for DOI,USDA,VA,DOT,GSA,DOL

# 3. Start with DOI — dry-run only
npm run ingest:gateway-csv:dry -- --dir packets/gateway-2026-11-18 --agency DOI

# 4. Repeat dry-run for USDA VA DOT GSA DOL — still no --apply
```

Apply remains blocked unless release coordinator + Eric authorize:
`--apply --i-authorize-apply` on a reviewed dry-run artifact.

## Proposed changes (not executed)

1. Upsert-only refresh of `gsa_gateway_csv` rows per agency from COMPLETE packet.
2. Advance `last_synced_at` only on real apply (not this phase).
3. Leave `api` twins untouched; twin cleanup is a separate decision.
4. Leave `absent_upstream` CSV rows in place until a later prune approval.

## Rollback plan (for a future apply — not used now)

1. First apply = upsert-only (no prune) → rollback = re-upsert prior packet or restore pre-apply export of that agency’s `gsa_gateway_csv` id set.
2. Never use `import-forecasts-live.js --replace` or agency-wide delete.
3. Never clear `intervention_state` / stamp `forecast_gsa_gateway` green without measured advance.

## Customer-facing impact

| Surface | If dry-run only (this PR) | If a future apply lands |
|---------|---------------------------|-------------------------|
| MCP / Ask | Unchanged (`as_of` / `stale_sources` still disclose age) | Fresher `as_of` for refreshed agencies |
| Forecasts panel / map | Unchanged | Titles/POC/timing may update; sync stamp advances |
| Alerts | Unchanged by this packet PR; honesty is PR #2159 | Synced chip (after #2159) reflects newer sync |

**This docs PR changes no customer behavior.**

## Agency-by-agency readiness

| Agency | Export note | Dry-run | Apply |
|--------|-------------|---------|-------|
| DOI | FY split required (>3k cap) | HOLD — awaiting packet | FORBIDDEN |
| USDA | Single-dept likely under cap | HOLD | FORBIDDEN |
| VA | Gateway only (portal migrated) | HOLD | FORBIDDEN |
| DOT | Careful twin report | HOLD | FORBIDDEN |
| GSA | Small slice | HOLD | FORBIDDEN |
| DOL | Small slice; api residue | HOLD | FORBIDDEN |

## GO / HOLD for release coordinator

**GO to land tooling:** PR #2161 (writer), #2160 (DHS file), #2159 (date labels) — code only.  
**HOLD packet apply:** until COMPLETE exports + DOI dry-run artifact reviewed.  
**HOLD:** Navy writes, orphan DHS purge, api-twin prune, freshness stamps, SAM/events/DIBBS.
