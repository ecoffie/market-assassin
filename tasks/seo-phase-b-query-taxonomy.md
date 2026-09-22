# Phase B — Mindy search-demand map (planning artifact, nothing built)

**Date:** 2026-09-21 · **Status:** taxonomy only. Phase C pages are NOT authorized and NOT built.

North star: *any legitimate contractor searching for help finding or winning government contracts
should encounter a useful Mindy page.* This document maps the demand; it does not create pages.

---

## The measurement that frames everything

Six months of Search Console (2026-03-24 → 2026-09-18):

| | |
|---|---|
| distinct queries | 4,513 |
| impressions | 13,976 |
| clicks | **32** |
| of which the branded query `getmindy.ai` | **28** |
| **non-branded clicks** | **4** |

The site ranks — positions 1.8 to 7 — on thousands of contract-number lookups. `"19aqmm24f2376"`:
430 impressions, position 1.8, **zero clicks**. Ranking is not the problem. The query class is.

**Reporting rule for everything below: non-branded performance is reported separately from
branded `getmindy.ai` traffic, always. Mixing them is how 4 real clicks looked like 32.**

---

## Intent split

### Reference lookups — rank, never convert. Do not build for these.

| Class | Example | Evidence |
|---|---|---|
| PIID / contract number | `"19aqmm24f2376"`, `"n0018925fz703"` | 430 / 425 impressions, pos 1.8 / 5.5, 0 clicks |
| UEI / CAGE lookup | `"p224xeqtk9n3" address` | 2 impressions, 0 clicks |
| Named-entity award check | `cerner contractors` | 1 impression, pos 77 |

Someone pasting a contract number into Google wants a record, not a tool. These already work via
`/contractors/*` and stay robots-blocked at `/contracts/*`. **No further investment.**

### Buyer intent — the actual target. Ten families.

| # | Family | Query shapes | Mindy data that answers it | Strength |
|---|---|---|---|---|
| 1 | **Finding opportunities** | "how to find government contracts", "where are federal contracts posted", "government contracts for small business" | `sam_opportunities` 215,115 · `agency_forecasts` 35,912 | ★★★ |
| 2 | **Qualifying opportunities** | "should I bid on this contract", "bid/no-bid criteria", "how to tell if a contract is winnable" | award history, incumbent + competitor counts | ★★ |
| 3 | **Winning contracts** | "how to win your first government contract", "why did I lose the bid", "past performance with no experience" | `awards_serving_pages` 93,910, winning-playbook MCP tool | ★★ |
| 4 | **Industry / trade-specific** | "federal landscaping contracts", "government HVAC contracts", "janitorial government contracts" | NAICS-scoped spend + open opps + incumbents | ★★★ **best fit** |
| 5 | **Agency-specific markets** | "how to sell to the VA", "NAVFAC small business", "[agency] contract opportunities" | 49 agency profiles + forecasts + spend | ★★★ |
| 6 | **NAICS / PSC guidance** | "what NAICS code for [trade]", "PSC vs NAICS", "NAICS 561730 federal contracts" | 384 NAICS + 366 PSC pages live | ★★ |
| 7 | **Incumbents & recompetes** | "who has the contract for X", "when does [contract] expire", "how to beat an incumbent" | rollup profiles 11,770 + expiring-contract data | ★★★ |
| 8 | **Set-asides & certifications** | "8(a) vs HUBZone", "is my business HUBZone", "WOSB contracts" | 4 program pages + set-aside tallies | ★★ |
| 9 | **Subcontracting & teaming** | "how to subcontract to primes", "find teaming partners", "SBLO contact" | subaward data + SBLO directory | ★★ |
| 10 | **Local / state / federal** | "federal contracts in [state]", "state vs federal contracting" | `pop_state` on opportunities + NAICS×state routes | ★ (weakest — beware combinatorial URLs) |

---

## Demand sources to mine before choosing 20–50 queries

1. **GSC** — the only source with real impression volume. Today it is dominated by reference
   lookups, so it validates *supply*, not demand. Re-pull after indexation recovers.
2. **MCP tool usage** — which tools get called, with what arguments. The closest proxy for what a
   contractor actually wants answered, and it is first-party.
3. **`/try` submissions** — the capability text people type describes their trade in their own
   words. This is the single best source for family #4.
4. **Internal search + chat logs** — questions asked in-product, unfiltered by what Google ranks.
5. **Customer questions** — support and coaching threads.

⚠️ Sources 2–5 are first-party and may contain customer-identifying text. Aggregate to query
patterns before anything reaches a page. `user_business_profiles` (645 rows) is private and must
never be exposed.

---

## Phase C selection criteria (when authorized)

A query earns a page only with all five:

1. demonstrated search demand (not assumed);
2. commercial intent — a buyer, not a lookup;
3. Mindy data strong enough to beat a generic article;
4. a materially better answer than what ranks today;
5. a natural next step into `/try`, Maps, Today's Intel or a saved watch.

Each page must carry: a direct written answer · real Mindy market data · agencies buying it ·
incumbents and competitors · relevant expiring contracts or open opportunities · small-business /
set-aside context · sourcing and freshness · a specific product action, not a generic signup CTA.

**Explicitly forbidden:** city × industry × agency combinations generated to multiply URLs. Each
page needs distinct demand, distinct evidence, and enough data to help a human.

---

## Measurement and the decision gate

Track every pilot page end to end:

```
impression → organic click → /try or market action → account creation
```

- Non-branded reported separately from branded, always.
- Baseline to beat: **104 clicks / 28 days**, of which 102 are the homepage and 21 are the query
  `getmindy.ai` (from the 2026-09-21 investigation).
- **90-day gate after indexation recovers.** If 20–50 well-built buyer-intent pages do not produce
  non-branded clicks that convert into `/try` entries within 90 days, SEO is not Mindy's channel
  and effort moves to the owned audience, conferences and advisory.

## Blocking prerequisites

1. Indexation recovers (Phase A shipped and verified live).
2. `/try` relevance bugs fixed — these pages share the match logic, and cross-domain false
   positives would poison every one of them.
3. Re-pull GSC once hub pages begin leaving "Crawled – currently not indexed".
