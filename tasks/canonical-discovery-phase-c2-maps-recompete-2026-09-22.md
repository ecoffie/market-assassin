# Canonical Discovery — Phase C2: Maps Recompete on the seam (2026-09-22)

**Scope:** Maps **Recompete** horizon only (`/api/app/recompete-map`). Maps Open (frozen, accepted on `b3e37cf0`),
Maps Forecast, saved searches, alert crons and client behaviour are untouched. MCP is the reference.
Previous: `tasks/canonical-discovery-phase-c-maps-open-2026-09-22.md`.

## 1. Old path (@ `a647860c`) vs canonical MCP Recompete

request → `applyFilters` inline in the route (market count, unmapped count, viewport pins, follow-ons):

| concern | old Maps Recompete | canonical (MCP) |
|---|---|---|
| free text | term-of-art NAICS list, else whole-phrase `%q%` ILIKE on incumbent / NAICS-desc / agency | industry preset → term of art → whole-word concept matcher over incumbent / NAICS-desc / agency / sub-agency |
| q + explicit NAICS | **q silently ignored** when `naics` was set | ANDed |
| agency | `%needle%` ILIKE on `awarding_agency` only | whole-word identity on agency ∪ sub-agency; multi-select = OR |
| set-aside typed in q | `setAsideOrExpr` | same (`setAsideOrExpr`) |
| NAICS / PSC | naicsMatchConds; PSC crosswalk only when it was the whole query | naicsMatchConds; PSC crosswalk always |
| state | query ignored "in Virginia"; param only | param ∪ state named in the query |
| exclusions | none | canonical, positive-scope rule |
| window | not expired; **no upper bound**; `?includePast=1` opt-in | not expired; **18 months** (policy) |
| `leadMax` | a raw lte bound | the policy window (like MCP `timeframe.recompete_months`) |

Measured before editing: **no caller sends `includePast`**, the table held **0** expired rows, and **45** of 141,468 live rows end
beyond 18 months — the window is policy, not a market change, at corpus level.

## 2. What changed

- **`src/lib/recompete/maps-recompete-discovery.ts`** (new): `mapsRecompeteRequest(get)` → one canonical plan
  (`MAPS_POLICY`, `leadMax` → window); `applyMapsRecompeteFilters(q, req, mapped)` = `applyRecompetePlan` + the surface
  filters that can only NARROW (set-aside checkbox, sub-agency, value, SAP contract type, likelihood) + the `map_lat` bound
  (`only` / `none` / `any`). All four route reads use ONE request plan.
- **Route:** the inline interpretation is gone; response gains an additive `discovery: {version, status, refinement, via, window_months}`.
  Ordering, pin cap, follow-on merge and the map-truth disclosure are unchanged.
- **`?includePast` retired** (canonical policy is "not expired"; no caller).
- **Positive scope (rule B) on this horizon:** set-aside checkbox, sub-agency, SAP (contract-type) control. Value, likelihood
  and lead time never qualify.
- **Nothing shared changed.** `plan.ts` is untouched in this PR; no shared legacy helper was modified.

## 3. Replay — old Maps vs canonical Maps vs MCP (full market, then mappable)

`npx tsx --env-file=.env.local scripts/discovery-replay.ts --maps-recompete` — complete identity sets (cap 160k, never
truncated). **Exits 1** on any unclassified change, any `unexpected_regression`, any query error, or any identity mismatch
between Maps' full market and MCP's canonical set.

| fixture | status · via | full old → new | MCP canonical | Maps≡MCP identities | old-only | new-only | mappable old → new | class | evidence |
|---|---|---|---|---|---|---|---|---|---|
| janitorial | ok · industry_preset | 25 → 5,304 | 5,304 | IDENTICAL | 1 | 5,280 | 20 → 3,875 | canonical_correction | Canonical industry preset NAICS 561210 3,057 · 561720 1,375 · 561730 872 = 5,304 (≡ MCP). Same codes with NO 18-mo cap = 5,304, so the window drops 0 here. Old = incumbent-name/NAICS-desc keyword (25); 24 ⊂ new; 1 dropped = "CW JANITORIAL SERVICE" under 812320 (outside the preset codes). |
| cybersecurity | ok · industry_preset | 7 → 15,639 | 15,639 | IDENTICAL | 0 | 15,632 | 5 → 11,156 | canonical_correction | Canonical cyber capability (direct + related IT taxonomy) → 15,639 ≡ MCP. Old = keyword on incumbent/NAICS-desc (7). 0 dropped. |
| cyber | ok · industry_preset | 154 → 15,639 | 15,639 | IDENTICAL | 22 | 15,507 | 126 → 11,156 | canonical_correction | cyber ≡ cybersecurity (15,639 ≡ MCP). 22 dropped = incumbent names containing the substring (CYBERSTAR, CYBERIA, CYBERVANCE). |
| SIEM | ok · industry_preset | 510 → 15,639 | 15,639 | IDENTICAL | 467 | 15,596 | 437 → 11,156 | canonical_correction | Old %siem% = SIEMENS INDUSTRY substring (467 dropped). Canonical reads SIEM as the cyber capability → the MCP cyber market (15,639). |
| ai governance | ok · text | 0 → 0 | 0 | IDENTICAL | 0 | 0 | 0 → 0 | unchanged |  |
| artificial intelligence governance | ok · text | 0 → 0 | 0 | IDENTICAL | 0 | 0 | 0 → 0 | unchanged |  |
| veterans affairs | ok · structured_only | 16,257 → 16,257 | 16,257 | IDENTICAL | 0 | 0 | 12,972 → 12,972 | unchanged |  |
| Show me USDA opportunities | ok · structured_only | 0 → 4,596 | 4,596 | IDENTICAL | 0 | 4,596 | 0 → 3,408 | canonical_correction | Structured agency intent → 4,596 USDA contracts ≡ MCP. Old keyword ILIKE on the whole sentence found 0. |
| Naval facilities in Nevada | ok · text | 0 → 0 | 0 | IDENTICAL | 0 | 0 | 0 → 0 | unchanged |  |
| 541512 | ok · structured_only | 4,254 → 4,254 | 4,254 | IDENTICAL | 0 | 0 | 3,516 → 3,516 | unchanged |  |
| 5413 | ok · structured_only | 7,085 → 7,085 | 7,085 | IDENTICAL | 0 | 0 | 4,956 → 4,956 | unchanged |  |
| drones | ok · term_of_art | 5,545 → 5,545 | 5,545 | IDENTICAL | 0 | 0 | 4,202 → 4,202 | unchanged |  |
| pam | ok · text | 5 → 0 | 0 | IDENTICAL | 5 | 0 | 5 → 0 | canonical_correction | Old %pam% substring (PAMELA, PAMUNKEY) — 5 dropped, none mean PAM. Canonical word-bounded → 0 ≡ MCP. |
| market research | ok · text | 0 → 4 | 4 | IDENTICAL | 0 | 4 | 0 → 4 | canonical_correction | Old whole-phrase ILIKE found 0; canonical both-qualifier match → 4 ("Marketing Research") ≡ MCP. |
| management | ok · text | 1,925 → 4,493 | 4,493 | IDENTICAL | 1 | 2,569 | 1,495 → 3,383 | canonical_correction | ≡ MCP (4,493). Old ILIKE on incumbent/NAICS-desc/agency = 1,925; +2,569 matched ONLY via awarding_sub_agency names (Bureau of Land Management, DCMA) — canonical RECOMPETE_TEXT_COLS include buyer names. Recorded as a shared-layer limitation, not changed here. |
| 8a | ok · structured_only | 3,810 → 3,810 | 3,810 | IDENTICAL | 0 | 0 | 3,744 → 3,744 | unchanged |  |
| -computers | needs_positive_scope · needs_positive_scope | 0 → 0 | 0 | IDENTICAL | 0 | 0 | 0 → 0 | unchanged |  |
| 541512 -computers | ok · structured_only | 0 → 4,246 | 4,246 | IDENTICAL | 0 | 4,246 | 0 → 3,508 | canonical_correction | Old keyword-ILIKE on the literal text → 0. Now NAICS 541512 minus computers → 4,246 ≡ MCP. |
| USDA -computers | ok · structured_only | 0 → 4,581 | 4,581 | IDENTICAL | 0 | 4,581 | 0 → 3,398 | canonical_correction | Old literal text → 0. Now USDA buyers minus computers → 4,581 ≡ MCP. |
| zzzxxyyqqq | ok · text | 0 → 0 | 0 | IDENTICAL | 0 | 0 | 0 → 0 | unchanged |  |
| cyber cloud compliance network server | ok · industry_preset | 0 → 15,639 | 15,639 | IDENTICAL | 0 | 15,639 | 0 → 11,156 | canonical_correction | Old whole-phrase ILIKE → 0. Capability list → cyber market 15,639 ≡ MCP. |
| janitorial or landscaping | ok · industry_preset | 0 → 5,304 | 5,304 | IDENTICAL | 0 | 5,304 | 0 → 3,875 | canonical_correction | Old whole-phrase ILIKE → 0. "or" = alternatives; both map to the same preset → 5,304 ≡ MCP. |
| SDVOSB cybersecurity opportunities in Virginia | ok · industry_preset | 3,485 → 145 | 145 | IDENTICAL | 3,340 | 0 | 3,457 → 144 | canonical_correction | Old resolved the WHOLE query as a set-aside (3,485). Now SDVOSB ∧ cyber ∧ VA → 145 ≡ MCP (Phase B: 145). |
| agency=USDA | ok · structured_only | 0 → 4,596 | 4,596 | IDENTICAL | 0 | 4,596 | 0 → 3,408 | canonical_correction | Old %USDA% literal on awarding_agency → 0. USDA identity → 4,596 ≡ MCP. |
| agency=VA | ok · structured_only | 1 → 16,257 | 16,257 | IDENTICAL | 1 | 16,257 | 0 → 12,972 | canonical_correction | Old %VA% substring hit 1 row (OPIC "…INVESTMENT…"). VA identity → 16,257 ≡ MCP. |
| janitorial + agency=USDA | ok · industry_preset | 0 → 172 | 172 | IDENTICAL | 0 | 172 | 0 → 154 | canonical_correction | Old: keyword ∧ literal USDA → 0. Now preset ∧ USDA → 172 ≡ MCP (Phase B: 172). |
| janitorial + agency=VA | ok · industry_preset | 0 → 709 | 709 | IDENTICAL | 0 | 709 | 0 → 610 | canonical_correction | Old → 0. Now preset ∧ VA identity → 709 ≡ MCP. |
| agency=AGRICULTURE\|VETERANS AFFAIRS | ok · structured_only | 20,857 → 20,853 | 20,853 | IDENTICAL | 4 | 0 | 16,384 → 16,380 | expected_surface_policy | Multi-agency OR: 20,853 = USDA 4,596 + VA 16,257 ≡ MCP. 4 dropped = PoP end 2028-07 → 2030-12, outside the canonical 18-month window (old route had no upper bound). All 4 also carry a corrupted naics_code "[object Object]" — data defect, recorded. |
| janitorial + agency=AGRICULTURE\|VETERANS AFFAIRS | ok · industry_preset | 5 → 881 | 881 | IDENTICAL | 0 | 876 | 4 → 764 | canonical_correction | Multi-agency OR: 881 = 172 + 709 ≡ MCP. Old: keyword ∧ agency substring → 5, all ⊂ new. |
| naics=541512 | ok · structured_only | 4,254 → 4,254 | 4,254 | IDENTICAL | 0 | 0 | 3,516 → 3,516 | unchanged |  |
| janitorial + naics=561720 | ok · industry_preset | 1,375 → 1,375 | 1,375 | IDENTICAL | 0 | 0 | 1,066 → 1,066 | unchanged |  |
| IT services + state=VA | ok · industry_preset | 23 → 4,077 | 4,077 | IDENTICAL | 4 | 4,058 | 8 → 2,912 | canonical_correction | Old keyword "IT services" on incumbent names (4 dropped: "BY LIGHT PROFESSIONAL IT SERVICES" in 517110/333318…). Canonical IT capability ∧ VA → 4,077 ≡ MCP. |
| janitorial + leadMax=6 | ok · industry_preset | 6 → 2,911 | 5,304 | n/a (surface filter) | 0 | 2,905 | 6 → 2,257 | expected_surface_policy | leadMax is timing POLICY: preset NAICS in a 6-month window → 2,911 (old keyword 6, all ⊂ new). |
| -computers + setAside=SDVOSB | ok · structured_only | 0 → 3,484 | 0 | n/a (surface filter) | 0 | 3,484 | 0 → 3,456 | expected_surface_policy | Rule B: the set-aside checkbox is a Maps positive scope → SDVOSB minus computers 3,484 (old 0; the 1 dropped vs setAside=SDVOSB alone carries "computers"). |
| -computers + subAgency=Forest Service | ok · structured_only | 0 → 2,456 | 0 | n/a (surface filter) | 0 | 2,456 | 0 → 1,970 | expected_surface_policy | Rule B: sub-agency is a Maps positive scope → Forest Service minus computers 2,456 (old 0). |
| -computers + minValue=1000000 + likelihood=high | needs_positive_scope · needs_positive_scope | 0 → 0 | 0 | n/a (surface filter) | 0 | 0 | 0 → 0 | unchanged |  |
| setAside=SDVOSB | ok · structured_only | 3,485 → 3,485 | 141,423 | n/a (surface filter) | 0 | 0 | 3,457 → 3,457 | unchanged |  |
| setAside=SB (checkbox vocabulary defect, unchanged) | ok · structured_only | 0 → 0 | 141,423 | n/a (surface filter) | 0 | 0 | 0 → 0 | unchanged |  |

38 fixtures · 19 canonical_correction · 15 unchanged · 4 expected_surface_policy · identity parity failures 0

**Identity parity:** every fixture without a Maps surface filter — **32 of 38** — returns the **identical contract_id set** as MCP.
The 6 exempt fixtures carry a surface filter (lead time, set-aside checkbox ×3, sub-agency, value/likelihood) that narrows by design.
(Corrected: the PR's original commit message said "33/33"; the replay's own count is 32 identical + 6 exempt.)

**janitorial (Maps 25 → canonical 5,304):** the new set is exactly the canonical preset — 561210: 3,057 · 561720: 1,375 ·
561730: 872 = 5,304 — every PoP end between today and 2028-03-18. The same codes with **no** 18-month cap also give 5,304, so the
increase is entirely the canonical janitorial NAICS market; the window removes nothing here. Of the old 25 keyword hits, 24 are
inside it; the 1 dropped is "CW JANITORIAL SERVICE LLC" under NAICS 812320, outside the preset codes.

**Multi-agency OR (live):** `AGRICULTURE|VETERANS AFFAIRS` = 20,853 = USDA 4,596 + VA 16,257; with janitorial 881 = 172 + 709.

## 4. Presentation deltas (Maps only NARROWS the market)

The market above is what MCP counts. The map then draws only rows with coordinates (`map_lat`), inside the viewport, up to
1,000 pins ordered by PoP end (+ any follow-ons the cap would bury, merged by contract_id). No listing dedupe on this horizon.
The not-drawable remainder is reported as `unmappedForFilters`.

| fixture | market (≡ MCP) | mappable | not drawable | % drawable |
|---|---|---|---|---|
| janitorial | 5,304 | 3,875 | 1,429 | 73% |
| cybersecurity / SIEM | 15,639 | 11,156 | 4,483 | 71% |
| 541512 | 4,254 | 3,516 | 738 | 83% |
| agency=USDA | 4,596 | 3,408 | 1,188 | 74% |
| agency=VA | 16,257 | 12,972 | 3,285 | 80% |
| AGRICULTURE\|VETERANS AFFAIRS | 20,853 | 16,380 | 4,473 | 79% |
| USDA -computers | 4,581 | 3,398 | 1,183 | 74% |

## 5. Gates

- `cross-surface-plan.unit.test.ts`: `maps_recompete` → **migrated** with the production `mapsRecompeteRequest`. `meaning()`
  now also compares Recompete query ops + NAICS (excluding only the policy window bound), which strengthens the check for
  Maps Open too (still green). Source guard: the route may not reference `termOfArtNaicsCodes`, `resolveQueryIntent`,
  `setAsideOrExpr`, `pscToNaicsCodes`, `agencyOrExpr`, `multiAgency`, `naicsMatchConds`, `parseStateList`, an
  `incumbent_name.ilike` keyword or the old `todayYmd` bound; ONE plan; all four reads through it; the adapter delegates
  to `applyRecompetePlan`.
- **Proven:** adapter passing `agency: null` → red (`maps_recompete: janitorial` ≠ MCP); route re-importing
  `termOfArtNaicsCodes` as a NAICS fallback → red (source guard). Both restored → green. Never committed.
- `maps-recompete-discovery.unit.test.ts` (18): MCP op-equality, janitorial preset + window, identity/OR agency, q∧NAICS,
  includePast retired, leadMax = policy only, positive scope, fail-closed, surface filters, set-aside checkbox never reaches the
  plan, mapped split.
- Five existing Maps source tests repointed to where each invariant now lives (route + adapter / canonical plan), none weakened.

## 6. Findings recorded — NOT changed here

1. **Buyer names match work words (shared layer).** Canonical `RECOMPETE_TEXT_COLS` include `awarding_agency` /
   `awarding_sub_agency`, so `management` gains **2,569** contracts matched ONLY by the sub-agency name ("Bureau of Land
   Management", "Defense Contract Management Agency"). MCP does the same. Same class as the frozen incumbent rule "the buyer's
   name is not the work". Needs a decision; changing it changes MCP.
2. **SIEM → the whole cyber market (15,639).** Canonical capability mapping, MCP-identical; very broad for a product term.
3. **Set-aside CHECKBOX vocabulary defect (pre-existing, unchanged).** Maps sends group keys (`SB`/`8A`/`HZ`), stored values
   are `SB-Total`/`8(a)`/`HUBZone`; the `.eq` matches only `SDVOSB`/`WOSB`. `setAside=SB` returns 0. The plan's explicit
   set-aside path is a raw ILIKE (`SB` would match SDVOSB/WOSB), so the checkbox was deliberately kept as a surface filter. The
   canonical `sb` text patterns also miss `SB-Total`. `set_aside_type` is only ~30% populated.
4. **Data:** 4 USDA rows carry `naics_code = "[object Object]"` (a serialization bug in an ingest).
5. Name hits outside the preset codes are not admitted (`CW JANITORIAL SERVICE` / 812320) — canonical by design.
6. Pre-existing `totalForFilters ?? 0` in the route (baselined debt, untouched).

## 7. Next (not started)
Maps Forecast → rerun `scripts/discovery-saved-search-blast.ts` (sign-off on changed rows) → saved searches.

## 8. Reconciled with main (merge `a66868e5`, no rebase)

`main` advanced 6 commits after this branch was cut (`a647860c` → `d56abe3f`): #1646 company-anchored FIND and #1648
region + acquisition-stage intent. **No textual conflicts** (`git merge-tree` clean; only `CLAUDE.md` overlapped and
auto-merged). The Recompete product diff (all 12 non-CLAUDE files) is **byte-identical** before and after the merge
(same patch SHA-1 `9a3deaa4…`), and the Maps Open files have 0 lines of diff vs main and vs production-proven `b3e37cf0`.

**But #1648 changed the SHARED canonical layer:** `RECOMPETE_TEXT_COLS` now also searches the buy-side `description`
(96% filled) and `psc_description` (99.7%). Maps inherits that through the plan exactly as MCP does — identity parity stays
**32/32 IDENTICAL** (6 surface-filter fixtures exempt). Counts that moved (MCP moved identically):

| fixture | before merge | after merge |
|---|---|---|
| ai governance / artificial intelligence governance | 0 | 5 (all genuine AI-governance contracts; newly classified canonical_correction) |
| pam | 0 | 18 |
| market research | 4 | 160 |
| management | 4,493 | 15,604 |
| 541512 -computers | 4,246 | 4,223 (description text now also carries the excluded word) |
| USDA -computers | 4,581 | 4,578 |
| -computers + SDVOSB / Forest Service (surface) | 3,484 / 2,456 | 3,478 / 2,454 |

Everything else — janitorial 5,304, cyber 15,639, USDA 4,596, VA 16,257, multi-agency 20,853 / 881 — is unchanged.

## 9. Production acceptance (2026-09-23) — ✅ FROZEN

Merged via GitHub at accepted head `858c36d5` → merge commit **`566c1fe9`** (normal main deploy, no manual deploy).
Production proven to serve it: the live `maps-account-build` stamp read `566c1fe96a6bcf5a599c2e9146b65912bc331b64`, with the
Vercel commit status complete.

Method: the live `https://getmindy.ai/api/app/recompete-map` (whole-world bbox) vs MCP's canonical recompete market —
the production library query `applyRecompetePlan(buildDiscoveryPlan(…, MCP_POLICY))` run against the production DB at the
same moment (no hosted MCP credits). Normalized on `contract_id`. Absolute counts are today's corpus (hourly sync).

| fixture | live discovery | live drawable + unmapped = market | MCP canonical market | count | live pins | pins ⊂ MCP |
|---|---|---|---|---|---|---|
| janitorial | ok · industry_preset · 18mo | 3,875 + 1,429 = 5,304 | 5,304 | EXACT | 1,000 (capped) | yes |
| cybersecurity | ok · industry_preset · 18mo | 11,157 + 4,505 = 15,662 | 15,662 | EXACT | 1,000 (capped) | yes |
| SIEM | ok · industry_preset · 18mo | 11,157 + 4,505 = 15,662 | 15,662 | EXACT | 1,000 (capped) | yes |
| ai governance | ok · text · 18mo | 3 + 2 = 5 | 5 | EXACT | 3 | IDENTICAL |
| agency=USDA | ok · structured_only · 18mo | 3,408 + 1,195 = 4,603 | 4,603 | EXACT | 1,014 (cap + follow-ons) | yes |
| agency=VA | ok · structured_only · 18mo | 12,972 + 3,302 = 16,274 | 16,274 | EXACT | 1,031 | yes |
| agency=USDA\|VA | ok · structured_only · 18mo | 16,380 + 4,497 = 20,877 | 20,877 (= 4,603 + 16,274) | EXACT | 1,045 | yes |
| 541512 -computers | ok · structured_only · 18mo | 3,489 + 754 = 4,243 | 4,243 | EXACT | 1,000 (capped) | yes |
| -computers (naked) | needs_positive_scope | 0 + 0 = 0 | 0 | EXACT | 0 | IDENTICAL |
| zzzxxyyqqq | ok · text | 0 + 0 = 0 | 0 | EXACT | 0 | IDENTICAL |

**Full identity for the capped markets, through the live API:** the viewport was tiled (a capped tile is quartered until
every tile is uncapped) and the union of live pin ids compared with MCP's full drawable set:
janitorial 3,875 · cybersecurity 11,157 · SIEM 11,157 · USDA 3,408 · VA 12,972 · USDA|VA 16,380 · 541512 -computers 3,489 —
**all IDENTICAL**, 0 live-only / 0 MCP-only (379 live calls).

Separately verified:
- **Market vs drawable stays disclosed:** every response carries `totalForFilters` (drawable) + `unmappedForFilters`,
  and together they equal the MCP market exactly.
- **The 1,000-pin cap is presentation-only:** capped responses report `capped=true` while `totalForFilters` keeps the full
  drawable count; the extra pins above 1,000 are the follow-on merge.
- **Maps Open unchanged:** 0 lines of diff in its files between production-proven `b3e37cf0` and `566c1fe9`; live Open still
  returns its `discovery` block.
- **Forecast unmigrated:** live `/api/app/forecast-map` returns no `discovery` block; gate registry `maps_forecast: pending`.
- **Saved searches / alerts unmigrated:** #1649 touched no forecast-map, map-filters, saved-search or alert file; gate
  registry `saved_searches` / `daily_alerts: pending`.

Kept separate (not part of this freeze): the pre-existing set-aside checkbox vocabulary defect (§6.3).

**Maps Recompete is frozen.** Reopen only for a production defect that breaks MCP parity. Next: Maps Forecast.
