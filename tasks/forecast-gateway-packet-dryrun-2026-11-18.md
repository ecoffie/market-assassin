# Forecast Gateway six-agency packet — dry-run readiness (2026-11-18)

**Forecast tooling release:** CLOSED 2026-11-18 (accepted). Evidence: `reports/forecast-release-close-2026-11-18.md`.  
**Writer:** [#2161](https://github.com/ecoffie/market-assassin/pull/2161) merge `cf8898cca` (on prod with #2159/#2160/#2162 tip `3bedca523`).  
**This phase authorization:** obtain COMPLETE packet → verify → DOI-only dry-run artifact. **No agency refresh applied. No `--apply`.**

## Closed release (do not reopen)

| PR | Reviewed head | Merge SHA | Prod proof |
|----|---------------|-----------|------------|
| #2159 | `8ac0e3cbf` | `002585570` | `Last synced by Mindy` + stamp |
| #2161 | `c87192efa` | `cf8898cca` | stamp |
| #2160 | `e6833e6fa` | `d9fd12797` | stamp; `DHS_FORECAST_ALLRECORDS_URL` **unset** |
| #2162 | `65b857d0d` | `3bedca523` | tip stamp (docs) |

Interleaved (not forecast-authorized): [#2158](https://github.com/ecoffie/market-assassin/pull/2158) Ask Mindy Map→Chat bridge @ `bba00ec8` — see repair ledger.

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

## Next milestone — COMPLETE packet → DOI dry-run (ACTIVE)

| Step | Status | Evidence |
|------|--------|----------|
| Human Export CSV slices (per dept; DOI FY-split) | **HOLD** | No `forecast_export*.csv` on disk (re-checked 2026-11-18 ~13:00 ET Downloads/Desktop/packets) |
| `npm run verify:gateway-exports -- <dir>` COMPLETE | **HOLD** | Blocked on packet |
| DOI-only dry-run (`ingest:gateway-csv:dry --agency DOI`) | **HOLD** | Blocked on COMPLETE packet |
| Reconciliation artifact (matched / insert / update / conflicts / API twins / absent_upstream / provenance) | **HOLD** | Return for separate approval; dry-run ≠ apply |
| USDA→DOL dry-runs | **HOLD** | After DOI artifact approved |
| Any `--apply` | **FORBIDDEN** under this authorization | — |

## Identity reconciliation (contract — measure on live packet only)

Canonical key: `(source_agency, GW-L:<Listing ID>)` with `source_type=gsa_gateway_csv`.

Dry-run counters required in the artifact:

- `beforeCsvCount` / `afterCsvCount` (after remains equal on dry-run)
- matched / `insert` / `update` / `unchanged`
- `absent_upstream` — report only; **not deleted**
- `twinApiOverlap` — API twins report only; **not mutated**
- `wrongAgency` / `parseRejected` / `duplicateSourceIds` / conflicts
- packet file sha256 + source provenance (FCO export)

Fixture planner tests ≠ live-source reconciliation proof.

## Authorized obtain workflow

```bash
# 1. Public FCO UI → Export CSV per department (DOI: split by FY — export cap ~3k)
# 2. Save as forecast_export*.csv into e.g. packets/gateway-2026-11-18/

npm run verify:gateway-exports -- packets/gateway-2026-11-18
# must exit 0 COMPLETE for DOI,USDA,VA,DOT,GSA,DOL

# 3. DOI only — dry-run (default; do NOT pass --apply)
npm run ingest:gateway-csv:dry -- --dir packets/gateway-2026-11-18 --agency DOI

# 4. Capture stdout + plan counters into
#    reports/gateway-doi-dryrun-<date>.md  → return for separate apply approval
```

Apply remains blocked unless Eric + release coordinator authorize:
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

| Surface | Dry-run / closed release | If a future apply lands |
|---------|--------------------------|-------------------------|
| MCP / Ask | Unchanged (`as_of` / `stale_sources` still disclose age) | Fresher `as_of` for refreshed agencies |
| Forecasts panel / map | Date-label honesty live (#2159) | Titles/POC/timing may update; sync stamp advances |
| Alerts | Synced chip (#2159); no Gateway write | Synced chip reflects newer sync after apply |

## Agency-by-agency readiness

| Agency | Export note | Dry-run | Apply |
|--------|-------------|---------|-------|
| DOI | FY split required (>3k cap) | HOLD — awaiting COMPLETE packet | FORBIDDEN |
| USDA | Single-dept likely under cap | HOLD | FORBIDDEN |
| VA | Gateway only (portal migrated) | HOLD | FORBIDDEN |
| DOT | Careful twin report | HOLD | FORBIDDEN |
| GSA | Small slice | HOLD | FORBIDDEN |
| DOL | Small slice; api residue | HOLD | FORBIDDEN |

## GO / HOLD

**CLOSED:** forecast tooling release #2159/#2161/#2160/#2162.  
**ACTIVE:** obtain COMPLETE Gateway packet → verify → DOI dry-run artifact.  
**HOLD apply / stamps / orphan purge / Navy / DHS env activation.**
