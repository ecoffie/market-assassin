# TODO: Migrate from USAspending → SAM.gov Contract Awards API (open.gsa.gov)

**Status:** Captured 2026-05-22, deferred — investigation needed first
**Trigger:** Eric forwarded the SAM.gov FPDS transition page mid-build
**Related:**
- [`docs/sam-contract-awards-transition.md`](../docs/sam-contract-awards-transition.md) — full transition reference
- [`src/app/api/usaspending/fpds-top-n/route.ts`](../src/app/api/usaspending/fpds-top-n/route.ts) — current USAspending-backed leaderboards
- [`src/lib/sam/usaspending-fallback.ts`](../src/lib/sam/usaspending-fallback.ts) — current contract-awards adapter

---

## Why this is on the roadmap

GSA decommissioned FPDS ezSearch on **Feb 24, 2026** and the
replacement lives in two places:

1. **SAM.gov contract-awards search UI** at `sam.gov/contracting`
2. **SAM.gov Contract Awards API on open.gsa.gov** — replaces the
   legacy FPDS ATOM feed

The new API's stated enhancements (verbatim from the transition page):

  - Direct & on-demand queries
  - Advanced, granular search
  - Flexible formats (JSON, CSV)
  - **Richer data (deleted contracts, etc.)**

That last one matters — USAspending doesn't surface deleted/
withdrawn contracts, which is a real BD signal ("this prime won
the work but then the contract got cancelled" = recompete opportunity).

## What's in production today

- All contract-awards data flows through **USAspending API**
  (`api.usaspending.gov/api/v2/...`).
- We did this as a workaround when the legacy SAM Contract Awards
  API required a "System Account" we never finished applying for.
- Per `CLAUDE.md` → "SAM.gov API Integration":
  | API | Status | Source |
  |---|---|---|
  | Contract Awards | ✅ Working | USASpending MCP (workaround) |

## What needs to be investigated first

This is the unblocking work. Don't write code until these are answered:

1. **Does our existing `SAM_API_KEY` work for the new endpoint?**
   We have two env vars per CLAUDE.md — `SAM_API_KEY` and
   `SAM_CONTRACT_AWARDS_API_KEY`. The legacy CAS API needed a
   System Account; the new open.gsa.gov endpoint may not. Test
   with the existing keys before assuming we need to apply.

2. **What's the actual endpoint surface?** The transition page
   doesn't link to specific docs. Need to find:
   - Base URL on open.gsa.gov
   - Authentication scheme (header? query param? OAuth?)
   - Search filter shape
   - Pagination behavior
   - Rate limits

3. **Does it support category aggregations** (top-N by awarding
   agency, recipient, etc.)? USAspending's
   `spending_by_category` is the reason we picked it for the
   leaderboards — single call returns pre-aggregated top-N.
   If the new SAM API is search-only (one award at a time),
   we'd have to fetch hundreds of awards + aggregate client-side
   for the leaderboards.

4. **What's the data freshness?** USAspending lags ~1 week.
   The new SAM API should be near-realtime since it's the
   source of truth.

5. **Schema-vs-USAspending differences.** USAspending has a
   well-known shape (recipient_name, awarding_agency.toptier_name,
   etc.). The new API may have different field names or nesting.

## Where the migration would land

If/when we migrate, the change is layered:

### Layer 1 — Search/lookup paths (good fit for new API)

| Surface | Currently uses | After migration |
|---|---|---|
| Contractor sales-history page (`/contractors/[slug]`) | USAspending awards search | SAM Contract Awards API search |
| Single-award detail lookup | USAspending | SAM Contract Awards API |
| "Deleted/withdrawn contracts" signal (NEW capability) | n/a | SAM Contract Awards API |
| Subaward reporting (currently blocked) | n/a (blocked on System Account) | May unblock here |

### Layer 2 — Aggregation paths (probably STAY on USAspending)

| Surface | Why USAspending stays |
|---|---|
| FPDS top-10 leaderboards (`/api/usaspending/fpds-top-n`) | Needs `spending_by_category` aggregation in one call. SAM API likely doesn't expose this. |
| Market Map Spending-by-Agency chart | Same — single aggregation call |
| Per-NAICS market summary | Same |

**The decision rule:** detail/lookup → SAM API. Aggregation → USAspending.

## Risk

Migrating prematurely loses working code (USAspending integration
is years old + battle-tested) in exchange for a new API surface
we don't have field-level familiarity with. Risk of regression on
the contractor-sales-history page (which powers the SEO acquisition
flywheel — ~2,700 indexable pages).

## What I'd build in the first migration session

Once the investigation answers the 5 questions above:

1. **Create `src/lib/sam/contract-awards-v2.ts`** — wrapper for the
   new open.gsa.gov endpoint, mirroring the shape of the existing
   `src/lib/sam/usaspending-fallback.ts` so callers can swap.
2. **Shadow-test it** — run both USAspending and the new API in
   parallel for one feature (probably contractor sales-history on
   the public page), compare outputs, alert on drift.
3. **Cut over one surface at a time** — start with the SEO page
   (highest value), then drawer, then any others.
4. **Add the "deleted contracts" signal** to AgencyDrawer as a new
   capability nobody else has yet. Differentiator vs HigherGov.

## Trigger to execute

Investigation only — find the open.gsa.gov docs + test the existing
API keys against the new endpoint. ~30 minutes. Schedule it for a
focused session, not interleaved with other work.

After investigation, decide:
- If the new API is plug-and-play: migrate detail/lookup paths in
  one focused session (1-2 days)
- If it needs a new System Account or has a more restrictive
  schema: stay on USAspending for now, revisit in 3-6 months when
  the new API has matured

Don't migrate just because something new exists. Migrate when the
new thing solves a real problem we can't solve today (deleted
contracts being the most concrete).

## Doc references

- Full transition page captured at `docs/sam-contract-awards-transition.md`
- Existing CLAUDE.md "SAM.gov API Integration" section lists current
  API surfaces + key env vars
