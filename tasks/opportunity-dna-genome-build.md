# Opportunity DNA — the genome build (EPIC #72)

**Decided (Eric, 2026-08-04):** persist a genome column per opportunity; ship grounded strands on
the card + listing FIRST. See the canonical spec artifacts: **The Mindy Ontology** (entity model) +
**Opportunity DNA — the system** (the rendered taxonomy). Memory: `opportunity_dna_over_estimate`.

## The rule this build obeys (from the Ontology)
Three layers, never mixed. **Identity** (one sentence) · **Strategy = the genome** (this build) ·
**Recommendation** (Pursue/Watch/Skip + M-Win, stays separate). The genome is OBJECTIVE — true for
every viewer; M-Win is SUBJECTIVE. A strand never becomes a verdict; M-Win never becomes a strand.
UI shows plain words (Buyer · Approach · Watch Outs); "DNA" is the engine name only.

## What already exists (recon 2026-08-04 — reuse, don't rebuild)
- **`pursueSignals(opp,pin)`** `src/app/opportunity-map/route.ts:4110` — ALREADY the DNA renderer.
  Emits grounded chips: SB-friendly (`pin.sbf`), Early-in-cycle (notice type), Recompete/Forecast
  (`pin.src`), Closes-soon (deadline). We EXTEND this into the genome, not rebuild.
- **`sbf` + `fits`** already decorate every pin (`api/app/opportunity-map/route.ts:235-238`) and row
  (`toRow` `route.ts:1373`). These are the first two strands, live.
- **Strand sources, cheap-per-pin:** `sapBuyerTier()` (`sap-friendly-agencies.ts:73`) = SB-friendly;
  `classifyNoticeType()` (`lib/utils/notice-type.ts:44`) = Sources-Sought/Early; `pin.src` =
  Recompete/Forecast; deadline = Closes-soon/Last-chance; set-aside/vehicle = Approach.
- **Strategy-filter template:** `applyMapFilters` + `MapFilters` `lib/opportunities/map-filters.ts:78`
  already has a `sapBuyer` branch — the EXACT pattern a strand filter follows. Shared by viewport API
  AND saved-search alerts (so a strand filter works in alerts too, free).
- **Momentum sources (partial):** `recompete_changes` (recompete pins only) + `pursuit_change_log`
  (tracked pursuits only). NO general per-opportunity change history for arbitrary map opps yet.
- **`earlySignal`** computed server-side, merged onto pins, but NOT threaded to the client row
  (`route.ts:4106`) — one line of plumbing for the Posts-early strand.

## What's net-new
- A **strand container** (`OppGenome` = array of typed strands) — nothing aggregates strands today.
- A **pure compute lib** `src/lib/opportunities/genome.ts` — deterministic, unit-testable, the single
  source of every strand. Both the map API decorate step AND a future backfill call it.
- A **persisted `opportunity_dna` JSONB column** (hand-run migration) — needed for the strategy-filter
  to work CORPUS-WIDE (not just the current viewport page). Display does NOT need it.
- **Momentum for arbitrary opps** — a general SAM-opportunity snapshot/diff (deferred to Phase 3).
- **Archetype rules layer** — fires only when 3+ strands align.

---

## PHASE 1 — grounded strands, live render (NO migration) ✅ ship first
Zero migration. Compute the grounded strands, render them via the existing `pursueSignals` seam with
progressive reveal (card=1, popup=3, listing=all).

1. **`src/lib/opportunities/genome.ts`** — pure `computeGenome(row): OppGenome`. Typed strands, each
   with `{ category, key, label, tone, grounded:true }`. ONLY grounded strands in P1:
   - Buyer: Repeat Buyer *(needs award history — DEFER to P1.5)*, SB-Friendly (`sbf`).
   - Opportunity: Recompete / Forecast (`src`), Sources-Sought / Early (`classifyNoticeType`).
   - Timing: Closes Soon / Last Chance (deadline), Early Buying Cycle (notice type).
   - Approach: Set-Aside Advantage, Vehicle Required (set-aside + notice/PSC).
   - Reuses `sapBuyerTier`, `classifyNoticeType` — imports only, no new data.
   - Unit test: `genome.unit.test.ts` — fixed row → exact strand set; a row with no signals → [];
     never emits a strand whose source field is absent (no fabrication).
2. **Wire into the pin decorate** (`api/app/opportunity-map/route.ts:235`) — add `dna: computeGenome(pin)`
   to the `.map()`. Thread `dna` through `toRow` (`route.ts:1373`) so the client has the genome array.
3. **Extend `pursueSignals` → render from `pin.dna`** — replace the hand-built chip list with a render
   over the genome array, ordered by tier. Progressive reveal helper: `topStrands(genome, n)`.
   - Decision card: 1 (the dominant strand, or archetype in P2).
   - Popup: 3.
   - Listing drawer: all.
4. **Verify:** tsc 0 · drawer-js parses · unit tests · `verify:oracles` filters check still green ·
   headless render shows strands on a real opp · REPAIR-LEDGER row.

## PHASE 1.5 — the grounded strands that need a lookup (still no migration)
- **Repeat Buyer** — agency+NAICS award-frequency from `recompete_opportunities` (the table
  `buyer-behavior.ts` already reads). Precompute an agency×NAICS repeat map like `sapBuyerTier` so
  it's cheap-per-pin, OR compute in the API decorate with a bounded query. Grounds the #1 Buyer strand.
- **Posts-early** — thread the existing server `earlySignal` to the client row (1-line plumbing).

## PHASE 2 — persist the genome + the strategy-filter (MIGRATION) 🔒 needs Eric to run SQL
1. **Migration** (hand-run): `opportunity_dna JSONB` on `sam_opportunities` (+ a GIN index for the
   filter). SQL written, `pbcopy`'d, Eric runs it, verify columns exist before use.
2. **Backfill** — a resumable local `tsx` runner (>1000 rows → local runner, per CLAUDE.md) that calls
   the SAME `computeGenome` and writes the column. Stamp `dna_computed_at`.
3. **Keep it fresh** — the sync/ingest path calls `computeGenome` on new/updated rows.
4. **The strategy-filter** — checkbox rail of strands in the Filters tab (mirror the `sapBuyer` branch):
   read into `FILT.strategy` → `&strategy=` → `MapFilters.strategy` → `applyMapFilters` predicate over
   the `opportunity_dna` JSONB. NOW filtering is corpus-wide. This is THE differentiator.
   - `verify:oracles` new check: a strand filter genuinely narrows + every returned row satisfies it.

## PHASE 3 — the addictive + needs-data layer
- **Momentum** for arbitrary opps — general SAM-opportunity snapshot/diff (posted-date re-post proxy,
  the same signal `pursuit-changes` uses). New table. 🔥 Heating Up / Amendment Today / Reopened.
- **Archetypes** — rules layer over the genome: fire Safe Bet / Hidden Gem / Moonshot / Relationship
  Play ONLY when 3+ strands align. Show ONE on the decision card.
- **Similarity** ("Looks Like") — opportunity-text embeddings via `capability/embed.ts`. Its own feature.
- **Program/Spend trend** — year-over-year slope on `spend-query.ts`.
- **Needs-new-data:** High Interest / Underwatched (a view counter we don't collect), Existing Contact
  (user CRM match).

## Guardrails
- Ground every strand in a real field; a strand appears ONLY when its source is present (Ontology's
  no-fabrication rule). Repeat Buyer / Posts-early were deliberately NOT shipped before for exactly
  this reason — don't emit them until grounded.
- Genome stays OBJECTIVE. Personalized fit (Fits-your-NAICS is borderline) and M-Win stay in the
  Recommendation layer, never mixed into the genome.
- One shared `computeGenome` — API decorate + backfill + sync all call it (no lib-duplicate drift).
