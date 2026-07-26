# PRD — Bidirectional opportunity cross-sell on the drawer (the "next move" engine)

**Vision (Eric, Jul 26):** we're a MARKET INTELLIGENCE system — always surface the next value move.
On the drawer, connect the two sides of the table:
- Viewing an **open SAM opp** → surface **nearby awarded task orders / contracts** in the same work
  → **subcontract targets** ("the primes already winning this kind of work — go be their sub").
- Viewing a **task order / awarded contract** → surface **similar open SAM opps** → **direct-bid targets**.
Both go in a "Ways to win this" / "Related opportunities" section on the full drawer card.

## Why it matters
Turns each drawer from a dead-end record into a next-move engine. The incumbents (GovWin/SweetSpot/
HigherGov) SILO opps and awards — nobody connects "here's an open bid AND here's who already wins
this work nearby to team with." This is connective intelligence they don't do. Ties to the GOS moat.

## Match logic (DECIDED): NAICS/PSC + location (same work, same area)
- Match on same NAICS (or PSC) + geographic proximity (same state; metro/city as a fast-follow).
- Open opp → awarded contracts, same NAICS + state (subcontract targets).
- Awarded → open SAM opps, same NAICS + state (bid targets).

## Feasibility — MEASURED (Supabase, quota-free):
- Open opps: 2,430 distinct NAICS+state pairs. Awarded: 10,259 pairs.
- **1,573 / 2,430 (65%) of open-opp NAICS+state pairs HAVE a matching awarded contract** → the
  "subcontract targets" section populates for ~2/3 of open opps. Reverse direction is denser (10K
  awarded pairs). Strong — a real, well-populated feature, not hopeful.
- NOTE: uses NAICS+**STATE** (both present + reliable). Does NOT depend on the recompete CITY backfill
  (which is separately broken/in-recovery) — state-level match is unaffected. City proximity is a
  fast-follow once city data is fixed.

## Build directions + data source (quota matters)
1. **Task order/Awarded → open SAM opps** (bid targets): pure SUPABASE query on `sam_opportunities`
   (active, same NAICS, same pop_state). **Buildable + testable NOW — no BigQuery.** Do this side first.
2. **Open opp → awarded contracts** (subcontract targets): match against `recompete_opportunities`
   (Supabase — same NAICS+state) for the CARD list. The awarded row already has incumbent/value/agency
   to show. Only if we want per-contract task-order DETAIL do we hit BigQuery — so the MATCH is
   Supabase (cheap, works now); the optional drill-down is BQ (quota-gated). Build the Supabase match
   now; defer any BQ enrichment.

## Drawer section (both datasets)
- A "Ways to win this" (or "Related opportunities") `sec()` at/near the bottom of the drawer, reusing
  the `.sim-card` flywheel pattern (like Similar opps / Similar recompetes / Similar buyers).
- Open-opp drawer: "🤝 Subcontract targets nearby — X awarded contracts in NAICS <code>, <state>" →
  cards (incumbent · value · agency · expires), click → opens that awarded drawer.
- Awarded drawer: "🎯 Open bids like this — X open opportunities in NAICS <code>, <state>" → cards
  (title · agency · set-aside · due), click → opens that opp drawer.
- Empty state per GOS #10: if no match, show the header + "No related <X> found in this area" (never
  vanish).
- Cap ~6 each; scope-bound query (rank-then-filter gate: filter by NAICS+state FIRST).

## Sequence
- Build the Supabase-only matching now (both directions use Supabase for the card list). NO BigQuery
  needed for the core feature → NOT blocked by the current quota exhaustion.
- Reuse `.sim-card` + `sec()` + `buildTabs` (GOS #9 compound). Fail-soft + GOS #10 empty state.
- Fast-follows (deferred): city-level proximity (after the recompete city backfill recovers), PSC
  matching, semantic/meaning-based matching (embeddings, BQ — quota-sensitive).
