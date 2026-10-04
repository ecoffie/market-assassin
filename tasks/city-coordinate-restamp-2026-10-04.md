# Stored-coordinate re-stamp (A) — production record (2026-10-04)

Scope: move stored `map_lat`/`map_lng` on Open (`sam_opportunities`), Coming Back (`recompete_opportunities`) and Coming Soon (`agency_forecasts`) from the old single-ZIP city points to the corrected city points of #1824. Coordinates only.

**Rule** (`scripts/geo/restamp-stored-city-coords.ts`). A row is changed only when two things hold:

- Its stored point minus its own deterministic jitter equals EXACTLY the old point of ONE corrected city in the row's own state.
- For Open and Coming Soon, the live geocode chain under the corrected table also lands on the new point.

Each UPDATE is guarded on the old coordinates, with `session_replication_role=replica`, so no triggers fire.

## Result — PRODUCTION PROVEN (scope as defined above)

| surface | candidates | updated | unchanged (not a corrected city) | ZIP-placed (correct, left) | ambiguous (left) | failed | max move |
|---|---|---|---|---|---|---|---|
| Open | 9,892 | 9,892 | 165,735 | 4,256 | 0 | 0 | 24.6 km |
| Coming Back | 17,644 | 17,644 | 81,837 | 0 | 82 (Norcross/Buford, GA share one old point) | 0 | 24.61 km |
| Coming Soon | 944 | 944 | 17,734 | 5 | 0 | 0 | 24.6 km |

Write: 48 min, guarded single-row updates, finished with exit 0.

## Verification against the pre-write snapshot

The snapshot holds the coordinates plus an md5 of every other column, for every candidate row.

- **Coordinates:** 28,480 of 28,480 rows are at their target (corrected city + same jitter). 0 not moved.
- **IDs:** all 28,480 present, 28,480 distinct. None disappeared or duplicated.
- **No moves over 25 km:** max 24.61 km.
- **Re-classification afterwards, against main's exact table:** 0 rows still to move. Bucket counts are identical to the pre-write dry run, so no other row was touched.
- **Non-coordinate hash changed on 427 rows.** Every one is attributed to a concurrent production writer, not this write:
  - **426 Coming Back rows:** `sync-recompete-contracts` fired at 22:25:27 UTC. All 426 rows have `last_synced_at` and `updated_at` between 22:25:28 and 22:28:17. They are exactly the planned rows with `updated_at` after the snapshot; the other 17,218 written rows show no `updated_at` change, which proves this write fired no trigger.
  - **1 Open row** (`9e5ed90e…`): `enrich-opportunity-seo` fired at 22:00:27, and the row's `seo_enriched_at` is 22:00:29, after the snapshot (21:59:24). `updated_at` and `synced_at` are unchanged.

## Production browser acceptance (getmindy.ai, signed in)

**Representative records** (same records, now drawn at the corrected point):

| Surface | Result |
|---|---|
| Open, Richmond | 3/3 active samples at the exact target (NSN valve, wiring harness, cable assembly) |
| Coming Back, Richmond | 3/3 at the exact target (ScriptPro, NEIE Medical Waste, Hospital Hospitality House) |
| Open, Philadelphia (control) | 2/2 at the exact target |
| Coming Back, Atlanta (control) | 2/2 at the exact target |

**Coming Soon, Philadelphia (control).** Richmond has no re-stamped forecasts. 54 Philadelphia forecast pins sit on the corrected city grid and 0 on the old grid; sampled ids are re-stamped rows.

**Old grid empty.** Open shows 0 pins left on the old Richmond or Philadelphia grid.

**Samples that do not render, all for existing map rules:**
- 2 Open notices are superseded by a newer version of the same solicitation. The listing dedupe shows the newer one, which also sits on the corrected grid.
- 1 Coming Back contract is `quality_flag = expired`.
- 3 Coming Soon rows are FY2026, which the map no longer shows.

## Residual found (not written; decision needed)

258 Coming Back rows (186 shown on the map) still sit on an old corrected-city point. Their task-order city is in a different state from the contract's `place_of_performance_state` (e.g. a Richmond, VA task order on an IL contract). A's same-state guard excluded them by design.

Top cities: Alexandria VA 29, Atlanta 18, Baltimore 16, Fairfax 12, Minneapolis 11.

Fixing them needs the guard relaxed to "unique corrected point in ANY state". It would be a separate bounded pass.

## Artifacts

Snapshots and plan are in `.claude/coord-restamp/` (local, untracked):
- `restamp-plan-2026-10-04T21-58-29-774Z.json` (rollback source: id, from, to)
- `snapshot-before.json`, `snapshot-after.json`, `hash-changed.json`
