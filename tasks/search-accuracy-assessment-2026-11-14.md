# Plain-English search accuracy — root cause + proposed minimal corrections (Agent 3, 2026-11-14)

**Status (updated 2026-11-14, round 3):** C1 IMPLEMENTED on this branch (approved). C2 measured as an experiment only
(approved for experimentation; shared retrieval NOT changed). Nothing merged or deployed. Sections "C1 result" and "C2
experiment" at the end hold the round-3 evidence. Original assessment follows unchanged.

**Original status:** assessment only. No shared-planner file is changed on this branch. Separate from PR #2043 (evaluator
parity). Corrections C1–C6 wait for approval; C2 and C4 also need the Ask Mindy track's sign-off (they change
`find_opportunities` answers).

Evidence: blind-labeled set from PR #2043 (`tests/fixtures/saved-search-relevance-2026-11-14/`, 437 items, 3 labelers)
and `scripts/eval-search-variants.ts` (counterfactuals built from the canonical plan's own ops; narrowing variants
are scored on the existing labels as a stratified ratio estimate; the canonical row reproduces the labeled baseline
exactly, so the instrument is valid). Window = the alert cron's 30-day posted window.

## What the planner decides today (`mapsOpenRequest`, read-only probe)

| Intent | Concepts required | Capability | Taxonomy codes admitted | Structured |
|---|---|---|---|---|
| hvac maintenance | hvac (distinctive) AND maintenance (qualifier) | literal | none | — |
| medical staffing | medical AND staffing (both qualifiers) | literal | none | — |
| janitorial services | janitorial | industry preset | 561720 + related 561210, 561730 | — |
| we clean office buildings | **we** AND clean AND buildings | literal | none | — |
| I fix air conditioners for government buildings | ANY of fix / air / conditioners | literal | none | — |
| nurses for VA hospitals | nurses AND hospitals | literal | none | buyer VA |
| security guard services in Texas | guard AND security | literal | none | state TX |
| construction in Georgia | construction | industry preset | 236, 237, 238 | state GA (silent) |
| janitoral services | janitoral (unrecognized, still required) | literal | none | — |
| show me HUD opportunities | — | — | — | buyer HUD (+ "housing" alone) |

## Root causes

**R1 — related-family retrieval (janitorial regression 93% → 43%).** `openRetrievalNaics` (open-relevance.ts:108)
retrieves the preset's related family on Open. P1-D (2026-11-13) split janitorial into direct 561720 vs related
561210/561730 but kept retrieval "unchanged"; only MCP labels the related rows. Map pins and alert emails present
them as matches (steam testing, weed control, bombing-range operation).

**R2 — no trade recognition; literal AND over body text.** HVAC, medical staffing, guards, cleaning have no preset, so
every meaningful word must appear somewhere in title + description + full SOW. The required qualifier is the
failure: relevant HVAC notices mostly do not say "maintenance" ("Turn Key Chiller Equipment", "HVAC upgrades"), while
irrelevant ones contain both words somewhere in a long SOW. Measured, rejected:

| Variant (narrowing) | hvac P / R | medical staffing P / R | janitorial P / R | construction P / R |
|---|---|---|---|---|
| canonical (baseline) | 20 / 63 | 7 / 40 | 43 / 89 | 79 / 100 |
| drop `department` from text columns | 20 / 63 | 7 / 40 | 43 / 89 | 79 / 100 |
| title + description only (drop SOW) | 50 / 42 | 0 / 0 | 43 / 89 | 87 / 100 |
| all concepts in the same field | 20 / 63 | 7 / 40 | 43 / 89 | 79 / 100 |
| concepts within 60 chars | 0 / 0 | — / 0 | 43 / 89 | 79 / 100 |

Column and placement fixes trade recall for precision or do nothing. (My earlier hypothesis that the `department`
column causes false hits is refuted: zero effect.)

**R3 — sentences.** Pronouns and verbs become concepts: "we" is classified *distinctive* and required; "I fix air
conditioners…" (≥4 concepts) becomes a capability list admitting on "fix" OR "air" (1,206 rows, 7% precision). The
existing beginner extractor (`src/lib/beginner/activity.ts` `extractBusinessActivity`, used by /try and guarded by
`verify:beginner-try`) already reduces these correctly — "we clean office buildings" → head `clean`; "I fix air
conditioners for government buildings" → `conditioner` / "air conditioners", "government" as context — but canonical
discovery never calls it.

**R4 — buyer identity accepts a single generic word.** `resolveBuyer` keeps every alias needle's identity set,
including one-word sets that are a word of the buyer's own longer name: HUD → `housing` (matches Federal Housing
Finance Agency), HHS → `health` (matches Defense Health Agency, APHIS, USUHS). Measured over 20 agencies (active
notices): pruning such sets changes only HUD 6 → 4 (2 FHFA) and HHS 608 → 413 (195 = DHA 164, APHIS 25, USUHS 6 — none
HHS). 18 agencies unchanged.

**R5 — typos.** "janitoral", "maintanance" are flagged `unrecognized` by the matcher yet still required → 0. The
intent parser is deliberately "structural, not fuzzy"; no shared corrector exists.

**R6 — geography is inferred silently.** "construction in Georgia" becomes state=GA with no plan note. Correct most of
the time, but it is an inference the customer did not confirm (Georgia is also a country). "Texas" is unambiguous.

## Proposed minimal corrections (ordered by evidence, then risk)

| # | Change (shared planner, existing services only) | Effect measured | Risk / needs |
|---|---|---|---|
| C1 | `buyer.ts resolveBuyer`: drop a one-word identity set that is a word of a longer identity set of the same buyer | HUD 6→4, HHS 608→413, 18/20 unchanged; every removed row verified non-buyer | Narrowing only. Golden-plan fixture update. |
| C2 | `open-relevance.ts openRetrievalNaics`: Open retrieves DIRECT codes; a related-family code admits only with text evidence (the text path already ORs) | janitorial P 43→95, R 89→68 | Reverses P1-D's "retrieval unchanged". The recall lost is broad facilities O&M contracts labelers called borderline. Product decision + Ask Mindy sign-off. Map/MCP/alerts move together (one meaning). |
| C3 | Sentence-shaped residual (pronoun/verb present, or ≥4 words) → reduce with the existing `extractBusinessActivity` before `buildTextMatcher` | not yet (widening) | Needs a labeling round. Reuses the /try extractor; no new parser. |
| C4 | Trade recognition through the existing `PHRASE_PRESET` mechanism (direct codes only, after C2): e.g. HVAC → 238220, with qualifiers rank-only when a trade is recognized | not yet (widening) | Needs labeling; 238220 also covers plumbing-only work (labelers marked those false), so it must be measured before shipping. Guards (561612) and medical staffing (561320) sit outside every current preset — adding them is a data change to `industry-presets.ts`, decided per trade on measurement. |
| C5 | Typos: plan returns a refinement ("Did you mean janitorial?") from existing vocabulary (`CONCEPTS`, preset phrases, `COMMON_TERM_WEIGHT`); never auto-applied; a saved search stores the corrected text only after the customer confirms (save flow, PR #2040 area) | not applicable | No silent inference. |
| C6 | Geography disclosure: a plan note "Georgia read as the US state (GA)" surfaced in the discovery meta | no behaviour change | No silent inference. |

**Not proposed:** a new search engine, column changes (R2 table), proximity rules, NAICS suggestions applied without
confirmation, any inferred certification or eligibility.

## Gate for any implementation PR

1. Re-run `scripts/eval-search-variants.ts` + a fresh blind labeling round for widening variants (C3/C4).
2. No intent's precision may drop; any recall drop is listed by row in the PR.
3. `discovery-plan.unit.test.ts` golden plans + cross-surface plan test updated deliberately, never re-baselined blind.
4. PR #2043 parity tests stay green (alerts inherit the planner; parity is by construction).

## Records still to correct in the eval itself

- Georgia recall (74% → 9%) is unreliable: the recall probe was not state-restricted and labelers counted blank-state
  construction from other states as relevant. Re-label with a state-restricted probe before using it.
- "nurses for VA hospitals" and "security guard services in Texas" found no relevant notice in any stratum in the
  window. The likely honest answer is near zero; precision fixes should produce an explained empty, not new matches.

## C1 result (implemented, round 3)

`src/lib/discovery/buyer.ts` `pruneSubsumedSingles`: a one-word identity set is dropped when its word is part of a
longer identity set of the same buyer; a buyer is never left with no set. Consumers: the discovery plan's Open
(`department`, `sub_tier`) and Recompete (`awarding_agency`, `awarding_sub_agency`) buyer predicates, i.e. the Map,
saved-search alerts (after PR #2043), MCP `find_opportunities` and Ask Mindy.

**The 20 evaluated agencies (active Open notices):** HUD 6 → 4 (2 Federal Housing Finance Agency) and HHS 608 → 413
(195 = Defense Health Agency 164, APHIS 25, USUHS 6). VA and DHS lose a set but no notice. The other 16 are untouched.

**Every buyer the rule touches (67, found by running the rule over all 460 alias keys):** the golden-plan diff showed the
change was wider than the 20 (FAA), so the measurement was widened. Live, both tables, every removed row grouped by its
actual agency:

| | Open (active) | Recompete (quality rows) |
|---|---|---|
| rows removed | 298 | 3,022 |
| rows added | 0 | 0 |
| buyers with no change | 53 of 67 | |

Removed rows by requested buyer: HHS → DHA/APHIS/USUHS/OSHRC; HUD → FHFA, Rural Housing Service; CBP → ICE; ICE → USCIS;
FHWA → NHTSA; Army Futures Command → CFTC; Reclamation → Office of Surface Mining; MARAD → Federal Maritime Commission;
FRA → Railroad Retirement Board; OCC → GAO; Library of Congress → IMLS; IMLS → Holocaust Memorial Museum; AOC → Capitol
Police; EERE → CIGIE. None is the requested agency.

**Valid losses caught and closed.** The first live run found three buyers whose single word was carrying REAL notices:
ASPR (5 Open / 178 Recompete filed under "Office of Assistant Secretary for Preparedness and Response", BARDA work),
USDA Rural Development (56 Recompete, Rural Housing Service is an RD agency), NRCS (19 Open from the Farm Production and
Conservation Business Center: snow surveys, dam rehabilitation, irrigation). Fixed with three explicit aliases in
`src/data/agency-aliases.json` (not by keeping the generic word); re-measured at 0 loss. Note: that JSON is read by 10
modules including Ask Mindy's argument-redaction allowlist (`src/lib/chat/redact-args.ts`); the change is three
additional public agency names.

**Tests:** `src/lib/discovery/buyer.unit.test.ts` (54): exact post-C1 identity for all 20 agencies, 18 false-match
pairs and 11 valid pairs from live agency strings, and invariants over every alias key (narrowing only, never empty, no
subsumed single survives). With the pruning removed, the 20-agency and false-match tests fail. Golden plans regenerated
deliberately; the diff is only the removed singles (VA, FAA, HUD shown in the fixture set). Full suite: 1,021 files pass;
`tsc` clean.

**Residual, not addressed (out of C1 scope):** short alias words that are NOT part of the longer name survive by design
(`usa` for Army, `ed` for Education, `state` for State, `doc` for Commerce). They are whole-word, but `state` and `usa`
may admit rows. Measure before acting.

## C2 experiment (measured only, round 3)

`scripts/eval-c2-related-codes.ts` (read-only). Population = the live canonical janitorial result in the alert cron's
30-day window (144 notices: 561210 = 60, 561720 = 41, 561730 = 33, other 10). Scored on the existing blind labels (45
janitorial items: 15 canonical-only, 15 both, 15 neither-retrieved; 3 labelers).

| Approach | Results | Precision | Recall | Labeled false removed | Labeled relevant lost |
|---|---|---|---|---|---|
| 1. Current related-code expansion | 144 | 43% | 89% | 0 | 0 |
| 2. Core code only (561720) | 41 | 100% | 55% | 12 | 6 |
| 3. Core code + related-code notices with evidence of the work | 51 | 95% | 68% | 11 | 2 |

Approach 3's evidence test is Agent 1's released Open labeller (`labelOpenRow`, `find-opportunities.ts`), imported and
called unmodified: a notice is kept when it is 561720 or the labeller classes it DIRECT_MATCH (visible buy-side text
establishes the work, buyer name and solicitation number blanked). The SQL-expressible form "561720 OR janitorial text in
title/description" selects the identical 51 notices (0 differences either way), so surfaces could apply it without a
second evidence rule. A variant that also accepts SOW-only text returns 55 (4 more, none in the labeled sample); it is
weaker than Agent 1's standard (evidence not visible) and is not recommended.

What each loses: approach 2 drops two relevant embassy janitorial notices filed under a truncated code "56172" plus
broad Navy facilities O&M / base operations notices with a custodial component. Approach 3 keeps the embassy notices on
text and loses only the two Navy facilities O&M notices (labelers judged them relevant; they never say janitorial in
visible text).

**Sample-size caveat.** Precision for approach 3 rests on 17 labeled kept notices. Its recall drop (89 → 68) comes
from 2 labeled notices in the canonical-only stratum, each standing for about 7 notices. Treat the ranking as solid
(3 ≫ 1 on precision; 3 > 2 on recall at near-equal precision) and the exact percentages as ±10 points. Labeling all 144
notices would make the figures exact.

**Compatibility with Ask Mindy Phase 1 (Agent 1).**
1. P1-D (`a0cd5a0f0`, `find-preset-evidence.unit.test.ts`) states related-family rows are "still retrieved and shown,
   but as RELATED_MARKET_CANDIDATE". Changing `openRetrievalNaics` (the original C2 wording) would remove them from MCP
   and Ask Mindy Open results, reversing a released, tested behaviour. Not done.
2. Compatible route: keep shared retrieval and labelling as released; on surfaces that present a result as a MATCH
   (Map match count, saved-search alert emails) admit only Agent 1's DIRECT_MATCH, and show related-market rows as a
   separate labelled group or not at all. This reuses Agent 1's evidence standard and does not weaken it. It does mean
   the Map/alert count and MCP's total differ by the related-market rows, which MCP already reports separately
   (`evidence_counts.RELATED_MARKET_CANDIDATE`). Needs Agent 1's sign-off on that reading of "one meaning".
3. Coming back (Recompete) is unaffected by approaches 2 and 3 on Open.
4. Customer reach today: of 186 alerting watches, exactly 1 (`0e41b9aa`, 1 owner) resolves to the janitorial preset with
   the related family under the canonical plan. Approaches 2/3 would only change that watch (once #2043 is active) plus
   Map/MCP janitorial searches. It must be counted in the combined #2040 + #2043 reconciliation before any activation
   request.
