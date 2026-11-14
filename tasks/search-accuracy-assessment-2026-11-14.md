# Plain-English search accuracy — root cause + proposed minimal corrections (Agent 3, 2026-11-14)

**Status:** assessment only. No shared-planner file is changed on this branch. Separate from PR #2043 (evaluator
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
