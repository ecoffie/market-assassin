# SAM.gov Contract Awards — FPDS Transition Reference

**Captured 2026-05-22** from sam.gov's FPDS transition page.

> Why this is in the repo: We were about to build FPDS-style top-10
> leaderboards against USAspending.gov, but this page reveals SAM.gov
> itself is taking over FPDS via a NEW Contract Awards API on
> open.gsa.gov. Need to decide which surface to call before shipping
> the endpoint at `/api/usaspending/fpds-top-n`.

---

## What changed (2026-02-24)

GSA decommissioned **FPDS.gov ezSearch** on February 24, 2026 and
moved contract award search into **SAM.gov**. The transition is
incremental — some functionality is already live in SAM.gov, the
rest is still being moved.

## What's live in SAM.gov now

- **Contract Awards Search** at `sam.gov/contracting` (the "Search
  Contract Awards" card on that page).
- **Public data** — accessible to anyone with a SAM.gov account
  (free; no specific role required).
- Search filters: keyword, agency, legal business name.
- Pickers for filters that didn't exist in FPDS.gov.
- Partial-string search (didn't exist in FPDS.gov either).
- Coverage: all unclassified contract actions exceeding the
  micro-purchase threshold + modifications, regardless of dollar
  value.

## What's NOT in SAM.gov yet

- **NASA Specific Awards** — still in SAM Data Bank or FPDS
  Advanced Search. Anything involving NASA contracts needs a
  separate path.

## The new API path (this is the big news)

The legacy **ATOM Feed** from FPDS.gov is being replaced with the
new **SAM.gov Contract Awards API** on **open.gsa.gov**.

### What the new API offers vs the legacy ATOM feed

| Capability | Legacy FPDS ATOM | New SAM Contract Awards API |
|---|---|---|
| Query mode | XML feed, polling | Direct + on-demand |
| Search granularity | Limited | Advanced + granular |
| Output formats | XML only | JSON, CSV |
| Data richness | Active contracts only | Includes deleted contracts and more |

### How to get API access

Quote from the page: "Consumers should begin using the open.gsa API
today to test and update their consumption methods as necessary.
There's no need to wait. Instructions to obtain an API Key can be
found here." (The actual link wasn't captured but should be on
open.gsa.gov's Contract Awards API page.)

**Action item:** Find the open.gsa.gov page for the Contract Awards
API + obtain an API key. The transition page explicitly invites us
to start consuming it now.

## Implications for Mindy

We have two paths for the FPDS-style top-10 leaderboards work:

### Option A — Use USAspending.gov (what we were about to ship)

- ✅ No API key needed
- ✅ Documented `spending_by_category` endpoint
- ✅ Works today
- ⚠️ Rate limit ~1 req/sec
- ⚠️ Same data ultimately (USAspending pulls from the same
  underlying transaction database), but it goes through an extra
  pipeline + lags by ~1 week
- ⚠️ Doesn't include deleted contracts (per the new API's pitch)

### Option B — Use the new SAM Contract Awards API on open.gsa.gov

- ✅ Direct from the source of truth — same DB the federal
  procurement workflow writes into
- ✅ Includes deleted contracts (per the API's stated enhancement)
- ✅ JSON output, granular search filters
- ✅ This is where federal procurement search is going long-term
- ⚠️ Needs an API key (we have `SAM_API_KEY` and
  `SAM_CONTRACT_AWARDS_API_KEY` env vars per CLAUDE.md — may already
  be valid for the new endpoint, may need a separate key)
- ⚠️ New API, less documentation in the wild, more risk of
  schema-discovery work
- ⚠️ May not yet expose category aggregations (top-N by
  awarding_agency, recipient, etc.) the way USAspending does —
  the new API is for award SEARCH, not aggregation. Aggregation
  may still need to be computed client-side from result sets.

### What I'd recommend

For the **leaderboards UI** specifically (top 10 by agency, vendor,
etc. — aggregations), USASpending is probably still the right tool
because:

1. USAspending has `spending_by_category` endpoints that return
   pre-aggregated top-N directly. Doing the same with the new SAM
   API would require fetching N pages of raw awards and rolling up
   client-side. Expensive + slower.
2. The 1-week lag is acceptable for a "Top 10 in your NAICS" view —
   nobody cares if the rankings shift slightly day-to-day.

For **single-award lookups, deleted-contract checks, and the
contractor sales-history page** — the new SAM Contract Awards API is
the right call. Direct from the source + richer data.

**So: dual-source strategy.** Aggregations from USASpending,
detail lookups from SAM.

## Related migrations / decommissions

Other things moving in the FPDS sunset (for future reference):

| Resource | Where it lives now |
|---|---|
| Data dictionary | SAM.gov (previous + current versions) |
| FAQ + help guides | SAM.gov Help and FSD.gov |
| Contract data reports | Integrated into SAM.gov (since Oct 2020) |
| Manage Contract Awards portal | sam.gov/contracting → "Manage Contract Awards" card (federal users only) |
| Data Management requests | Same process — Federal Service Desk |

## Existing wiring in Mindy

Per CLAUDE.md "SAM.gov API Integration" section:

| API | Status | Source | System Account |
|---|---|---|---|
| Opportunities | ✅ Working | SAM.gov | No |
| Entity Management | ✅ Working | SAM.gov | No |
| Federal Hierarchy | ✅ Working | SAM.gov | No |
| Contract Awards | ✅ Working | **USASpending MCP** (workaround) | No |
| Subaward | ⏳ Waiting | SAM.gov | Yes |

So we're already using USAspending as our Contract Awards source
since the SAM.gov Contract Awards API required a "System Account"
that we never finished applying for. The new open.gsa.gov endpoint
may or may not have the same auth requirement — worth checking.

## Decisions captured

1. **Keep `/api/usaspending/fpds-top-n` (in-flight commit) as the
   primary source for top-10 leaderboards.** USAspending category
   aggregations are the right tool for "top 10 by X" views.

2. **Open ticket: investigate open.gsa.gov Contract Awards API.**
   Goals:
   - Confirm whether existing `SAM_API_KEY` works or new one needed
   - Map the endpoint surface (does it expose aggregations or just
     search?)
   - Test the "includes deleted contracts" claim — if true, we can
     surface "contracts withdrawn from competition" as a market
     signal
   - Compare freshness vs USASpending's 1-week lag

3. **Defer migration of contractor-sales-history to the new API.**
   It currently uses USAspending too; same dual-source logic
   applies. Migrate when the new API proves stable + more
   capable.

## URL inventory

| Surface | URL |
|---|---|
| SAM Contract Awards landing | https://sam.gov/contracting |
| FPDS transition info | https://sam.gov (transition page) |
| New SAM Contract Awards API docs | https://open.gsa.gov (API key instructions live here) |
| Federal Service Desk | https://www.fsd.gov |
| USAspending API docs | https://api.usaspending.gov/docs/endpoints |

## Verbatim snippets worth preserving

> "The Federal Procurement Data System's (FPDS.gov) capabilities will
> transition to SAM.gov on an incremental basis to make way for a
> modernized procurement data system within SAM.gov"

> "GSA has completed the transition of ezSearch functionalities to
> SAM.gov, and decommissioned ezSearch on February 24, 2026."

> "ATOM Feed will be replaced with the SAM.gov Contract Awards API
> in open.gsa.gov."

> "The new API will include the following enhancements: Direct &
> On-Demand Queries / Advanced, Granular Search / Flexible Formats
> (JSON, CSV) / Richer Data (Deleted Contracts, etc.)"

> "Consumers should begin using the open.gsa API today to test and
> update their consumption methods as necessary. There's no need to
> wait."

> "NASA Specific Awards have not been transitioned to SAM.gov. NASA
> Award data may be obtained from the SAM Data Bank or FPDS Advanced
> Search."
