# POTETO — Players × NAICS coverage and identity audit (2026-10-04)

**Read-only.** No production writes, no schema changes, no backfills. BigQuery cost of this audit is about 12.4 GB, with every query dry-run first (the daily cap is 2 TiB and shared with prod). Temporary scripts were deleted.

Data files (stable, named cohorts):
- `tasks/players-naics-scorecard-2026-10-04.csv`: all 1,367 six-digit NAICS that have awards
- `tasks/players-zero-cells-2026-10-04.csv`: all 19,696 NAICS × state cells where Maps shows 0 Players but real awardees exist

---

## Verdict

**First failing layer: the Players aggregation, specifically `usaspending.top_contractors_by_dimension`.**

That table is a **listicle rollup** that keeps only `rank <= 50`, the national top 50 firms by all-time $ per NAICS. It was built for the `/top/[slug]` SEO pages. Maps Players reads it as if it were the full population of firms, then narrows it to the viewport's state. This is the documented **rank-then-filter** class, frozen into a materialized table. The rank-then-filter gate cannot see it, because the cut happens in SQL and not at a `searchRecipients` call site.

Identity is **not** the failure. 100% of award UEIs resolve to the recipients table.

**Reproduced on prod code** (`searchRecipients`, the same arguments `contacts-map` sends for a single-state viewport):

| Request | Maps / `search_contractors` | `find_capable_contractors` | Real awardees with HQ in that state |
|---|---|---|---|
| 541512 · TX | **0** | 242 (firms ≤$25M) | 327 |
| 541512 · FL | 1 | — | 312 |
| 541512 · VA | 34 | — | 2,349 |
| 561720 · CO | **0** | — | 133 |
| 238220 · NY | **0** | 304 | 326 |
| 541330 · NY | **0** | — | 356 |
| 236220 · WA | **0** | — | 265 |
| 541512 · US (zoomed out) | 50 | — | 7,666 |

---

## 1. Canonical Players pipeline (as built)

| Step | Authoritative table / field | Notes |
|---|---|---|
| award | BQ `usaspending.awards` (65.2M txns, partitioned by `fiscal_year`, clustered by UEI/name) | weekly ingest; last merge 2026-09-27, source action max 2026-09-25 |
| → NAICS | `awards.naics_code` (the **awarded** NAICS on the transaction) | not the SAM registration NAICS, not the primary NAICS |
| → recipient | `awards.recipient_uei`, `recipient_name` | 0 null-UEI rows for 6-digit NAICS |
| → identity | BQ `usaspending.recipients` (322K UEIs; HQ `city`/`state`) | rebuilt with the ingest 2026-09-27 |
| → player record | **`top_contractors_by_dimension` WHERE dimension='naics'** | groups by `recipient_name` and keeps one UEI per name; **`rank <= 50`**; all-time $ |
| → aggregation | `searchRecipients()` NAICS path, `src/lib/bigquery/recipients.ts:1556` | `LEFT JOIN recipients … WHERE r.state = @state` |
| → Maps | `/api/app/contacts-map` `companiesPins()`: viewport → ≤6 states, one call per state, then geocode + bbox | `totalForFilters` = the sum of those per-state counts |

**NAICS membership semantics:** a firm is a Player for X only if it is among the **50 largest all-time $ awardees under awarded-NAICS X nationally**. SAM registration NAICS, primary NAICS, the Contractor DB, and opportunity history are not used.

## 2. Coverage audit

| Population | Real awardee firms (UEI) | Players in rollup | Coverage |
|---|---|---|---|
| All 1,367 NAICS | 934,339 (NAICS, UEI) pairs | 51,596 | **5.52%** |
| Top 100 by award count | 328,481 | 5,000 | **1.52%** |
| Top 100 by unique contractors | 498,208 | 5,000 | **1.00%** |
| Top 100 by obligations | 354,121 | 4,951 | **1.40%** |

- **889 of 1,367 NAICS (65%)** have more than 50 awardees, so the cap cuts them.
- **241 NAICS** with more than 100 awardees have coverage under 5%.
- National `awards>0 AND recipients>0 AND Players=0`: **2 NAICS**, 445240 and 458310. Both are STALE DERIVATION (see §7).
- **NAICS × state, which is what Maps actually renders:** 42,924 cells have real in-state awardees. **19,696 (45.9%) show 0 Players.** Of those, 5,720 cells hide ≥10 firms, 1,096 hide ≥50, and 396 hide ≥100. Only 5.43% of in-state firm-cells can be reached at all.
- Worst zero cells: 115310/ID 719 · 611430/CA 646 · 115310/WA 645 · 541990/FL 594 · 541611/TX 438 · 541512/TX 327 · 238220/NY 326.
- Hit hardest: small-market states and territories (WY 407/484 NAICS show 0, DE 494/593, VT, ME, ND). VA/MD/CA are hit least, because the national top 50 is concentrated there.

## 3. Common-code sanity suite

| NAICS | Awards | Awardees | Rollup | States with firms | States showing **0** | Biggest hidden |
|---|---|---|---|---|---|---|
| 541512 | 76,625 | 7,666 | 50 | 55 | **43** | TX 327, GA 183, CO 168 |
| 561720 | 43,943 | 5,836 | 50 | 57 | **37** | MO 139, CO 133, OR 127 |
| 238220 | 47,532 | 9,548 | 50 | 56 | **36** | NY 326, PA 313, CO 211 |
| 541330 | 187,315 | 14,893 | 50 | 55 | **38** | NY 356, OH 312, NJ 282 |
| 236220 | 176,154 | 11,767 | 50 | 57 | **34** | WA 265, NC 256, OH 251 |

**The exact NAICS that originally returned zero cannot be recovered.** Map telemetry (`user_engagement`, `event_source='opportunity_map'`) does not record the Players NAICS filter or a zero-result event, and 10K events only reach back about 2 days. That is a telemetry gap. With these numbers, any common code in any state outside the top-50 concentration states reproduces it.

## 4. Identity failures (why awardees disappear before Players)

Measured over 934,339 (NAICS, UEI) pairs:

| Cause | Count | Share |
|---|---|---|
| missing UEI | 0 | 0% |
| UEI not in recipients (SAM/entity missing) | 0 | 0% |
| no usable US state (foreign or blank HQ), so it can never be placed | 60,941 | 6.5% |
| rollup name-grouping (one UEI kept per name) | 43 zero-cells in 34 small NAICS | ~0% |
| **aggregation truncation (rank ≤ 50)** | **882,743** | **94.5%** |
| NAICS association / primary-vs-awarded mismatch | n/a: there is one consistent model (awarded NAICS) | — |
| stale aggregation | 2 NAICS (5 awardees) | ~0% |

## 5. Semantic question

- **What production implements:** a fourth option, **"B, truncated":** the top 50 national all-time $ awardees under NAICS X, intersected with HQ state. It is not A (SAM registration), not full B, and not C (capability).
- **What the UI says:** the mode is "Players" and the toggle is "Companies". The API doc says "award-winning federal contractors". Nothing tells the user it is a top-50 national list, so a 0 reads as "no companies in this industry here", which is false. **The UI does not accurately describe what it shows.**
- Other surfaces answer different questions under similar wording:
  - `assess_market_depth` answers **A**: SAM `sam_entities` registration plus BQ activity.
  - `find_capable_contractors` answers **B, full**: a live awards scan with a ≤$25M cap.
  - `capability-search` answers **C**.

## 6. Cross-surface parity

| Surface | Source | 541512 · TX |
|---|---|---|
| Maps Players | top-50 rollup ∩ state | **0** |
| MCP `search_contractors` | same `searchRecipients` path | **0** |
| In-app contractor search (`/api/contractors/search-bq` with naics+state) | same path | **0** |
| MCP `find_capable_contractors` / OSBP smb-search | live `awards` scan | **242** |
| MCP `assess_market_depth` | SAM registration + BQ | different population (A) |

The same semantic request gets an **unexplained 0 versus 242 contradiction** inside one MCP server. The 0 is the wrong answer.

## 7. Freshness

| Layer | Watermark | Last rebuild | Lag |
|---|---|---|---|
| `awards` (source) | action max 2026-09-25 | merged 2026-09-27 | — |
| `recipients` | — | 2026-09-27 18:58 | 0 days (rebuilt with the ingest) |
| `top_contractors_by_dimension` (Players) | built from awards as of ≤2026-09-05 | 2026-09-05 08:00 (table mtime) | **~22–29 days**; monthly `0 8 5 * *`, next run 10-05 |

- Players data is **materialized monthly, then cached in KV** (`recipient-search-naics:*:v4`). It is not computed live.
- The rollup is **not triggered by the ingest**, so it is always up to a month behind.
- ⚠️ `cron_job_runs` for `refresh-bq-rollups` shows `status=dispatched`, `http_status=null` for Jul, Aug and Sep. **No success has been recorded since June.** Only the table's mtime proves the Sep 5 run landed. This is the "no execution ≠ success" class.
- **DoD gap, confirmed in `awards`:** DoD txns per month are Jan 276,956 → **Feb 73 → Mar 74** → Apr 112,793 (partial) → May 359,297. There is also a second near-empty DoD stretch: **Jul 150 · Aug 80 · Sep 647**. That stretch is probably DoD's 90-day publication delay, but I have not verified it.
  - Effect on Players: small. The rollup ranks on all-time FY2015+ $, so a 2–3 month hole shifts ranks a little and cannot by itself produce the zeros above.
  - Surfaces that use a 3-FY window (the agency-scoped Players path, `fiscal_year BETWEEN now-2 AND now`) are more exposed.

## 8. Zero-result truth (Maps client, `opportunity-map/route.ts` ~2305–2335)

| State | What Maps shows | Correct? |
|---|---|---|
| genuine zero | 0 | yes |
| **cap truncation (this bug)** | 0 | **no.** It is shown as fact. |
| BQ quota exhausted / failed query | `queryCached` returns `[]` and marks it degraded. `searchRecipients` never reads `bqResultState`, so the API returns `success:true, total:0` and the user sees 0 | **no** |
| companies fetch 500 while buyers succeeds | companies silently set to `total:0` | **no** |
| both fail with an error | the "Meet the buyers behind the opportunities" **upsell copy** (the auth-denied empty state) | **no.** A server error is shown as a sales pitch. |
| network error | `total:0` | **no** |
| stale aggregation | 0 for new codes (445240, 458310) | **no** |
| no-US-state firms | silently omitted, no disclosure | partial |

MCP `search_contractors` has the same issue: its `degraded` flag only trips on a thrown exception, never on the swallowed-quota `[]`.

---

## Root-cause classification of every zero-player result

| Class | Count | Where |
|---|---|---|
| **QUERY BUG**: top-50 listicle rollup used as the population, then state-filtered (rank-then-filter in SQL) | **19,653 NAICS×state cells**, plus the cap on 889 NAICS | first failing layer: `top_contractors_by_dimension` (`rank <= 50`) read by `searchRecipients` NAICS path |
| IDENTITY RESOLUTION: rollup groups by name and keeps one UEI | 43 cells in 34 small NAICS | same table, `rolled` CTE |
| STALE DERIVATION: awards landed after the 09-05 rebuild | 2 NAICS nationally (445240, 458310; awards dated 09-01 and 09-04) | monthly rollup not chained to the weekly ingest |
| TRUE ZERO | 0 of the audited zeros | every audited zero cell has ≥1 resolvable in-state awardee |
| DATA COVERAGE | 0 as the cause of a zero. The DoD Feb–Mar hole shifts $ but does not zero out a cell | — |
| NAICS MODEL | 0. The model is consistent (awarded NAICS), but undisclosed | UI language (§5) |
| UNKNOWN | the exact originally reported query (no telemetry) | — |

## Proposed repairs (NOT executed; each needs sign-off)

1. **Stop reading a top-50 listicle as a population** (fixes about 99.8% of the zeros). Add a full `naics_recipient_state` rollup in BQ: `naics_code, recipient_uei, name, state, city, total_amount, award_count, last_action_date`, with no rank cap, clustered by `naics_code, state`. Point the NAICS path of `searchRecipients` at it.
   - Measured the same shape: about 934K rows, and a per-NAICS+state read is a few MB.
   - This is a **new BQ table**, so it is a schema change and needs approval.
   - Keep `top_contractors_by_dimension` for `/top/*` pages only.
   - Alternative with no new table: route the NAICS+state case through the existing live awards-scan shape (like `findCapableSmallBusinesses` without the $ cap). That costs roughly 2–4 GB per uncached call, which is a real quota risk on the map. I don't recommend it.
2. **Make Maps and MCP tell zero apart from unknown.**
   - `searchRecipients` returns `bqResultState(cacheKey, rows)`.
   - `contacts-map` returns `state: 'measured'|'degraded'|'unavailable'`.
   - The client renders "Couldn't load Players — retry" instead of 0, and never shows the buyers upsell for a non-auth error.
   - `search_contractors._meta.degraded` reads the same signal.
3. **Chain the rollup rebuild to the ingest.** Run `refresh-bq-rollups` after `ingest:awards:apply` succeeds. Also fix the run ledger: the dispatcher records `dispatched` and never the outcome, so there has been no success evidence since June.
4. **Name the semantics in the UI:** "Companies that have won federal awards under NAICS X, headquartered in view". Add a count disclosure when the population is truncated.
5. **Add an oracle** (`verify:oracles --only players`): for 541512/TX, 238220/NY and 561720/CO, Players count ≥ 90% of the distinct in-state awardee UEIs. Prove it red on today's code first, then green after the fix.
6. **Telemetry:** emit `players_result` with `{naics, states, total, state}` so the next "0 Players" report can be recovered.
7. **Parity:** after repair 1, `search_contractors` and `find_capable_contractors` should reconcile, apart from the documented ≤$25M cap. Add that to the oracle.

---

## Repair status (2026-10-04, branch `fix/players-canonical-dataset`)

Approved repairs 1, 2, 3, 5, 6 are BUILT and tested; nothing is written to production.

- **Dataset:** `players_naics_recipients` (`src/lib/players/dataset.ts`): full NAICS × UEI × HQ state with no cap. It is **not built in production**; the rebuild gate refuses while the awards warehouse is incomplete.
- **Query:** filter, then rank (`src/lib/players/query.ts`). It sits behind `PLAYERS_SOURCE=canonical`, which is OFF.
- **Truth states + copy:** live on the legacy source. A legacy answer is reported as `coverage_incomplete` / "Top N shown · partial list", never a bare 0.
- **Oracle:** `verify:oracles --only players`. It FAILS on current production (48/48 cells) and PASSES in preview (48/48 cells, plus all 43,972 warehouse cells).
- **Production sequence:** BQ awards repair → awards reconciliation → `players:rebuild -- --go` → `players:rebuild -- --reconcile --go` → set `PLAYERS_SOURCE=canonical`.
