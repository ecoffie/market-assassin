# PRD — Recompete task-order spend + real cities

**Status:** scoped + measured, not built. Build queued to launch AFTER the value-tag-pins PR merges
(task-order pins ARE value-tag pins at real cities). Supersedes the separate "recompete city-recovery"
follow-on — task orders carry the cities, so this is the city recovery.

## Problem (both halves, one fix)
1. **We show a vanity ceiling, not real spend.** `recompete_opportunities.total_obligation ==
   potential_total_value` (identical, avg $9.79M) — the card's "Contract value" is the top-line
   ceiling, not the money actually flowing. A subcontractor wants "where is this vehicle *paying out*."
2. **The parent has no city → state-centroid ring.** `place_of_performance_city` = 0/143,527 rows.
   But the **task orders under the contract each have a real pop_city** — so surfacing task-order spend
   fixes the ring bug for free.

## The data IS there (BigQuery `awards`, verified)
IBM PIID N0003921F3007 → a stream of dated task orders, each real $ + real city: $37.2M / $27.1M /
$24.0M … all Washington Navy Yard DC (siblings in San Diego CA, Round Rock TX, Redmond WA, Falls
Church VA). Corpus (FY2023+): 19.1M transactions, 97% carry a real pop_city.

## ⚠️ THE CRITICAL DESIGN TRAP (measured, must solve before building)
**PIIDs are NOT globally unique — a naive `piid = X OR parent_piid = X` join OVER-MATCHES massively.**
Measured: joining N0003921F3007 that way returned **25,281 txns / $131B / 1 city** — absurd; it swept
unrelated awards sharing the PIID string. The realistic contracts measured correctly:
- `05GA0A21C0002` → 36 task orders, $10.9M, 2 cities ✅
- `05GA0A22F0008` → 25 task orders, $5.0M, 2 cities ✅
So most recompete contracts = **tens of task orders across a handful of cities** (tractable). The
build MUST use a precise lineage key — the award's `generated_internal_id` / parent-award linkage
(see CLAUDE.md "Award Intelligence spine": idv-search reads `generated_internal_id`, and
`resolvePiidToId()` in `award-detail.ts`), NOT a bare PIID string match — or it pulls billions in
noise. This is the #1 thing to get right; verify per-PIID counts look like tens-not-thousands.

## Decided shape (Eric)
Task-order stream on the card + a pin PER task order at its real city.
- **Card / drawer:** the real spend stream — "$37M Apr-25 · $27M Apr-23 · … Washington Navy Yard DC" —
  ACTUAL obligation per task order; total actual = SUM(task orders), shown alongside (not replacing)
  the ceiling so the user sees both "ceiling $X / actually obligated $Y across N task orders."
- **Map:** each task order → a value-tag pin at its real city (obligation on the pin). Fixes the ring.
- Parent contract stays the grouping (incumbent, vehicle, recompete date); money + pins come from the
  task orders.

## Ingestion — DO NOT backfill 19M rows
- **On-demand per contract (v1, preferred):** when a recompete card/drawer opens, fetch that contract's
  task orders via the precise lineage key, cache (a `recompete_task_orders` cache table or the existing
  `mcp_external_cache` pattern). Bounded (tens of rows/contract), current, cheap. Mirrors the existing
  award-detail lookup.
- **Optional bounded backfill later:** only the recompete PIIDs' task orders → a `recompete_task_orders`
  table (piid, txn obligation, pop_city, pop_state, action_date, lat/lng via shared `geocodeCity`).
  Resumable. Only after on-demand proves the join key + the value.
- Geocode each task-order pin via the board-wide `geocodeCity()` (shipped) — 97% have a city.

## Success criteria
- A recompete drawer shows the real task-order spend stream (dated obligations + cities), not just the
  ceiling. Per-contract task-order counts look realistic (tens, not thousands — proves the join key).
- Awarded map pins sit at real task-order cities (ring bug gone) with the obligation on the pin.
- No 19M-row backfill; on-demand + cache. Any bounded backfill → measure, DRY, ask-before-write (GOS).

## Positioning
The recompete moat made VISIBLE: incumbents show a ceiling; we show where the money actually flows,
dated, at real places — the actionable subcontracting signal. GOS thesis (public data → the answer
nobody packages).

## Build sequence
1. value-tag-pins merges (the pin carries the task-order $).
2. Solve + verify the precise lineage join key (the trap above) — a small BQ/award-detail spike first.
3. Build on-demand task-order fetch + cache → wire the drawer stream + the per-task-order pins.
4. Measure, then decide on the optional bounded backfill.
