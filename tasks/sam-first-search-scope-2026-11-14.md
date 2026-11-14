# Search scope: SAM.gov first (Agent 3, 2026-11-14)

**Status:** read-only investigation (Eric's brief "Search Scope Change: SAM.gov First", confirmed 2026-11-14).
No source, matching, ranking, migration, watch or email change. Agent 3 owns search architecture, matching,
classification and ranking; Agent 4 owns benchmark construction and blind evaluation.
All numbers: production, read-only, 2026-11-14 ~20:50Z, code at main `7f328de9`.

## 1. Source boundaries (verified independently)

| Fact | Value |
|---|---|
| `sam_opportunities` rows | 265,938, **all** `source = 'sam.gov'` (one distinct value) |
| Open as production defines it (`active = true AND response_deadline > now()`, `map-filters.ts:201`) | **9,716** |
| Deadline in the future but `active = false` | 1,081 (Agent 4's 10,797 counts these; production search does not) |
| `active = true` with NO deadline (never shown as open by any search surface) | 9,712 |
| Open and bought by DLA (Defense / Logistics), on SAM.gov | 4,211 |
| Open product notices (PSC starts with a digit) | 6,575 |
| `dibbs_rfqs` rows (separate table) | 103,076; last synced **2026-11-02**; open by return date: **58**; latest deadline 2027-09-03 |
| DIBBS solicitations ALSO published on SAM.gov (same solicitation number in `sam_opportunities`) | 1,937 |
| `aggregated_opportunities` (multisite) | NIH 1,875 · Grants.gov 63 · DARPA 6 · **no DIBBS rows** |

**Boundary (proposed, no code change):**
- In scope: every row of `sam_opportunities` (services, construction, products, parts, DLA included), with
  production's open definition: `active = true AND response_deadline > now()`.
- Out of scope: rows that exist ONLY in `dibbs_rfqs`. A DLA RFQ that is also on SAM.gov is in scope through its SAM
  row (1,937 such solicitations), so DLA is never excluded as a buyer.
- No filter needs adding to search: the search surfaces below already read SAM only. The DIBBS sync is parked
  (`src/lib/dibbs/availability.ts`, `DIBBS_MAP_ENABLED = false`, 2026-11-07) and nothing here changes that.

Two boundary findings Eric should know (no action proposed here):
1. **9,712 active notices have no deadline** and are invisible to every "open" search. They need a sample to see
   what they are (special notices, sources sought, award notices) before anyone decides whether they belong.
2. The benchmark should use production's open definition (9,716), not deadline-only (10,797).

## 2. Customer-facing surfaces

| Surface | Data source(s) | DIBBS appears? | If the initiative is SAM.gov-only, customers notice |
|---|---|---|---|
| Opportunity Map, Open mode | `sam_opportunities` + **SBIR topics** (client sends `sources=sam,sbir`; SBIR pins at sponsoring-branch HQ) | No. DLA/DIBBS mode exists but is hidden (`DIBBS_MAP_ENABLED=false`); the API ignores `sources=dla` | Nothing for SAM pins. SBIR pins are not SAM.gov: the initiative must say whether matching changes apply to them (today they are bbox-filtered, not text-matched by the SAM matcher) |
| Opportunity Map, other modes | Coming soon = `agency_forecasts`; Coming back = recompete map (USASpending); Grants = grants map | No | Not SAM.gov. Out of this initiative unless Eric extends it |
| Opportunity detail (`/api/app/opportunity-detail`) | `sam_opportunities`; falls back to `dibbs_rfqs` when the id is a DIBBS solicitation | Yes, fallback only | Nothing. 0 saved pursuits point to a DIBBS-only solicitation today |
| DIBBS panel (`?panel=dibbs`, `/api/app/dibbs`) | `dibbs_rfqs` only | Yes, it is the DIBBS surface | Nothing changes. Note: not in the sidebar but reachable by URL; shows 58 open RFQs from data last synced Nov 2, with no "paused" notice in the panel |
| Ask Mindy / MCP `find_opportunities` | Open = `sam_opportunities` (`MCP_POLICY.sources = ['sam']`); Coming back = `recompete_opportunities`; Coming soon = `agency_forecasts` | No | Open-now results are already SAM.gov-only. Coming back / Coming soon are not SAM and are not touched |
| Ask Mindy `search_sam_opportunities` and other tier-1 tools | `sam_opportunities` | No | Nothing |
| Saved searches + saved-search alerts | `sam_opportunities` (`SAVED_SEARCH_POLICY.sources=['sam']`, posted ≤30 days) + `agency_forecasts` | No | Nothing for the source. Matching improvements would change which notices alert (separate approval; #2043 stays off) |
| Daily / weekly alerts | `fetchSamOpportunitiesFromCache` → `sam_opportunities` | No | Nothing |
| Daily briefings (SAM green builder) | `sam_opportunities` | No | Nothing |
| Multisite briefings | `aggregated_opportunities` (NIH, Grants.gov, DARPA) | **No** (a `dla_dibbs` score bonus exists in code, but there are 0 such rows) | Nothing |
| Today / dashboard (`src/lib/today/*`, `mi-dashboard`) | `sam_opportunities` + `recompete_opportunities` | No | Nothing for the source |

Products: every SAM search surface shows product notices by default (`hideCommodity` defaults false and no surface
policy sets it), so products are already in scope everywhere SAM is searched.

## 3. Revised benchmark and responsibilities

Agent 4's proposal (`research/data-core-hidden-opp-benchmark-v1` @ 4debe21f4,
`BENCHMARK-V4-SAM-ONLY-PROPOSAL.md`) is consistent with this audit: seven service/construction categories
(guards, janitorial, HVAC, steel/metal roofing, nursing, grounds 561730, paving 237310) and seven product categories
(general parts, fasteners 53, electrical 59, valves 48, aircraft 16, medical 65, IT hardware 7A/7B/7G).
Codes are a recall floor only; services judged on the work bought, products on item name, spec, FSC/PSC, NSN or
part number, with a separate `fulfillment_constraint` field. Order: retrieval, then classification, then ranking.

Corrections sent to Agent 4:
1. Use production's open definition (`active = true AND response_deadline > now()`: 9,716), not deadline-only.
2. Multisite briefings do not read `dibbs_rfqs` (0 DIBBS rows in `aggregated_opportunities`).
3. Measure retrieval on the FULL matched set as well as the 500-row deadline window (FIND classifies only the
   window; the Map counts listings, Ask Mindy counts rows).

| Responsibility | Owner |
|---|---|
| Benchmark construction, labelling, blind evaluation, holdout of notices posted after Nov 14 | Agent 4 |
| Retrieval, matching, classification, ranking changes; matched sets for each candidate; measuring regressions on the 36 searches | Agent 3 |
| Approval of any production change; approval of API/LLM spend for evaluation | Eric |

## 4. Expected customer-facing consequences

- **Declaring the initiative SAM.gov-only changes nothing customers see today.** Every search surface already
  reads SAM only for live notices; DIBBS is parked and stays in its own panel.
- Consequences come only from the later matching/classification/ranking changes, each separately approved:
  fewer wrong-trade notices (e.g. guard searches 476 → 273 under option A), changed DIRECT counts, changed alert
  contents for saved searches.
- Unchanged by this scope: Coming back, Coming soon, grants, SBIR pins, DIBBS panel, opportunity detail of a
  DIBBS pursuit.
- Open decisions surfaced, not proposed: the 9,712 active no-deadline notices; whether SBIR pins on the Open map are
  in scope; whether the DIBBS panel should say "paused, last updated Nov 2".
