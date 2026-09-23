# Saved Search blast radius — canonical discovery (2026-09-23) — FOR SIGN-OFF, NOT MIGRATED

**Status:** report only. No saved search, alert cron or client code has been changed. Saved searches remain `pending`
in the cross-surface gate. Run after all three Maps horizons were production-accepted (Open `b3e37cf0`, Recompete
`566c1fe9`, Forecast `d131e272`).

`npx tsx --env-file=.env.local scripts/discovery-saved-search-blast.ts --all` — READ-ONLY against production
(nothing written, no email). Replays EVERY alerting saved search: **old** = exactly what `cron/saved-search-alerts`
runs today (`parseMapFilters(saved)` + postedDays 30 + profile scope; Forecast via `applyForecastFilters`); **canonical**
= the saved NON-query filters + the canonical plan (SAVED_SEARCH_POLICY: Open posted ≤30 days, Forecast current + future FY).

**Measurement fix in this PR:** the script passed a saved multi-agency value (`A|B`) to the plan as ONE buyer. The
canonical layer (Phase C) treats a multi-select as distinct buyers, ORed — the script now splits it exactly as the Maps
adapters do. Without this, the 3 multi-agency searches would have shown false drops.

## Population (production, 2026-09-23)

| | |
|---|---|
| saved searches | **108** — all alerting (104 daily, 4 weekly) |
| with a typed query (`q`) | 28 |
| without a query | 80 |
| alerting on Forecasts | 54 |
| profile scope | 6 |
| with an agency filter | 8 (3 multi-agency) |
| replay errors / unknown counts | **0 / 0** |

## Result

| group | searches | Open changed | Forecast changed | material |
|---|---|---|---|---|
| no query | 80 | **0** | 39 of 42 forecast-alerting (FY policy only) | **0** |
| query, not material | 12 | small (e.g. 28→30, 137→85) | — | 0 |
| query, **material** | **16** | see below | see below | 16 |

**No-query searches (80):** Open results are IDENTICAL for all 80 (their non-query filters are untouched by the
migration). Forecast: 39 of 42 forecast-alerting searches lose only past-fiscal-year rows — **71,334 rows removed in
total, max 19.6% for any one search, 0 increases**. That is the decided current + future FY default (Eric, 2026-09-22),
classified **expected policy change**.

## The 16 material searches — classified

Material = old or new is 0 (and they differ), or |Δ| ≥ 5 and ≥ 50%. Users are masked (sha256 prefix). "Recompete
map" is informational only: recompete is NOT alerted, the script's old side is a pre-C2 measurement copy, and Maps
Recompete is already canonical in production — no recompete delta here is caused by a saved-search migration.

| # | search | query | Open old → canonical | Forecast old → canonical | class | evidence |
|---|---|---|---|---|---|---|
| 1 | 386e228b | Show me USDA opportunities | 5,586 → 244 | 0 → 5,028 | canonical correction | old searched the sentence as substrings (`%me%`); now USDA buyer identity |
| 2 | 61d1ca1f | Show me HUD opportunities | 5,587 → 9 | 0 → 0 | canonical correction | same class; HUD identity |
| 3 | 9ca2d2de | Show me DOJ opportunities | 5,586 → 97 | 0 → 619 | canonical correction | same class; DOJ identity |
| 4 | b032f39f | Show me SBA opportunities | 5,586 → **0** | 0 → 0 | canonical correction | SBA identity; no SBA notice posted in 30 days → the alert becomes empty (true) |
| 5 | 3e2511ad | dry ice | 4,515 → 26 | — | canonical correction | old `%ice%` matched serv**ice** / pr**ice** |
| 6 | 4dcfa6ea | kitchen exhaust | 142 → 10 | — | canonical correction | old token-OR (any exhaust / any kitchen) |
| 7 | e9c0f9be | revenue cycle management | 1,700 → 5 | 2 → 0 | canonical correction | old token-OR on "management" |
| 8 | ff372605 | medical billing | 443 → 28 | 1 → 6 | canonical correction | old token-OR on "medical" |
| 9 | 0678583e | Pro Audio | 83 → **0** | 0 → 2 | canonical correction | old `%pro%` substring; no audio notice in this search's 30-day window |
| 10 | bf35f82a | telecommunications installations | 409 → 87 | — | canonical correction | old token-OR; now both concepts |
| 11 | a9eb09ff | software license (NAICS 513210) | 20 → 10 | — | intentional (ALL concepts) | "software" alone no longer admits — e.g. "CMPro Software and Support" dropped |
| 12 | e00435f7 | National Oceanic and Atmospheric Administration | 1,781 → 19 | 3 → **0** | canonical correction + **⚠ decision** | Open: NOAA buyer identity. Forecast: we hold **0** NOAA forecasts (publisher coverage *unestablished* — MCP reports that horizon UNAVAILABLE). The alert must not present that as "0 upcoming". |
| 13 | b4e40d05 | fiber optic installation (+ strategy: repeat_buyer, sb_friendly, sources_sought) | 12 → **1** | 2 → 5 | intentional + **⚠ review** | canonical requires fiber ∧ optic ∧ installation; 11 active 30-day notices say "fiber optic" (before strategy filters) — those without "installation" are dropped |
| 14 | c3f908e3 | shoe me opportunities in the Virgin Islands | 5,592 → **0** | 0 → 0 | canonical correction + **⚠ decision** | typo: "shoe" becomes a required concept ∧ state VI → 0, while **3** VI notices exist. Old 5,592 was substring noise. Known typo limitation. |
| 15 | 994c599e | -computers (NAICS 541511/2/3/9) | **0 → 67** | **0 → 1,574** | expected (rule B) + **⚠ decision** | the saved NAICS is positive scope, so the exclusion is now valid: the user's IT market minus computers. Today this search matches NOTHING (literal "-computers"); after migration the user starts receiving alerts. |
| 16 | 08d970cb | 6114 (profile) | 14 → 14 | 170 → 138 | expected policy change | Open unchanged; Forecast −32 = past FY only. Flagged material only on the informational recompete-map column. |

## Decisions needed before migration

1. **#15 `-computers` over IT NAICS — alerts turn on.** Correct under the approved positive-scope rule, but a user who
   has received nothing starts receiving IT alerts (67 open notices / 1,574 forecast rows in scope today). Options:
   migrate as-is, or notify/hold this one search.
2. **#12 NOAA Forecast — unavailable ≠ 0.** The saved-search adapter must carry `coverage: 'unestablished'` through to
   the alert (omit/label the Forecast section) rather than render "0 upcoming".
3. **#14 typo query → 0.** Keep canonical behavior (fail to 0, honest) or ask the user to edit the search? No fuzzy
   matching is proposed (a shared-layer change).
4. **#13 / #11 ALL-concepts on generic words** ("installation", "license"). Same behavior as MCP and all three Maps
   horizons; confirm acceptable for saved searches or record as a shared-layer follow-up.

Everything else (1–10, 16 and all 80 no-query searches) is a canonical correction or the decided FY policy.

## Modeling caveats (recorded)
- The canonical side models the future saved-search adapter as the Maps Open composition (non-query filters via
  `applyMapFilters` + the plan) with SAVED_SEARCH_POLICY. Profile scope: applied only when the search has no query —
  Maps Open additionally keeps profile scope for an exclusion-only query; 0 of the 6 profile searches is exclusion-only.
- The "recompete map" column uses a pre-C2 measurement copy and is not alerted.
