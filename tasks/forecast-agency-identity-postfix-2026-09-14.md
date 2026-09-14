# FORECAST SURFACE P0 FIX — POST-FIX EVIDENCE REPORT

**Shipped:** 2026-09-14 · **PR** [#1508](https://github.com/ecoffie/market-assassin/pull/1508) · **merge** `48e60ea8` · **verified on `https://getmindy.ai`**
Audit it closes: `tasks/forecast-surface-coverage-audit-2026-09-14.md`

**Constraints honored:** no new agencies · no new forecast data ingested · `agency_forecasts` not modified · Decision Makers not started · HHS fiscal-year/currentness rule untouched · Maps not forced toward 100% pin coverage.

---

## Expected P0 success condition

> **OWNED FORECASTS HIDDEN SOLELY BY AGENCY IDENTITY = 0**

### ✅ **MET — 0 records.** Agency-reachable corpus went **7,672 → 35,751 of 35,751 (21.5% → 100%)**.

---

## 1. Exact live forecast row count

**35,751** (unchanged — nothing was ingested or mutated).

## 2. Agency-reachable rows — BEFORE vs AFTER

| | Rows reachable by agency | % of corpus |
|---|---:|---:|
| Before | 7,672 | 21.5% |
| **After** | **35,751** | **100%** |
| Unlocked | **+28,079** | +78.5pp |

## 3. Exact agency results — all represented agencies (live prod, Maps)

`matched` = pinnable + unmapped, i.e. every row the agency filter reaches.

| Agency term | BEFORE | AFTER | Truth | Pins | Unmapped |
|---|---:|---:|---:|---:|---:|
| DEFENSE / DOD / Department of Defense / PENTAGON | **0** | **11,789** | 11,789 | 5,478 | 6,311 |
| ARMY | **0** | **2,908** | 2,908 | 425 | 2,483 |
| USACE / Army Corps of Engineers | 2,908 | 2,908 | 2,908 | 425 | 2,483 |
| NAVY / Department of the Navy | 8,881 | 8,881 | 8,881 | 5,053 | 3,828 |
| ONR | 48 | 48 | 48 | 8 | 40 |
| NRL | 12 | 12 | 12 | 12 | 0 |
| HEALTH AND HUMAN SERVICES | **0** | **5,504** | 5,504 | 0 | 5,504 |
| HHS | 5,504 | 5,504 | 5,504 | 0 | 5,504 |
| HOMELAND SECURITY | **0** | **1,644** | 1,644 | 870 | 774 |
| DHS | 1,644 | 1,644 | 1,644 | 870 | 774 |
| ENERGY | **0** | **1,301** | 1,301 | 1,156 | 145 |
| JUSTICE | **0** | **619** | 619 | 348 | 271 |
| NATIONAL AERONAUTICS | **0** | **189** | 189 | 0 | 189 |
| ENVIRONMENTAL PROTECTION | **0** | **50** | 50 | 27 | 23 |
| VETERANS AFFAIRS | 692 | **1,390** | 1,390 | 1,371 | 19 |
| INTERIOR | 3,131 | **6,164** | 6,164 | 6,155 | 9 |
| AGRICULTURE | 2,509 | **5,028** | 5,028 | 1,770 | 3,258 |
| GENERAL SERVICES | 336 | **514** | 514 | 332 | 182 |
| TRANSPORTATION | 660 | **897** | 897 | 754 | 143 |
| LABOR | 144 | **166** | 166 | 164 | 2 |
| TREASURY | 200 | 200 | 200 | 197 | 3 |
| SSA / NRC / NSF | 170 / 89 / 37 | 170 / 89 / 37 | ✓ | 0 / 89 / 37 | 170 / 0 / 0 |

The 7 presets that previously "worked" only reached the `department`-populated half of each pair (VA 692 of 1,390, DOI 3,131 of 6,164, USDA 2,509 of 5,028, GSA 336 of 514, DOT 660 of 897, DOL 144 of 166). They now reach the whole agency.

**Zero mismatches against ground truth across all 30 identities** (`npm run verify:forecast-agency`).

## 4. EPA — before vs after

| | Rows matched | Drawn as EPA pins | Wrong rows |
|---|---:|---:|---:|
| Before | **7,246** | 5,438 | **7,196** |
| **After** | **50** | 27 | **0** |

Cause was never EPA-specific: `ilike.%EPA%` matched "d‑**EPA**‑rtment". The *matching contract* was fixed — exact `source_agency.in.(…)`, with a word-boundary `\m…\M` fallback for unresolved terms. Regression-tested across `EPA · FBI · DEA · ATF · TSA · FAA · DLA · SEC · GSA · VA`: **0 cross-agency bleed**. `SEC` (which silently returned 170 "Social **SEC**urity Administration" rows) now returns an honest **0**.

## 5. Navy

Unchanged and confirmed correct — **no regression**: Maps 8,881 matched / **5,053 pins** (NAVY 5,033 + ONR 8 + NRL 12), MCP **8,701**. Navy was never missing; the audit study's `NAVY ✗` was a methodology artifact. "Navy", "Department of the Navy", "DON", "NAVSEA/NAVAIR/NAVFAC" all resolve.

## 6. DOD — explicit, deterministic parent rollup

`DOD = NAVY + ONR + NRL + USACE`, coverage **`partial`**. Verified exactly: **11,789 == 8,881 (Navy incl. labs) + 2,908 (USACE)**. Air Force, Army proper, DLA, DISA and DARPA publish no forecast feed we ingest — stated in the identity's `note`, not silently implied. MCP returns **11,389** (= 11,789 − 400 past-FY rows the MCP rule drops). Identity identical; the delta is the documented FY policy, which this pass did not touch.

## 7. USACE

**2,908** rows. Reachable directly (`USACE`, `Army Corps of Engineers`), and via both parents (`ARMY`, `DOD`). Unchanged count, newly reachable by parent.

## 8. Army

**0 → 2,908.** Semantics recorded explicitly as **`coverage: 'partial'`** with the note *"PARTIALLY REPRESENTED THROUGH USACE"* — not "fully covered", not "missing".

> ⚠️ **This corrects a planning input.** The audience-coverage study ranked **Army the #1 Tier-1 expansion target** on the basis that Army had no forecast coverage. That was the agency-identity artifact. **Re-validate the Tier-1 list before any connector work.** No broader Army source was acquired in this pass, as instructed.

## 9. HHS identity

Identity now resolves correctly from every form (`HHS`, `HEALTH AND HUMAN SERVICES`, `Department of Health and Human Services`, `DHHS`) → **5,504** rows, before any eligibility rule. The remaining HHS gaps are **classified separately and deliberately left alone**:

| Gap | Rows | Class |
|---|---:|---|
| Identity | **0** | ✅ fixed |
| No `map_lat` / no `pop_state` on any row | 5,504 | **MAP LOCATION LIMITATION** (upstream; not manufactured) |
| FY2024/FY2025 hidden from MCP | 2,954 | **CURRENCY/FY POLICY** (untouched this pass) |

## 10. Maps / MCP agency parity

Identity is now **structurally** shared — one resolver, `src/lib/forecasts/agency-identity.ts`, called by all surfaces.

| Term | Maps | MCP | Identity set |
|---|---:|---:|---|
| Department of Defense | 11,789 | 11,389 | NAVY+ONR+NRL+USACE |
| Army | 2,908 | 2,628 | USACE |
| EPA | 50 | 50 | EPA |
| HHS | 5,504 | 2,550 | HHS |
| SEC | 0 | 0 | ∅ |

Totals differ **only** by each surface's own eligibility rule (Maps needs a coordinate; MCP applies past-FY) — exactly the acceptable divergence. **The agency set never differs.** Guarded by 14 parity tests plus a test asserting no surface does its own agency matching.

## 11. Saved-search parity

The alert cron calls the same `applyForecastFilters`, so parity is structural rather than promised. Dry evaluation through the real code path (**no emails sent, no writes**), using exact per-code counts:

```
✓ EPA forecasts                in=[EPA:50]
✓ SEC forecasts                in=[—]
✓ DoD forecasts                in=[NAVY:8821 NRL:12 ONR:48 USACE:2908]
✓ Army forecasts               in=[USACE:2908]
✓ HHS forecasts                in=[HHS:5504]
✓ multi-select Navy|HHS        in=[HHS:5504 NAVY:8821 NRL:12 ONR:48]
✓ array-stored [NAVY,HHS]      in=[HHS:5504 NAVY:8821 NRL:12 ONR:48]
✓ TSA (child, no coverage)     in=[—]
✓ no cross-agency leakage
```

Both stored shapes are handled (pipe-joined string **and** raw array). EPA can no longer email a customer another agency's forecasts.

## 12. Maps pinnable count

**18,748 of 35,751 (52.4%)** — deliberately unchanged. Pin coverage is a location-data question, not an identity one, and forcing it was explicitly out of scope.

## 13. MCP eligible count

**32,234 of 35,751 (90.2%)** — unchanged (live tool `_meta.total` confirms). The 3,517 excluded are the past-FY rule, untouched.

## 14. Remaining gaps, classified

| Class | Rows | Detail | Status |
|---|---:|---|---|
| **DATA TRUTH** | 15,964 | No location published upstream ("TBD", "vendor's facility", or no field). Cannot be fixed by us; must never be fabricated. | Accepted |
| **MAP LOCATION LIMITATION** | 1,039 | Carry a real state/city but were never geocoded — recoverable by backfill (DHS 579, DOE 145, NASA 103, DOJ 86, SSA 43). | Open (P1) |
| **CURRENCY/FY POLICY** | 3,517 | Hidden from MCP by the default past-FY rule; visible in Maps. Maps/MCP disagree by exactly this. | Open — **product decision**, deliberately untouched |
| **UI** | — | 1,000-pin viewport cap; unplaced list capped at 150 and gated behind a search key. | Open (P1) |
| **MCP CONTRACT** | — | `limit` max 200 with **no offset/cursor** → no enumeration path; `include_past` not exposed as a parameter. | Open (P1) |
| **AGENCY IDENTITY** | **0** | — | ✅ **CLOSED** |

## 15. Owned forecast records still hidden solely because of agency identity

# 0

Proven two ways: every one of the 30 identities returns `resolver == ground truth`, and the union of all identity code sets covers **35,751 / 35,751** rows.

---

## What shipped

| File | Change |
|---|---|
| `src/lib/forecasts/agency-identity.ts` | **NEW** — the one resolver: closed 20-code vocabulary, identity table, parent→child rollup, word-boundary fallback |
| `src/lib/opportunities/map-data.ts` | `applyForecastFilters` → shared resolver (fixes Maps **and** the alert cron, which shares it) |
| `src/lib/forecasts/query.ts` | MCP `queryForecasts` → shared resolver |
| `src/app/api/forecasts/route.ts` | both agency sites → shared resolver |
| `src/lib/utils/agency-forecasts-live.ts` | retired the 4th private resolver (civilian-only; mapped **NRL → ONR**) |
| `src/lib/mcp/tool-registry.ts` | `agency` param contract documents alias + rollup behavior |
| `scripts/verify-forecast-agency-identity.ts` | **NEW** — `npm run verify:forecast-agency`, live, exits non-zero on mismatch |
| 2 test files | 53 identity tests + 14 parity/no-drift tests |
| `docs/REPAIR-LEDGER.md` | ledger row with proof anchor |

**Gates:** `tsc` clean · **5,422 unit tests pass** · pre-push gate green (all 13) · CI `verify` pass · preview verified before merge · production verified after.

Guard proven by injection: re-adding the old `ilike` **fails** the parity test; reverting **passes**.

---

## Recommended next (not started, per instruction)

1. **Re-validate the Tier-1 expansion list** — Army's #1 ranking rested on the identity artifact now fixed.
2. P1: geocode backfill for the 1,039 recoverable rows.
3. P1: MCP `offset`/cursor + expose `include_past`.
4. Product decision: align the past-FY rule across Maps and MCP.
5. Refresh stale figures in the MCP tool description / `marketing-stats.ts` (says ~33,000 / 21 agencies; actual 35,751 / 20).

*No new agency connectors were started.*
