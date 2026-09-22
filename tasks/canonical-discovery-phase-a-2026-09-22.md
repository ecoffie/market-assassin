# Canonical Mindy Discovery — Phase A (decisions locked, 2026-09-22)

> **Superseded in part by Phase B** (`tasks/canonical-discovery-phase-b-2026-09-22.md`): the matcher gained a
> `cybersecurity` concept (cyber ≡ cybersecurity, per MCP CYBER_DIRECT_RE) and case-sensitive acronyms
> (IT/AI/ML/HR/QA). Counts below for cyber / IT / ai queries predate that; the Phase B replay is current.
> Re-run `scripts/discovery-saved-search-blast.ts` before the saved-search migration.

**Status:** seam, golden fixtures and measurement tooling built. **No production consumer changed** —
nothing in MCP, Maps, saved searches or alerts calls `src/lib/discovery` yet.
Audit that started this: `tasks/map-mcp-discovery-audit-2026-09-22.md`.

## 1. The locked pipeline

```
raw input
→ 1 structured intent   intent.ts   agency · state · set-aside · NAICS · PSC · -exclusions · wrappers stripped
→ 2 classification      matcher.ts  distinctive | qualifier | supporting   (semantic, never by length)
→ 3 eligibility         matcher.ts  who may be ADMITTED (word-bounded \m…\M, never substrings)
→ 4 horizon policy      policy.ts   recompete 18 mo · forecast current+future FY — may NARROW, never reinterpret
→ 5 ranking             rank.ts     eligible breadth first, then class-weight × position — reorders, never admits
```
Every horizon consumes the same plan; none re-reads `raw`. MCP's resolvers are reused unchanged
(`resolveQueryIntent`, `interpretMarket`, retrieval NAICS/PSC, term-of-art NAICS, `resolveBuyerIdentity`).

| file | role |
|---|---|
| `src/lib/discovery/intent.ts` | stage 1 — server-side structured extraction (replaces Maps' client `parseSearchIntent` as the authority) |
| `src/lib/discovery/matcher.ts` | stages 2–3 — concept classes, eligibility, word-bounded PostgREST predicates, NULL-safe exclusion |
| `src/lib/discovery/buyer.ts` | whole-term agency identity predicate (fixes the USDA/`AG`, VA/`NAVAL` class) |
| `src/lib/discovery/plan.ts` | `buildDiscoveryPlan(input, policy, ctx)` — serializable plan, status `ok \| needs_positive_scope \| needs_refinement` |
| `src/lib/discovery/policy.ts` | MCP · Maps · saved-search · daily-alert policies |
| `src/lib/discovery/rank.ts` | stage 5 |
| `src/lib/discovery/apply.ts` | plan → Supabase query (mechanical) |
| `__fixtures__/golden-plans.json` + `discovery-plan.unit.test.ts` | 26 golden plans, 39 contract tests |
| `scripts/discovery-replay.ts`, `scripts/discovery-saved-search-blast.ts` | READ-ONLY production gates |

Existing-code edits are **exports only**: `pscMatchConds` (open-relevance), `GENERIC_SINGLE_WORDS` + `looksLikeRealWord`
(keyword-sanitize), `COMMON_TERM_WEIGHT` (mi-dashboard/search), `SET_ASIDE_SYNONYMS` (query-intent). No behaviour change.
**2,309 tests pass** (rebased on 954e901b) (discovery, opportunities, search, beginner, market, mi-dashboard, mcp, opportunity-map, api/app); `tsc` clean.

## 2. Decisions → implementation

| decision | implemented as | proof |
|---|---|---|
| 1 · intent parsing canonical + server-side | `extractStructuredIntent`: vetted agency lexicon (Maps' shipping list + unambiguous acronyms + full proper names) resolved through MCP `resolveBuyerIdentity`; states (full names, `in XX`); set-asides; embedded NAICS/PSC; `-exclusions`; wrappers/opportunity nouns stripped | "Show me USDA opportunities" → agency USDA, no keyword; capability words that are alias keys (cybersecurity, logistics, health, energy, space) never become agencies (test) |
| 1 · aliases match identity, not substrings | `buyer.ts`: needle → identity words, every word `\m…\M` in department/sub_tier (Open) or awarding_agency/_sub_agency (Recompete); word order free. Forecast already identity-coded (2026-09-14) | USDA never matches DLA/DISA; VA never matches NAVAL/NEVADA/NAVY (tests + §4) |
| 2 · no 4+ words = OR | ≤3 **meaningful** concepts → all required; capability list → ANY distinctive admits, qualifiers/supporting rank only; `,` `;` `or` = alternatives | §5 Andre |
| 3 · no length heuristic | classes from semantic lists: supporting = modifier/context/`DISCOVERY_SUPPORTING` (pro, premium…); qualifier = corpus-common / platform-generic / `market`; else distinctive. Length only governs INFLECTION (what counts as the same word), never importance | `pro` supporting, `pam`/`gis` distinctive (test) |
| 4 · forecast current/future FY by default | `policy.forecast.includePastFiscalYears=false` on MCP, Maps, saved search; opt-in only | 40 no-query forecast saved searches replayed with past FY opted in → **0** deltas (the change is policy only) |
| 5 · exclusion needs a positive anchor | anchor = lexical concept · NAICS/PSC · set-aside · agency · state · explicit input · `hasSurfaceScope`; else `needs_positive_scope` + refinement text, every horizon `<pk> IS NULL` | `541512 -computers` ok; naked `-computers` blocked (test + §4) |

**Why "qualifier" exists (found in the re-run):** `medical` is in `GENERIC_SINGLE_WORDS`, a list built for profile-keyword
distinctiveness. As a rank-only word, "medical billing" admitted on `billing` alone (Open 405→74 incl. utility billing).
Qualifiers are broad but meaningful — required in a short query, rank-only in a capability list. Same fix makes
"market research" require both words (with `market` rank-only it admitted **2,924** forecasts vs 40).

## 3. Production corpus — old vs canonical (full corpus, no viewport)

Maps old = `/api/app/*-map` semantics @2574fe8d · MCP old = `find_opportunities` matched_count (agency-only rows: MCP's
needle path measured directly) · canonical = MCP policy (Maps policy now identical).

| fixture | horizon | Maps old | MCP old | canonical | Maps-old ∩ canonical | Maps-old-only | new-only |
|---|---|---|---|---|---|---|---|
| 541320 | open | 0 | 0 | 0 | 0 | 0 | 0 |
| 541320 | recompete | 0 | 0 | 0 | 0 | 0 | 0 |
| 541320 | forecast | 10 | 10 | 10 | 10 | 0 | 0 |
| pam | open | 37 | 37 | 11 | 11 | 26 | 0 |
| pam | recompete | 5 | 5 | 0 | 0 | 5 | 0 |
| pam | forecast | 25 | 21 | 10 | 10 | 15 | 0 |
| ai governance | open | 5,072 | 5,072 | 10 | 10 | 5,062 | 0 |
| ai governance | recompete | 0 | 0 | 0 | 0 | 0 | 0 |
| ai governance | forecast | 3 | 3 | 13 | 3 | 0 | 10 |
| artificial intelligence governance | open | 157 | 157 | 10 | 10 | 147 | 0 |
| artificial intelligence governance | recompete | 0 | 0 | 0 | 0 | 0 | 0 |
| artificial intelligence governance | forecast | 0 | 0 | 13 | 0 | 0 | 13 |
| cybersecurity | open | 342 | 361 | 361 | 342 | 0 | 19 |
| cybersecurity | recompete | 7 | 16,232 | 15,686 | 7 | 0 | 15,679 |
| cybersecurity | forecast | 180 | 170 | 170 | 170 | 10 | 0 |
| janitorial | open | 34 | 118 | 118 | 34 | 0 | 84 |
| janitorial | recompete | 25 | 5,323 | 5,323 | 24 | 1 | 5,299 |
| janitorial | forecast | 240 | 238 | 238 | 238 | 2 | 0 |
| market research | open | 935 | 935 | 465 | 465 | 470 | 0 |
| market research | recompete | 0 | 0 | 4 | 0 | 0 | 4 |
| market research | forecast | 41 | 40 | 62 | 40 | 1 | 22 |
| zzzxxyyqqq | open | 0 | 0 | 0 | 0 | 0 | 0 |
| zzzxxyyqqq | recompete | 0 | 0 | 0 | 0 | 0 | 0 |
| zzzxxyyqqq | forecast | 0 | 0 | 0 | 0 | 0 | 0 |
| Show me USDA opportunities | open | 5,529 | 5,529 | 221 | 221 | 5,308 | 0 |
| Show me USDA opportunities | recompete | 0 | 0 | 4,602 | 0 | 0 | 4,602 |
| Show me USDA opportunities | forecast | 0 | 0 | 5,028 | 0 | 0 | 5,028 |
| SDVOSB cybersecurity opportunities in Virginia | open | 318 | 318 | 0 | 0 | 318 | 0 |
| SDVOSB cybersecurity opportunities in Virginia | recompete | 3,495 | 30 | 145 | 145 | 3,350 | 0 |
| SDVOSB cybersecurity opportunities in Virginia | forecast | 324 | 312 | 1 | 1 | 323 | 0 |
| cyber cloud compliance network server | open | 1,510 | 1,522 | 258 | 246 | 1,264 | 12 |
| cyber cloud compliance network server | recompete | 0 | 16,232 | 15,686 | 0 | 0 | 15,686 |
| cyber cloud compliance network server | forecast | 0 | 0 | 604 | 0 | 0 | 604 |
| Pro Audio | open | 4,502 | 4,502 | 84 | 84 | 4,418 | 0 |
| Pro Audio | recompete | 0 | 0 | 6 | 0 | 0 | 6 |
| Pro Audio | forecast | 0 | 0 | 85 | 0 | 0 | 85 |
| 541512 -computers | open | 5 | 5 | 13 | 0 | 5 | 13 |
| 541512 -computers | recompete | 0 | 0 | 4,267 | 0 | 0 | 4,267 |
| 541512 -computers | forecast | 0 | 0 | 287 | 0 | 0 | 287 |
| -computers **[needs_positive_scope]** | open | 0 | 0 | 0 | 0 | 0 | 0 |
| -computers **[needs_positive_scope]** | recompete | 0 | 0 | 0 | 0 | 0 | 0 |
| -computers **[needs_positive_scope]** | forecast | 0 | 0 | 0 | 0 | 0 | 0 |
| veterans affairs | open | 724 | 724 | 387 | 387 | 337 | 0 |
| veterans affairs | recompete | 16,307 | 16,307 | 16,307 | 16,307 | 0 | 0 |
| veterans affairs | forecast | 695 | 695 | 1,390 | 694 | 1 | 696 |
| Naval facilities in Nevada | open | 1,312 | 1,312 | 0 | 0 | 1,312 | 0 |
| Naval facilities in Nevada | recompete | 0 | 0 | 0 | 0 | 0 | 0 |
| Naval facilities in Nevada | forecast | 0 | 0 | 0 | 0 | 0 | 0 |
| agency=USDA (collision) | open | 3 | 4,899 | 221 | 3 | 0 | 218 |
| agency=USDA (collision) | recompete | 0 | unknown | 4,602 | 0 | 0 | 4,602 |
| agency=USDA (collision) | forecast | 5,028 | unknown | 5,028 | 5,028 | 0 | 0 |
| agency=VA (collision) | open | 31 | 418 | 387 | 0 | 31 | 387 |
| agency=VA (collision) | recompete | 230 | unknown | 16,307 | 0 | 230 | 16,307 |
| agency=VA (collision) | forecast | 1,390 | unknown | 1,390 | 1,390 | 0 | 0 |

Truth checks behind the zeros: `SDVOSB cybersecurity … Virginia` — cyber 361, cyber∧VA 19, cyber∧SDVOSB 5, SDVOSB∧VA 64,
all three **0** (a true empty). `Naval facilities in Nevada` — naval 533, NV 24, both **0**.

## 4. Representative false positives removed / false negatives introduced

**False positives removed (old-only samples):**
- `ai governance` Open 5,072 → 10: rep-AI-r, m-AI-ntenance, rem-AI-ns (all 23 canonical Open+Forecast hits hand-inspected in round 1 — every one has the word AI/Artificial Intelligence AND governance).
- `Show me USDA opportunities` 5,529 → 221 (true USDA 222): old matched `%me%` → "CONTROL-DISPLAY UNI", "RESISTOR,ADJUSTABLE" (DLA).
- **Agency collisions:** MCP `agency=USDA` 4,899 (via `AG` → DLA/DISA) → 221. **Maps agency filter `VA`** returned 31 rows and **0 were VA** — "USDA … FARM PRODUCTION AND CONSER**VA**TION", "DARPA … Ad**va**nced" → canonical 387, all VETERANS AFFAIRS.
- `pam` Recompete 5 → 0: **Pam**ela Heschke, Steele **Pam**ela, **Pam**unkey Indian Enterprises (substrings).
- `Pro Audio` 4,502 → 84: old `%pro%` → Sniper Targeting Pod, RESISTOR; canonical top = "AMPLIFIER,AUDIO FREQUE", "Audio Visual System and Install Luke AFB".
- `cybersecurity` Recompete vs MCP old 16,232 → 15,686: MCP's `SIEM` substring admitted SIEMENS Medical/Healthcare.

**False positives that REMAIN (honest):**
- **Body co-occurrence.** Required words may sit far apart in a long SOW: `medical billing` admits "STEP OFF MATS AND MAINT. SERVICES", "Chemical Toilet Services" (24 total, real title hit "Automated Medical Claims Billing" ranks #1); `ai governance` admits "Maxwell AFB … AI Portal … Information Governance Program". Ranking floats title/phrase hits; eligibility does not yet require proximity. The /try record rejects order-free proximity heuristics — any fix must clear `body-relevance-cases.ts`.
- **Capability-list breadth.** Andre: 213 of 258 eligible match ONE distinctive concept (often in body boilerplate). Breadth ranking puts the 3-concept match first; the tail is weak by design of ANY-admits.

**False negatives introduced (by design or to watch):**
- Exclusion is aggressive: `541512 -computers` drops CFBLNET because its SOW says "Command, Control, Communications, **Computers**, Intelligence" (C4I boilerplate). Correct to the letter; users may expect title-only exclusion.
- Inflection is conservative: `optic` matches optics, not **optical**; `pam` matches PAMS, not Pamunkey (intended).
- Typos are literal: saved "shoe me … Virgin Islands" → state VI ∧ `shoe` → 0; "janitoral" → 0. No fuzzy matching.
- NOAA forecasts 3 → 0: the 3 were DOI/DHS forecasts that mention NOAA; there is no NOAA forecast publisher, and the plan does not yet mark that as `coverage: unestablished` (forecast identity has no NOAA entry).

## 5. Andre — eligibility + ranking (not just count)

Eligibility: capability list → **ANY(cyber · cloud · server)**; `compliance`, `network` are corpus-common qualifiers → rank only.
Open old 1,510 → **258** (+ MCP cyber taxonomy union 518210/DJ01/DJ10). "Network compliance audit services" is NOT eligible (test).

## Ranking — "cyber cloud compliance network server"  (canonical eligible: 258; eligibility=any(cyber|cloud|server) rank-only(compliance|network))
| # | canonical top (score · breadth · matched) | old top (buildSearchOr + rankSearchResults) |
|---|---|---|
| 1 | APPLICATION ARSENAL (AA) ENTERPRISE ENGINEERING AND LIFECYCLE SUPPORT  · 5.8 · 3 · cyber+cloud+server+compliance+network | Cloud-Based GRC / Cyber Risk Compliance Automation Platform (FISMA Hig |
| 2 | Cloud-Based GRC / Cyber Risk Compliance Automation Platform (FISMA Hig · 7.0 · 2 · cyber+cloud+compliance | Intent to Sole Source an ERM solution |
| 3 | Skyline PhotoMesh Pro 30 Fuser, TerraBuilder Site, TerraExplorer C2MP  · 5.3 · 2 · cloud+server+network | RFI - Programmatic and Administrative Support Services |
| 4 | OCFO Risk Management and Compliance Division, Internal Control and Com · 4.8 · 2 · cyber+server+compliance+network | Skyline PhotoMesh Pro 30 Fuser, TerraBuilder Site, TerraExplorer C2MP  |
| 5 | 1 FW Network Install · 4.5 · 2 · cyber+server+compliance+network | OCFO Risk Management and Compliance Division, Internal Control and Com |
| 6 | Security Equipment Installation · 4.3 · 2 · cyber+server+compliance+network | Communications, Network, Engineering, Cybersecurity, and Information T |
| 7 | ICE TELERADIOLOGY SERVICES · 4.3 · 2 · cyber+cloud+compliance+network | Advanced Driver Assistance Systems (ADAS), on road networks at the Fis |
| 8 | U. S. Coast Guard MH-60T Jayhawk Helicopter Advanced Aircrew Training  · 4.3 · 2 · cyber+server+compliance+network | Remote Support Solution, On-Premise |
| 9 | TECOM Range and Training Area Management (RTAM) Support Services  M002 · 4.3 · 2 · cloud+server+compliance+network | DA01-Compensation & Pension (C&P) Product Line Help Desk Tier 2 and De |
| 10 | NAWCAD WOLF Mission Systems Integration (MSI) · 4.3 · 2 · cyber+server+compliance+network | Air National Guard Readiness Center Cable Television Services |
canonical breadth distribution (concepts matched → records): {"0":14,"1":213,"2":30,"3":1}

Contrast — short concept query `medical billing` (both required):

## Ranking — "medical billing"  (canonical eligible: 24; eligibility=all(billing|medical) rank-only())
| # | canonical top (score · breadth · matched) | old top (buildSearchOr + rankSearchResults) |
|---|---|---|
| 1 | Automated Medical Claims Billing · 4.0 · 2 · billing+medical | Automated Medical Claims Billing |
| 2 | Box Elder JCC Medical Services · 2.5 · 2 · billing+medical | Box Elder JCC Medical Services |
| 3 | STEP OFF MATS AND MAINT. SERVICES · 2.0 · 2 · billing+medical | MARSOC Special Operations Medical Training Services IDIQ |
| 4 | Peleliu Meals Service Contract · 2.0 · 2 · billing+medical | Z1DA--Construction of Ogden Elevator Cab Interiors  Jesse Brown Medica |
| 5 | RFI Transportation Services AS27 · 2.0 · 2 · billing+medical | J065--FY26: REPAIR MEDICAL GAS LEAK |
| 6 | RFI #2 Veteran Affairs Code Sets Requirement · 2.0 · 2 · billing+medical | Vacuum Condensate Pump Rebuild for the Jesse Brown VA Medical Center,  |
canonical breadth distribution (concepts matched → records): {"2":24}

## 6. Saved searches — all 104 (READ-ONLY; users anonymized)

- **77 without a query: Open Δ = 0 for every one.** Forecast changed on 37 — **all from the decided FY policy** (replayed with past FY opted in: 0 of 40 differ).
- **27 with a query: 16 material.** Open = exactly the cron (posted ≤30 d, profile scope as today); Recompete = map view only.

| search | user | q | Open old → canonical (Δ) | Forecast old → canonical (Δ) | Recompete map old → canonical | material | canonical reading |
|---|---|---|---|---|---|---|---|
| 03a84411 | user-01 | construction renovation demolition carpentry framing drywall flooring concrete general trades building repair | 27 → 29 (2) | n/a | n/a | no | any(renovation|demolition|carpentry|framing|drywall|flooring|concrete) rank(construction) |
| 0678583e | user-02 | Pro Audio | 79 → 0 (-79) | 0 → 1 (1) | 0 → 0 [text] | ⚠️ open, forecast | all(audio) rank(pro) |
| 08d970cb | user-03 | 6114 | 10 → 10 (0) | 170 → 138 (-32) | 16162 → 519 [structured_only] | ⚠️ recompete-map | naics→6114 |
| 1d1ed74e | user-04 | computer | 2 → 2 (0) | n/a | n/a | no | all(computer) |
| 22a140c6 | user-01 | construction renovation demolition carpentry framing drywall flooring concrete general trades building repair | 27 → 29 (2) | n/a | n/a | no | any(renovation|demolition|carpentry|framing|drywall|flooring|concrete) rank(construction) |
| 2c2261bd | user-04 | laptop | 1 → 1 (0) | n/a | n/a | no | all(laptop) |
| 332eef89 | user-05 | small business janitoral | 0 → 0 (0) | n/a | n/a | no | set-aside→sb · all(janitoral) |
| 386e228b | user-06 | Show me USDA opportunities | 5323 → 220 (-5103) | 0 → 5028 (5028) | 0 → 4602 [structured_only] | ⚠️ open, forecast, recompete-map | agency→USDA · stripped show me/opportunities |
| 3d6a0258 | user-07 | mold | 3 → 3 (0) | n/a | n/a | no | all(mold) |
| 3e2511ad | user-07 | dry ice | 4328 → 23 (-4305) | n/a | n/a | ⚠️ open | all(dry|ice) |
| 4dcfa6ea | user-07 | kitchen exhaust | 131 → 9 (-122) | n/a | n/a | ⚠️ open | all(kitchen|exhaust) |
| 5c81a958 | user-04 | hardware | 8 → 8 (0) | n/a | n/a | no | all(hardware) |
| 61d1ca1f | user-06 | Show me HUD opportunities | 5323 → 11 (-5312) | 0 → 0 (0) | 0 → 258 [structured_only] | ⚠️ open, recompete-map | agency→HUD · stripped show me/opportunities |
| 741adbff | user-08 | construction renovation building modernization | 139 → 79 (-60) | n/a | n/a | no | any(renovation|modernization) rank(construction|building) |
| 994c599e | user-09 | -computers | 0 → 56 (56) | 0 → 1572 (1572) | 14084 → 13823 [structured_only] | ⚠️ open, forecast | exclude computers |
| 9ca2d2de | user-06 | Show me DOJ opportunities | 5322 → 87 (-5235) | 0 → 619 (619) | 0 → 4685 [structured_only] | ⚠️ open, forecast, recompete-map | agency→DOJ · stripped show me/opportunities |
| 9fb0009c | user-04 | printer | 0 → 0 (0) | n/a | n/a | no | all(printer) |
| a0ab22ba | user-07 | degreasing | 2 → 2 (0) | n/a | n/a | no | all(degreasing) |
| a9eb09ff | user-04 | software license | 14 → 7 (-7) | n/a | n/a | ⚠️ open | all(software|license) |
| b032f39f | user-06 | Show me SBA opportunities | 5322 → 0 (-5322) | 0 → 0 (0) | 0 → 4 [structured_only] | ⚠️ open, recompete-map | agency→SBA · stripped show me/opportunities |
| b4e40d05 | user-10 | fiber optic installation | 11 → 1 (-10) | 2 → 5 (3) | 0 → 0 [text] | ⚠️ open | all(fiber|optic|installation) |
| bf35f82a | user-10 | telecommunications installations | 390 → 82 (-308) | n/a | n/a | ⚠️ open | all(telecommunications|installations) |
| c3f908e3 | user-02 | shoe me opportunities in the Virgin Islands | 5328 → 0 (-5328) | 0 → 0 (0) | 0 → 0 [text] | ⚠️ open | state→VI · all(shoe) · stripped opportunities |
| e00435f7 | user-11 | National Oceanic and Atmospheric Administration | 1704 → 15 (-1689) | 3 → 0 (-3) | 0 → 1288 [structured_only] | ⚠️ open, forecast, recompete-map | agency→National Oceanic and Atmospheric Administration |
| e4460582 | user-08 | construction renovation building modernization | 5 → 7 (2) | n/a | n/a | no | any(renovation|modernization) rank(construction|building) |
| e9c0f9be | user-02 | revenue cycle management | 1623 → 5 (-1618) | 2 → 0 (-2) | 0 → 0 [text] | ⚠️ open, forecast | all(revenue|cycle|management) |
| ff372605 | user-02 | medical billing | 405 → 24 (-381) | 1 → 6 (5) | 0 → 0 [text] | ⚠️ open, forecast | all(billing|medical) |

Reading it: the NL agency searches now mean their agency (USDA 220, HUD 11, DOJ 87, SBA 0 — SBA has no open notices);
precision drops (dry ice 4,328→23, revenue cycle management 1,623→5) remove substring noise; `6114` + a saved NAICS now ANDs
both (old silently ignored the query when a saved NAICS existed — recompete map 16,162→519); `-computers` (IT NAICS minus
computers) finally alerts (0→56). **Profile-scope hazard** preserved: a typed query still disables profile scope.

## 7. Client defects — recorded, NOT in semantic migration
- Query never written to the URL. · Agency autocomplete click runs a keyword search, not an agency filter. · Enter fires no new request.

## 8. Migration PR sequence (after this PR)

| PR | scope | gate |
|---|---|---|
| 2 | **MCP `find_opportunities` → seam** (oracle first). Fixes the MCP USDA/`AG` and `SIEM` defects in production | per-fixture MCP counts = §3 canonical; hosted smoke on the fixture set |
| 3 | Cross-surface contract test: Maps route handlers and MCP emit identical plans per fixture class | CI fails on divergence (normalized plan JSON) |
| 4 | Maps Open → seam (keep bbox/sources/commodity as surface policy) | §3 parity; `verify:search` pins updated to the new contract (Andre = 258 ranked, not 1,510) |
| 5 | Maps Recompete → seam (18 mo, MCP industry interpretation) | janitorial 5,323 · cyber 15,686 |
| 6 | Maps Forecast → seam (current/future FY default) | forecast parity |
| 7 | Saved searches + watchlist → seam | re-run `discovery-saved-search-blast`; sign-off on the 16 material rows; profile-scope test |
| 8 | Client: q in URL, agency suggestion → agency param, retire client parser as authority | browser acceptance |

Open follow-ups (not blocking Phase A): body co-occurrence precision (§4), exclusion scope (all columns vs title),
NOAA-style forecast coverage labelling, daily-alert keyword path audit.
