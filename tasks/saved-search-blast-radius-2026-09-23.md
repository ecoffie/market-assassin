# Saved Search blast radius — REFRESHED after #1662 (2026-09-23) — FOR SIGN-OFF, NOT MIGRATED

**Status:** report only. This supersedes the #1661 numbers.
- No saved-search definition, alert cron or client code was changed.
- No email was sent.
- Saved searches remain `pending` in the cross-surface gate.
- Canonical layer measured: production `0f4bab89`, which includes #1662 (the software license concept and the typo wrapper contract).

```
npx tsx --env-file=.env.local scripts/discovery-saved-search-blast.ts --all
```

This runs READ-ONLY against production and replays every alerting saved search.
- **old** = exactly what `cron/saved-search-alerts` runs today.
- **canonical** = the saved NON-query filters plus the canonical plan (SAVED_SEARCH_POLICY: Open posted ≤30 days; Forecast current + future FY).

**Script changes in this PR:**
- Saved multi-agency values (`A|B`) are split into distinct ORed buyers, as the Maps adapters do.
- Forecast now reports two separate deltas:
  - **FY-policy Δ** = old semantics plus the canonical FY clause alone.
  - **meaning Δ** = canonical vs that.
- Forecast carries the plan's publisher `coverage`.

## 1. Production verification of #1662 (before this blast)

**Serving build:** `0f4bab89` (polled until `git merge-base --is-ancestor 0f4bab89 <serving>` passed).

**Method:**
- Maps side: live `/api/app/opportunity-map`, `/recompete-map` and `/forecast-map`. The bbox is quad-split until no tile is capped, then the pin identities are unioned.
- MCP side: the MCP canonical query (`applyOpenPlan` / `applyRecompetePlan` / `applyForecastPlan`, MCP_POLICY) on the production DB.
- Open is compared at listing level, because the map dedupes by solicitation.

| query | Open (MCP ≡ Maps) | Recompete (MCP ≡ Maps) | Forecast (MCP ≡ Maps) |
|---|---|---|---|
| software license | IDENTICAL: 177 listings + 6 unmapped | IDENTICAL: 5,207 pins = 5,207 mapped, 0/0 identity diff, 2,580 unmapped | IDENTICAL: 430 + 137 |
| software licenses | IDENTICAL: 180 + 6 | headline 5,207 / unmapped 2,580 = MCP (pin identity via the same plan) | IDENTICAL: 430 + 137 |
| software licensing | IDENTICAL: 177 + 6 | as above | IDENTICAL: 430 + 137 |
| license renewal (control) | IDENTICAL: 29 + 2 | IDENTICAL: 787 + 401 | IDENTICAL: 177 + 62 |
| software subscriptions (control) | IDENTICAL: 50 + 0 | IDENTICAL: 675 + 272 | IDENTICAL: 76 + 35 |
| shoe me opportunities in the Virgin Islands | IDENTICAL: 3 (state VI, no concept) | IDENTICAL: 26 + 7 | IDENTICAL: 8 + 3 |
| shoe me opportunities (control) | IDENTICAL: 31 + 2 (concept shoe) | IDENTICAL: 72 + 16 | IDENTICAL: 2 + 3 |
| shoe opportunities (control) | IDENTICAL: 31 + 2 | IDENTICAL: 72 + 16 | IDENTICAL: 2 + 3 |
| shoes in Virginia (control) | IDENTICAL: 6 + 2 (VA + shoes) | IDENTICAL: 3 + 0 | IDENTICAL: 1 + 0 |

Notes:
- The "software license/licenses/licensing" plans are byte-identical. The 223/227 Open drift is notices closing during the run; each comparison is simultaneous.
- **Plan-level "unchanged" proof** (pre-#1662 `d131e272` vs `0f4bab89`, MCP + Maps + Saved policies):
  - "license renewal", "software subscriptions", "shoe me opportunities", "shoe opportunities", "shoes in Virginia", "Show me USDA opportunities" and "email me opportunities in cyber" are **byte-identical**.
  - Only the three software-license queries and the Virgin Islands typo changed, as intended.

**Finding (not fixed, out of scope):** `src/app/api/app/recompete-map/route.ts:100` returns `totalForFilters ?? 0`.
- Under heavy parallel load, one request returned headline **0** while its pins and unmapped count were correct.
- Three solo requests all return 5,207.
- This is a Bug Prevention Rule #11 site: a failed count renders as zero.

## 2. Population (production, 2026-09-23)

| | |
|---|---|
| saved searches | **108**, all alerting |
| with a typed query | 28 (14 material, 14 not) |
| without a query | 80 |
| alerting on Forecasts (no-query) | 42 |
| with an agency filter | 8 (3 multi-agency) |
| replay errors / unknown counts | **0 / 0** |

**No-query searches (80):**
- **Open:** identical for all 80.
- **Forecast:** meaning Δ = **0 for all 42**. 39 lose only past-fiscal-year rows: 71,334 rows total, at most 19.6% for any one search, 0 increases. Class: **fiscal-year policy**.

## 3. Every query search — classified

Classes: bug correction · approved canonical concept · fiscal-year policy · coverage-state correction · ambiguous.

| search | query | Open old → canonical | Forecast old → canonical (FY Δ, meaning Δ) | class |
|---|---|---|---|---|
| 386e228b | Show me USDA opportunities | 5,500 → 240 | 0 → 5,028 (0, +5,028) | bug correction: sentence-as-substrings → USDA identity |
| 9ca2d2de | Show me DOJ opportunities | 5,500 → 95 | 0 → 619 (0, +619) | bug correction |
| 61d1ca1f | Show me HUD opportunities | 5,501 → 9 | 0 → **0** | Open: bug correction. Forecast: **coverage-state correction REQUIRED** (HUD has no forecast publisher; see §4) |
| b032f39f | Show me SBA opportunities | 5,500 → 0 (no SBA notice in 30 d) | 0 → **0** | Open: bug correction. Forecast: **coverage-state correction REQUIRED** (SBA unresolved) |
| e00435f7 | National Oceanic and Atmospheric Administration | 1,761 → 19 | 3 → **0** (0, −3) | Open: bug correction. Forecast: the 3 old rows were substring noise (a DOI "NOAA NMFS ESA consultation" buy ×2, a DHS "Spectrum Development"), but canonical must say **UNAVAILABLE**, and it currently says 0; **coverage-state correction REQUIRED** |
| 3e2511ad | dry ice | 4,454 → 23 | — | bug correction (`%ice%` ⊂ serv**ice**) |
| 4dcfa6ea | kitchen exhaust | 142 → 10 | — | bug correction (token-OR) |
| e9c0f9be | revenue cycle management | 1,672 → 5 | 2 → 0 (−2, 0) | Open: bug correction. Forecast: fiscal-year policy |
| ff372605 | medical billing | 429 → 28 | 1 → 6 (−1, +6) | bug correction (+ FY policy) |
| 0678583e | Pro Audio | 78 → 0 | 0 → 2 (0, +2) | bug correction (`%pro%`); no audio notice in the 30-day window |
| bf35f82a | telecommunications installations | 399 → 83 | — | bug correction (token-OR → both concepts) |
| c3f908e3 | shoe me opportunities in the Virgin Islands | 5,506 → **3** | 0 → **11** (0, +11) | **approved canonical concept** (#1662 typo contract). Recovers the 3 VI notices, which were 0 under the pre-#1662 canonical layer |
| 994c599e | -computers (NAICS 541511/2/3/9) | 0 → 62 | 0 → 1,575 (0, +1,575) | **approved canonical concept** (Decision #1: saved NAICS = positive scope; migrate) |
| b4e40d05 | fiber optic installation | 12 → 1 | 2 → 5 (0, +3) | **approved canonical concept** (Decision #4: the drops are "fiber optic" rows without installation, accepted as noise) |
| a9eb09ff | software license (NAICS 513210) | 19 → **12** | — | **approved canonical concept** (#1662). Pre-#1662 canonical was 9. Now includes ANSYS, Fortify, Applanix. Legacy-only rows dropped: Predictor Remediation Exam, CMPro Software and Support, TICMS Software Support (audited noise / partial support) |
| 08d970cb | 6114 (profile) | 14 → 14 | 170 → 138 (−32, 0) | fiscal-year policy |
| 741adbff | construction renovation building modernization | 135 → 85 | — | bug correction (capability list: distinctive concepts admit) |
| e4460582 | same query, different filters | 5 → 8 | — | bug correction |
| 03a84411 / 22a140c6 | construction … building repair (capability list) | 28 → 30 | — | bug correction |
| 500931a5 | repair OR HVAC OR electrical OR renovation OR replace OR rehabilitate | 10 → 11 | — | bug correction (explicit alternatives) |
| 1d1ed74e, 2c2261bd, 332eef89, 3d6a0258, 5c81a958, 9fb0009c, a0ab22ba | computer · laptop · small business janitoral · mold · hardware · printer · degreasing | unchanged | — | no change |

**Ambiguous:** none on meaning. The only open items are the coverage-state corrections below.

## 4. Coverage state — a canonical-layer gap (blocks the Forecast half of migration)

Decision #2 requires "unavailable / unknown, not zero", as a generic state with no hardcoding. Measured today:

| saved buyer term | forecast identity resolver | rows we hold | canonical `coverage` today |
|---|---|---|---|
| National Oceanic and Atmospheric Administration / NOAA | **unresolved** | 0 (no DOC/COMMERCE/NOAA code, 0 Commerce office rows) | `ok` → renders **0** |
| COMMERCE | **unresolved** | 0 | `ok` |
| HUD | **unresolved** | 0 | `ok` |
| SBA | **unresolved** | 0 | `ok` |

- `buildDiscoveryPlan` marks coverage `unestablished` only for a *known* identity whose coverage is `none`. An **unresolved** publisher falls through as `ok`.
- MCP's `coming_soon` unavailable branch keys off that flag, so **MCP and Maps report these buyers as a measured 0 in production today.**
- The MCP provenance string already promises "unresolved publisher → unavailable, not zero". The code does not do it.
- **Affected saved searches:**
  - e00435f7 (NOAA)
  - 61d1ca1f (HUD)
  - b032f39f (SBA)
  - the three multi-agency lists that include COMMERCE (a5f952c7, f465fbd8, fa66531f). Here Commerce contributes a silent 0 inside a partly covered result.

**Proposed (not started):** a Discovery fix of the same shape as #1662.
- An unresolved publisher → `unestablished`.
- A multi-agency list with some unresolved publishers → a `partial` state that names them.
- Applied in the canonical layer, so MCP, Maps and Saved Searches inherit it together.
- Replayed and gated like #1662.
- The saved-search adapter would then only carry the state through; it must never infer it.

## 5. Saved multi-agency filters

| search | agency filter | q | Open old → canonical | Forecast old → canonical (FY Δ, meaning Δ) |
|---|---|---|---|---|
| a5f952c7 | 15 departments incl. COMMERCE | — | 93 → 93 | 4,161 → 3,586 (−575, **0**) |
| f465fbd8 | 15 departments incl. DEFENSE, COMMERCE | — | 0 → 0 | n/a (not forecast-alerting) |
| fa66531f | 14 departments incl. COMMERCE | — | 0 → 0 | n/a |
| e2466850 | DEFENSE | — | 7,719 → 7,719 | 11,789 → 11,389 (−400, **0**) |
| 03ce338a / 84037b20 / e3d7b713 | VETERANS AFFAIRS | — | 419 / 412 / 412, unchanged | n/a |
| 6e376442 | DEFENSE | — | 77 → 77 | n/a |

- Identity parity holds: multi-select = distinct ORed buyers, with meaning Δ 0 everywhere.
- f465fbd8 / fa66531f are 0 under both old and canonical. That is pre-existing (their other saved filters), not a migration effect.
- "STATE, DEPARTMENT" resolves STATE and leaves the word "DEPARTMENT" unresolved. This is harmless (STATE resolved), and is noted as a parsing artifact of the comma in the saved label.

## 6. Recompete column (informational)

Recompete is not alerted. The script's "old" side is a pre-C2 measurement copy, and Maps Recompete is already canonical in production. So no recompete delta here is a saved-search migration effect.

## Gate to start Saved Search migration

1. All meaning deltas are bug corrections, approved canonical concepts, or FY policy. None are ambiguous.
2. **Open item:** the coverage-state correction (§4) is a canonical-layer change. It should land and be accepted first, or the migration should explicitly render Forecast as unavailable for unresolved publishers only after that state exists.
