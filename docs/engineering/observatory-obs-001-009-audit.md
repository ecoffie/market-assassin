# Observatory OBS-001 – OBS-009 audit

**Started:** 2026-10-06. **Question:** for each published Observatory standard, is the number real,
complete, and computed the way its methodology says? Registry: `src/lib/analytics/observatory-methodology.ts`.
Engine: `src/lib/analytics/observatory.ts`. Public ladder: `/research/how-we-publish`.

> The earlier research-pipeline investigation this audit continues was not saved to disk (searched
> `docs/`, `tasks/`, `~/docs` on 2026-10-06). This file is now the record. Prior related work:
> `tasks/OBSERVATORY-TRUNCATION-DEFECT.md` (resolved 2026-08-25 by `20260825_observatory_aggregates.sql`).

| OBS | Name | Registry lifecycle | Status after this audit |
|---|---|---|---|
| 001 | Small-business participation | Production | ✅ exact head-counts (fleet and per-agency). Minor: counts any non-`NONE` code as "small business" |
| 002 | Awarded set-aside mix | Production | ✅ fleet (Observatory) exact. ❌ per-agency (Competition Health) was keyword-matched + capped — **fixed in PR #1841** |
| 003 | Return behavior | Collecting | ⚠️ collecting, but **miscomputed** (anon ids + email opens dominate) |
| 004 | Attention by agency | Beta | ⚠️ collecting, but **miscomputed** (mostly dismissals; one user ~73%) |
| 005 | Discovery index | Collecting | ⚠️ collecting, but **one user dominates** (26-pt swing) |
| 006 | Sharing / referral | Collecting | ❌ reads a **stalled legacy store**; the live share store is ignored |
| 007 | Average decision time | Collecting | ❌ instrument **does not measure a decision** for 91% of rows |
| 008 | Procurement Health Score | Research | Not computed anywhere (correct). Input "supplier-base breadth" exists as an implemented, unpublished signal |
| 009 | Competition depth | Beta | ⚠️ code contradicted the definition (≤1 vs exactly one; Award-ID order) — **fixed in PR #1841**, stays Beta |

---

## Section A (COMPLETED 2026-10-06): Competition Health admin page vs OBS-001/002/008/009

`/admin/competition-health` → `GET /api/admin/competition-health` → `computeCompetitionHealth()`
(`src/lib/analytics/competition-health.ts`) + `computeCompetitionDepth()` (`competition-depth.ts`).

**What it is.** Phase 1 of the buyer-facing Competition Health product
(`docs/strategy/PRD-buyer-competition-health.md`; Phase 3 = gated per-agency buyer login). It is
NOT the Observatory report pipeline. It reuses the OBS-009 engine (shared with the Observatory tile,
`/api/gov-buyer/competition`, and the market-research export) and computes its own per-agency
variants of OBS-001/002.

**Sources.** All Supabase reads (primary client) except competition depth: live USASpending API,
cached 24h in `mcp_external_cache`. No BigQuery, no KV. Loading the page and Refresh run the same
GET. The only write is the 24h cache upsert on a depth cache miss (≈1 USASpending search + 100
per-award detail calls, 8 concurrent). No business-data writes.

### Displayed values (DEFENSE screenshot) vs stored evidence

| Displayed | Verdict | Evidence |
|---|---|---|
| 37.8% SB participation, 8,667 of 22,906 | ✅ reproduced exactly | exact head-counts, 2026-10-06 |
| 57.5% single-bid, 2.6 avg bidders, 80 sampled | ✅ reproduced from the stored cache row (fetched 2026-10-06 09:13 UTC: sampled 100, 80 with data, 46 ≤1) | but computed under v1 semantics (≤1 incl. zero; Award-ID order); ±10.8 pts at n=80; the 2026-08-22 DoD sample said 78.6% (n=42) |
| **712 distinct winning firms** | ❌ **INVALID** | `.limit(4000)` was capped at 1,000 rows by PostgREST, unordered. Population for the same window: **4,763 distinct winners across 17,742 award notices** |
| **10 first-time winners** | ❌ **INVALID** | "top 15 by $ of an arbitrary 1,000-row slice". Population: 2,764 winners not seen before the window, but the record starts 2026-03-16, so this cannot be called "first-time" (see below) |
| **Top-3 share of $ (as displayed)** | ❌ **INVALID** | computed over the same slice. Population: **34.3%** (Raytheon, Electric Boat, M1 Support Services) |
| "No enriched award set-aside data" | ❌ bug | `ILIKE '%DEPT OF DEFENSE%'` matched 0 of **24,617** rows stored as `Department of Defense` |

Do not cite 712, 10, or the old top-3 share anywhere.

### Mapping to OBS identifiers
- Small-business participation → **OBS-001** (per-agency).
- Awarded set-aside mix → **OBS-002** (per-agency variant; previously not the OBS-002 method).
- Single-bid share + average bidders → **OBS-009**.
- Distinct winners, first-time winners, top-3 concentration → no OBS id. This **is** the
  "supplier-base breadth" input to OBS-008: **implemented signal, unpublished standard** (not
  "no data"). `observatory.ts` called the same input "supplier churn"; standardized to
  "supplier-base breadth" in the fix PR.
- Composite score → **none**. OBS-008 is not computed; the page shows separate component cards
  plus threshold rules ("Today's Priorities").

### Coverage
- Participation / open mix / NAICS: any SAM department (exact `department` match). The open-notice
  mix and NAICS coverage remain a 1,000-row sample; the fix PR labels them as such (population fix
  is a follow-up).
- Depth: only agencies `resolveAgencyIdentity` can map (14 named + "X, DEPARTMENT OF" + service
  branches); others are refused.
- Winners: any department. Before the fix, every buyer with >1,000 award notices in 90 days was
  truncated. Measured 2026-10-06: DoD 17,742, Interior 2,299, VA 2,001.
- Corpus history: `sam_opportunities` begins **2026-03-15**. Any "first-time" or year-over-year
  claim from it is bounded by that.

### Fix PR (Competition Health correctness)
**PR #1841** (`fix/competition-health-correctness`). Population RPC `competition_health_winners` (migration
included, **not applied**), canonical-identity awarded mix with exact head-counts, OBS-009 v1.1
(exactly one reported offer, zero/missing excluded, newest-first sample, 95% CI), "Exact" chip
removed from the winners card, terminology standardized. Before/after evidence is in the PR body.

---

## Section B (COMPLETED 2026-10-06): are OBS-003 – OBS-007 genuinely collecting?

**Truncation is fixed.** Each of OBS-003..007 reads a single-row in-database RPC from
`20260825_observatory_aggregates.sql`; all six `observatory_*` functions exist in production.
Data is accruing for all five. But four compute the wrong thing or read the wrong store.
All figures below were measured on production on 2026-10-06 (read-only); key figures were
re-checked independently.

### OBS-003 Return behavior: collecting, but miscomputed
- Path: `observatory.ts` `returnBehavior()` → `observatory_return_behavior()`. Complete read.
- Published output: 17,191 users, 2,086 returners (12.1%), median 1 active day.
- **15,072 of 17,192 user ids (87.7%) are anonymous `anon:` browser ids** (re-checked), first seen
  the week of 2026-08-17. Email opens (`daily_alert` `email_open`) count as active days. No staff,
  test, or anon exclusion.
- The headline moves from 12.1% to 86.9% (identified non-staff) or 54.6% (identified, in-app only)
  depending on population. **The number has no defined population yet.**
- Registry says Collecting; the engine relabels it Beta once n ≥ 500, so the board shows Beta.

### OBS-004 Attention concentration by agency: collecting, but miscomputed
- Path: `attentionByAgency()` → `observatory_attention_by_agency(8)`. Complete read.
- 6,005 "views" (re-checked): **3,499 are dismissals**, 1,040 are pipeline next-action edits,
  only **754 are `open_details`**. One external account generates **4,390 (73%)** (re-checked).
- Map card events (the main discovery surface: 4,631 popup opens, 2,256 clicks) carry no `agency`
  field, so they are never counted. Free-tier `daily_alerts` events (1,336 opens, 289 users) are
  excluded by the `event_source` filter. Agency names are not normalized.
- Registry limitation "bounded sample" is stale (the read is complete now).

### OBS-005 Discovery index: collecting, one user dominates
- Path: `discoveryIndex()` → `observatory_discovery_index()`. Complete read.
- 754 opens / 712 saves across 58 users → 51.4% browse share. The same single account is 47% of
  events and 75% of saves; without it the rate is 77.4% (a 26-point swing).
- Only the Pro alerts panel emits these actions; free-tier, Map, and the ~6,600 real pipeline
  saves are not counted. Weekly volume 0–95 opens.

### OBS-006 Sharing / referral: reads a stalled legacy store
- Path: exact head-count of `opportunity_shares`: **22 rows ever** (re-checked), 6 from staff, last
  row 2026-09-18. Written only by the legacy briefings ShareButton.
- The live share store, `user_engagement` `listing_share` (Map, `opportunity-map/route.ts`), has
  **273 events** (re-checked) from 49 sharers, 179 with a `share_id`, active through 2026-10-05.
  The frozen share-attribution contract (`docs/engineering/opportunity-share-attribution.md`)
  already names `opportunity_shares` legacy. `scripts/report-intel.mjs` has the same legacy read.

### OBS-007 Average decision time: instrument does not measure a decision
- Path: `decisionTime()` → `observatory_decision_time()` over `user_pipeline.discovered_at`.
- 6,592 stamped rows (re-checked), median 0 hours, 6,582 under 24 hours.
- **6,016 (91.3%) are `source='daily_alert'` one-click email saves** (re-checked). Email engagement
  rows carry no notice id, so `resolveDiscoveredAt` never finds an earlier event and stamps the save
  time itself. Of 3,153 sub-second rows in the last 30 days, 0 had an earlier matching event. The
  real discovery moment for these is the alert send (`alert_log`), which nothing reads.
- Latent: Map events store ids under `nid` / `opp`, not in the resolver's key list.
- Registry says Collecting (so the public ladder shows Collecting) while the engine reports Research.

### Recommended fixes (not applied; each needs its own scoped PR)
1. OBS-003: define the population (exclude `anon:` and staff; in-app actions only), align lifecycle.
2. OBS-004: count view actions only; tag Map card events with agency; normalize agency names;
   publish top-user share.
3. OBS-005: include free-tier and Map events; report with and without the top user.
4. OBS-006: read `listing_share` (non-staff, `share_id`-bearing) instead of `opportunity_shares`.
5. OBS-007: resolve email-save discovery from `alert_log`; add `nid`/`opp` to the resolver keys;
   set lifecycle to Research until it measures a real interval.
6. OBS-001/002 Observatory: three `?? 0` sites (`observatory.ts` ~114, ~141, ~346) turn an unknown
   count into zero.

**Implication for the public ladder:** OBS-003..007 should not be described as "accruing toward
publication" until each has a defined population and a correct instrument. Collecting rows is
true; collecting the *measure the methodology describes* is not yet true for any of the five.
