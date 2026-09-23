# Canonical Discovery — Phase C: Maps Open on the seam (2026-09-22)

**Scope:** Maps **Open** horizon only (`/api/app/opportunity-map`). Maps Recompete, Maps Forecast, saved
searches, alerts and client behaviour are untouched. Phase B record: `tasks/canonical-discovery-phase-b-2026-09-22.md`.

## 1. Old path (read-only diagnosis, @ `15eef4c9`)

The route sent every query through the shared `parseMapFilters` → `applyMapFilters` at three call sites
(headline count, unmapped count, viewport pins). Interpretation lived in `map-filters.ts`:

| concern | old behaviour |
|---|---|
| keywords / concepts | `resolveQueryIntent` → `buildSearchOr`: split on space/comma, OR every token, `%token%` ILIKE over 5 columns + term-of-art synonyms |
| agency | pipe multi-select → `agencyOrExpr` substring ILIKE on department/sub_tier, no alias resolution (`VA` ⊂ conser**va**tion, `USDA` literal → 3 rows) |
| NAICS / PSC / set-aside typed in q | `resolveQueryIntent` only when the WHOLE query was one code/term |
| locations | only the `state` param; "in Nevada" never extracted |
| commas / "or" | comma = token separator; "or" = stop word |
| exclusions | none |
| acronyms | substring: `IT` 5,464 · `AI` 5,290 of ~11k active |
| cyber | cyber 422 · cybersecurity 344 · cyber security 1,638 |
| industry codes | none (janitorial = 32 text hits) |

## 2. What changed

- **`src/lib/opportunities/maps-open-discovery.ts`** (new, production): `mapsOpenRequest(get, profile)` → one
  canonical plan under `MAPS_POLICY`; `applyMapsOpenFilters(query, req)` = `applyMapFilters` with the plan-owned
  keys (`search`, `agency`) **blanked** and `state`/`psc` taken from the plan (so query-named states/PSC apply),
  then the plan's Open ops. All three Open paths call it through ONE `mapsOpenRequest` per request.
- **Route:** the three call sites use the adapter; response gains an additive `discovery: {version, status, refinement, via}`.
  Pins, dedupe, the 1,000-pin cap, deadline ordering, map-truth counts, DLA and SBIR are unchanged.
- **`applyMapFilters` is byte-identical** — saved searches, both alert crons, market dashboard and CAI still use it.
- **Shared layer (approved A):** `DiscoveryInput.agency` accepts `string | string[]`; each buyer resolves
  independently, buyers are ORed. A string takes the pre-array path — `golden-plans.json` unchanged, and a
  one-element list plans byte-identically to the string for every agency fixture (test).
- **Positive-scope rule (approved B):** Maps-only scopes = set-aside, Full & Open, strategy, sub-agency, SAP buyer,
  profile scope. Notice type, posted/closing windows, docs, contact, country, hide-commodity never qualify.
- **Profile scope:** suppressed only when the query itself names a market (the pre-migration "explicit search escapes
  profile" rule). An exclusion-only query that is valid *because of* the profile keeps it — dropping it would broaden
  "profile − computers" into "whole market − computers".

## 3. Old Maps Open vs canonical Maps Open — full replay

`npx tsx --env-file=.env.local scripts/discovery-replay.ts --maps-open` — old = `applyMapFilters(q, agency)` exactly as
the route ran it; new = the production adapter. Full active corpus and the mappable subset (`map_lat` not null).
Classifications live in `scripts/discovery-replay-maps-open.ts`; the replay **exits 1** on any material change without
one. 40 baseline fixtures + 6 multi-agency / positive-scope fixtures.

| fixture | status | all old→new | ∩ | old-only | new-only | mappable old→new | class | evidence |
|---|---|---|---|---|---|---|---|---|
| ai governance | ok | 5,296 → 11 | 11 | 5,285 | 0 | 4,926 → 11 | canonical_correction | Old %ai% substring (m-AI-ntenance, rep-AI-r) → ~5.3k. Canonical AI ∧ governance, word-bounded → 11 (all ⊂ old). 0 dropped rows match canonical text. |
| artificial intelligence governance | ok | 161 → 11 | 11 | 150 | 0 | 153 → 11 | canonical_correction | Old token-OR on intelligence/governance boilerplate. Now identical to "ai governance" (11). |
| "ai governance" | ok | 2 → 2 | 0 | 2 | 2 | 2 → 2 | canonical_correction | Old treated quotes as characters (Blast Shield, HVAC). Now an exact phrase: 2 notices that contain it. |
| janitorial | ok | 32 → 134 | 32 | 0 | 102 | 29 → 96 | canonical_correction | MCP parity: canonical industry preset NAICS 561720/561730/561210 added (102 new, all those codes). 0 old rows dropped. 561210 breadth recorded as a limitation. |
| Naval facilities in Nevada | ok | 1,334 → 0 | 0 | 1,334 | 0 | 1,269 → 0 | canonical_correction | Old token-OR 1.3k. State NV extracted; naval ∧ facilities in NV = true empty (same as MCP Phase B). |
| veterans affairs | ok | 805 → 459 | 459 | 346 | 0 | 692 → 349 | canonical_correction | Now a VA buyer filter (459 VA notices, all ⊂ old). 345 dropped = other buyers whose text says veterans/affairs; 0 dropped VA-buyer rows. |
| cybersecurity | ok | 344 → 424 | 344 | 0 | 80 | 340 → 412 | canonical_correction | Cyber concept forms (cyber / cyber security) + MCP cyber IT taxonomy: +80, 0 dropped. 20 new via 518210; some via body boilerplate (known limitation). |
| cyber | ok | 422 → 424 | 405 | 17 | 19 | 416 → 412 | canonical_correction | cyber ≡ cybersecurity ≡ cyber security (424 each). 17 dropped = cyber-substring words (cyberspace etc.), 0 match the canonical concept; 19 added via 518210 taxonomy. |
| cyber security | ok | 1,639 → 424 | 406 | 1,233 | 18 | 1,571 → 412 | canonical_correction | Old token-OR on "security" → 1,638. Now the one cyber concept → 424 (= cyber = cybersecurity). |
| SIEM | ok | 18 → 24 | 0 | 18 | 24 | 18 → 17 | canonical_correction | Old %siem% = SIEMENS substring (18 dropped, none contain the word SIEM). New 24 = MCP cyber related-IT taxonomy (518210/513210/541511); no active notice carries the word SIEM. |
| cyber cloud compliance network server | ok | 1,534 → 539 | 525 | 1,009 | 14 | 1,482 → 521 | canonical_correction | Capability list: ANY(cybersecurity·cloud·server), compliance/network rank-only → 539 (MCP Phase B 528). Old token-OR 1,530. |
| cyber, cloud | ok | 478 → 467 | 451 | 27 | 16 | 468 → 451 | canonical_correction | Explicit alternatives: cybersecurity OR cloud, word-bounded ∪ cyber taxonomy. 27 dropped substring hits, 16 added via taxonomy. |
| janitorial or landscaping | ok | 64 → 158 | 64 | 0 | 94 | 61 → 120 | canonical_correction | "or" = alternatives + industry preset NAICS: 0 dropped, +94 via 561720/561730/561210. |
| IT services | ok | 5,469 → 367 | 328 | 5,141 | 39 | 5,130 → 333 | canonical_correction | Old %it% substring → half the corpus. IT concept (case-sensitive acronym | information technology) ∪ IT taxonomy → 366. |
| IT | ok | 5,469 → 274 | 273 | 5,196 | 1 | 5,130 → 261 | canonical_correction | Acronym IT is case-sensitive: the pronoun "it" no longer matches. 5,464 → 273. |
| AI | ok | 5,296 → 109 | 109 | 5,187 | 0 | 4,926 → 101 | canonical_correction | Acronym AI case-sensitive (no m-ai-ntenance): 5,290 → 109, all ⊂ old. |
| ML | ok | 529 → 25 | 19 | 510 | 6 | 509 → 24 | canonical_correction | Acronym ML | machine learning: 529 → 25. 6 added include ML-as-millilitre unit hits (acronym limitation recorded). |
| HR services | ok | 2,031 → 11 | 11 | 2,020 | 0 | 1,944 → 11 | canonical_correction | Old %hr% substring (tHRee, cHRome) → 2,026. HR acronym case-sensitive → 11. "human resources" long form not a canonical concept (3 notices) — recorded. |
| QA | ok | 777 → 226 | 226 | 551 | 0 | 698 → 223 | canonical_correction | Old %qa% substring → 777. QA acronym → 226, ⊂ old. "quality assurance" (548 notices) is NOT a QA form — canonical limitation recorded; old never matched them either. |
| -computers | needs_positive_scope | 0 → 0 | 0 | 0 | 0 | 0 → 0 | unchanged |  |
| 541512 -computers | ok | 6 → 18 | 1 | 5 | 17 | 6 → 13 | canonical_correction | Old searched literal text "541512"/"-computers". Now NAICS 541512 minus notices mentioning computers (18); all 5 dropped carry "computers". |
| zzzxxyyqqq | ok | 0 → 0 | 0 | 0 | 0 | 0 → 0 | unchanged |  |
| follow-on support | ok | 91 → 102 | 91 | 0 | 11 | 84 → 94 | expected_policy_change | Hyphenated compound is one unit (matches "follow on" too); "support" is a stop word, so follow-on alone admits (known limitation). 0 dropped. |
| data management | ok | 2,307 → 1,163 | 1,163 | 1,144 | 0 | 2,227 → 1,139 | canonical_correction | Old token-OR data|management → 2,303. Canonical requires both → 1,162, ⊂ old. Glued DATAMANAGEMENT: 0 active notices. |
| janitoral | ok | 0 → 0 | 0 | 0 | 0 | 0 → 0 | unchanged |  |
| management | ok | 1,669 → 1,669 | 1,669 | 0 | 0 | 1,608 → 1,608 | unchanged |  |
| pam | ok | 37 → 11 | 11 | 26 | 0 | 37 → 11 | canonical_correction | Old %pam% substring (Pamunkey, camera spec). 26 dropped, none contain the word PAM. |
| market research | ok | 960 → 478 | 478 | 482 | 0 | 933 → 466 | canonical_correction | Canonical requires both qualifiers → 477 (MCP 465), ⊂ old; 482 dropped carry only one word. |
| drones | ok | 73 → 63 | 63 | 10 | 0 | 66 → 56 | canonical_correction | Old matched "uas" inside words (persUASive, qUASi) — 10 dropped, none drone-related. Old path also intermittently timed out / returned a null count on this query. |
| Pro Audio | ok | 4,640 → 85 | 85 | 4,555 | 0 | 4,443 → 79 | canonical_correction | Old %pro% substring → 4,632. audio admits, "pro" ranks → 84. |
| 8a | ok | 52 → 52 | 52 | 0 | 0 | 41 → 41 | unchanged |  |
| 541320 | ok | 0 → 0 | 0 | 0 | 0 | 0 → 0 | unchanged |  |
| 5413 | ok | 176 → 176 | 176 | 0 | 0 | 134 → 134 | unchanged |  |
| Show me USDA opportunities | ok | 5,874 → 257 | 257 | 5,617 | 0 | 5,357 → 216 | canonical_correction | Structured agency intent → 257 USDA notices (was %me%/%show% substring 5,870). 0 USDA buyers dropped. |
| SDVOSB cybersecurity opportunities in Virginia | ok | 340 → 0 | 0 | 340 | 0 | 290 → 0 | canonical_correction | Old resolved the whole query as a set-aside (340). Now SDVOSB ∧ VA ∧ cyber = true empty (same as MCP). |
| janitorial + agency=USDA | ok | 0 → 12 | 0 | 0 | 12 | 0 → 9 | canonical_correction | Old USDA needle found nothing (0). USDA identity (department AGRICULTURE) → 12, all USDA components. |
| janitorial + agency=VA | ok | 1 → 30 | 0 | 1 | 30 | 1 → 23 | canonical_correction | Old VA needle ⊂ "conserVAtion" (1 USDA row). Whole-word VA identity → 30 VA notices. |
| agency=USDA | ok | 3 → 257 | 3 | 0 | 254 | 3 → 216 | canonical_correction | Old %USDA% literal on department/sub_tier → 3. Canonical USDA identity → 257 (Forest Service, ARS, FSIS…). |
| agency=VA | ok | 37 → 459 | 0 | 37 | 459 | 31 → 349 | canonical_correction | Old "VA" substring hit conserVAtion / adVAnced (DARPA) — all 37 wrong. Canonical VA identity → 459 VA notices. |
| IT services + state=VA | ok | 807 → 47 | 40 | 767 | 7 | 772 → 44 | canonical_correction | IT concept (case-sensitive) ∪ taxonomy in VA → 47 (MCP 45). Old %it% substring 807. |
| agency=AGRICULTURE|VETERANS AFFAIRS | ok | 716 → 716 | 716 | 0 | 0 | 565 → 565 | unchanged |  |
| janitorial + agency=AGRICULTURE|VETERANS AFFAIRS | ok | 12 → 42 | 12 | 0 | 30 | 10 → 32 | canonical_correction | Multi-agency OR proven live: 42 = janitorial+USDA 12 + janitorial+VA 30. Adds the NAICS preset. |
| USDA -computers | ok | 159 → 248 | 133 | 26 | 115 | 149 → 207 | canonical_correction | Now USDA buyers minus computers (248). 26 dropped: 17 non-USDA buyers that merely mention USDA; 9 USDA buyers, all carry "computers". |
| SDVOSB -computers | ok | 340 → 332 | 332 | 8 | 0 | 290 → 282 | canonical_correction | SDVOSB set-aside minus computers: the 8 dropped all carry "computers" (old ignored the exclusion). |
| -computers + setAside=SB | ok | 0 → 3,066 | 0 | 0 | 3,066 | 0 → 2,580 | expected_policy_change | Approved positive-scope rule B: a set-aside group is a Maps positive scope, so the exclusion is valid → SB minus computers (3,067). Old returned 0. |
| -computers + closingDays=30 + hasDocs | needs_positive_scope | 0 → 0 | 0 | 0 | 0 | 0 → 0 | unchanged |  |

46 fixtures · 35 canonical_correction · 9 unchanged · 2 expected_policy_change

**Full-set audits (not samples), same day:** in every text-only fixture **0 dropped rows match the canonical text** (SQL ≡
JS matcher). `veterans affairs` / `Show me USDA` dropped **0** rows from the requested buyer. `USDA -computers`: 9 dropped
USDA-buyer rows, **9/9 carry "computers"**; the other 17 are non-USDA buyers that mention USDA. `SDVOSB -computers` 8/8
and `541512 -computers` 5/5 dropped rows carry "computers". `SIEM`: 18 dropped are SIEMENS substrings; the 24 added are the
MCP cyber related-IT taxonomy (518210/513210/541511) — no active notice carries the word SIEM. `cyber` ≡ `cybersecurity` ≡
`cyber security` = 424.

**Multi-agency OR, live:** `agency=AGRICULTURE|VETERANS AFFAIRS` 716 = USDA 257 + VA 459; with janitorial 42 = 12 + 30.

**drones timeout:** the old path hit a statement timeout during baseline capture, and on retry its count query twice
came back empty (no count, no error) before returning 73. Replay timings (one run each, mappable count): old 7.6s → new 1.1s.
Not a benchmark: broad acronym queries got slower (`IT` 0.5s → 1.6s, word-bounded regex over body text).

## 4. Gates

- `cross-surface-plan.unit.test.ts`: `maps_open` → **migrated**, `toPlan` = the production `mapsOpenRequest` fed the
  params the Maps client sends. Plus a source guard: the route may not reference `applyMapFilters`, `parseMapFilters`,
  `buildSearchOr`, `resolveQueryIntent`, `agencyOrExpr`, … must import the adapter, must build ONE plan, and all
  three Open paths must call it; the adapter must blank `search`/`agency`.
- **Proven:** adapter passing `agency: null` → red (`maps_open: janitorial` meaning ≠ MCP); route importing and calling
  `applyMapFilters` for the viewport → red (source guard); both restored → green. Breakage never committed.
- `maps-open-discovery.unit.test.ts`: positive-scope contract (Eric's six cases), fail-closed invalid plans, legacy
  search brain never sees the query, multi-agency, surface policy preserved, profile suppression.

## 5. Known limitations (recorded, NOT fixed — shared canonical layer)

- **QA / HR have no long form**: 548 active notices say "quality assurance", 3 say "human resources"; `QA`/`HR` queries
  match the acronym only (old substring never matched them either — not a regression).
- **Acronyms that are units**: `ML` also matches millilitre ("10 ML") — case-sensitive acronym, no context.
- **Body boilerplate**: cyber queries admit notices whose description carries cybersecurity clause text (dining, lab
  maintenance) — same as MCP Phase B.
- **Far-apart concepts** in long SOW text still co-occur (Phase A §4).
- **Glued words / typos** are literal: `DATAMANAGEMENT` (0 active notices today), `janitoral` → 0.
- **"follow-on support"**: "support" is a stop word, so follow-on alone admits.
- **janitorial preset 561210** (Facilities Support) is broad — 49 of the 102 added rows (medical-gas repair, elevators).
- **Client gap (approved C):** the map renders an empty result for `needs_positive_scope`; `discovery.refinement` is
  on the response but not rendered. Client phase.
- Not changed here: query persistence in the URL, agencies typed as keyword text, saved searches, alerts.

## 6. Next (not started)
Maps Recompete → Maps Forecast → rerun `scripts/discovery-saved-search-blast.ts` (sign-off on changed rows) → saved searches.
