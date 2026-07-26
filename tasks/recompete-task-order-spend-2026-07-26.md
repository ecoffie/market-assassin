# Recompete task-order spend + real cities (2026-07-26)

**Eric's insight (the big one):** recompete cards should surface the ACTUAL task-order spend
under a contract vehicle — not the parent ceiling. That's what a subcontractor wants to see
("this vehicle is paying out $30M+ task orders every few months"). AND — the task orders carry
the REAL cities the parent lacks, so this fixes the state-centroid ring bug *for free* from the
same data pull. The "show me the real money" gap and the "fake location ring" bug are ONE problem
with ONE fix.

## What's wrong today (measured)
- `recompete_opportunities`: `total_obligation == potential_total_value` (identical, avg $9.79M) →
  we store the **ceiling as the obligation**, i.e. we are NOT showing real spend, just the top-line.
- `place_of_performance_city` = **0 of 143,527** rows → no city at the parent level → state-centroid
  ring (the visible bug).

## The data IS there (BigQuery `awards`, verified)
For ONE recompete PIID (IBM N0003921F3007) the awards table has the task-order transaction stream:
- $37.2M — Washington Navy Yard, DC — 2025-04-30
- $27.1M — Washington Navy Yard, DC — 2023-04-19
- $24.0M / $23.7M / $21.9M / … many more, each dated, each with a REAL pop_city.
Other task orders under sibling PIIDs: San Diego CA, Round Rock TX, Redmond WA, Falls Church VA.

**Scale (FY2023+):** 19.1M transactions, 18M distinct PIIDs, **97% carry a real pop_city**,
avg obligation $142K. So: real money + real location, reliably, at the TASK-ORDER (transaction) level.

## DECIDED shape (Eric)
**Task-order stream on the card + a pin PER task order at its real city.**
- Card: show the real spend stream — "$37M Apr-25 · $27M Apr-23 · … Washington Navy Yard DC" — the
  ACTUAL obligated per task order, not the parent ceiling. Total actual = SUM(task-order obligations).
- Map: each task order becomes its own value-tag pin at its REAL city (ties directly into the
  value-tag-pins build — the $ on each pin is the task-order obligation). Fixes the ring bug.
- Keep the parent contract as the grouping (incumbent, vehicle, recompete date) but the MONEY + PINS
  come from the task orders under it.

## Ingestion approach — DO NOT backfill 19M rows
- **On-demand per PIID** (preferred v1, mirrors the existing award-detail lookup): when a recompete
  card/drawer opens, fetch that PIID's task orders from USASpending/BigQuery (piid + parent_piid match),
  cache the result (a `recompete_task_orders` cache table or the existing mcp_external_cache pattern).
  Bounded, cheap, always current.
- **OR bounded backfill:** only the ~134K recompete PIIDs' task orders (not all 18M) → a
  `recompete_task_orders` table (piid, txn obligation, pop_city, pop_state, action_date, lat/lng via
  the shared geocodeCity). Resumable runner. Measure the real transaction count for just those 134K
  PIIDs first (the 19M is ALL awards; the recompete subset is far smaller).
- Map each task-order pin's lat/lng via the board-wide `geocodeCity()` (already shipped) — 97% have a
  city → real placement; the ~3% without → state fallback, labeled approx.

## Why this matters (positioning)
This is the recompete moat made VISIBLE: incumbents (GovWin/SweetSpot) show a contract ceiling; we
show WHERE the money is actually flowing, in real time, at real places — the actionable subcontracting
signal. Ties to the GOS thesis (public data → the answer nobody packages) and the M-Estimate/moat theme.

## Sequence / dependencies
- Depends on: value-tag-pins build (the pin carries the task-order $) + geocodeCity (shipped).
- Bulk anything (a 134K-PIID backfill) → measure the real count, DRY, ask-before-write (GOS).
- Recommend: PRD → measure recompete-subset transaction count → build on-demand v1 → optional backfill.

## Next step
Write `docs/strategy/PRD-recompete-task-order-spend.md` from this, measure the recompete-subset txn
count, then build. This SUPERSEDES the separate "recompete city-recovery" follow-on (task orders ARE
the city recovery).
