# POTETO — Incumbent Evidence Truth ✓

**CANDIDATES → EVIDENCE → SCORE → CONFIDENCE → SELECTION → EXPLANATION** · surfaces `get_solicitation_incumbent`, `find_predecessor_award`, `build_pursuit_dossier`
Merged PR #1629 (head `87e22172`, merge `826c2aab`), production deployment `dpl_5nEE9Gzb6sEkfKw5tuQXp3Vf2QgM` serving `getmindy.ai`, verified on the hosted MCP 2026-09-22. **FROZEN.**

## Production before (hosted MCP)
| fixture | customer-visible contradiction |
|---|---|
| VA `36C24226Q0857` (236220 / Z1DA) | `incumbent:null`, but all 5 `prior_awards` (AT&T guest WiFi 517110, boiler inspection 541990, temperature sensors 811219, pharmacy inventory 561990) were `matchConfidence:"high"` / ≈105 with `naicsMatch:false`, `pscMatch:false`, sector 23 vs 51/54/81/56. |
| VA via `find_predecessor_award` | **"Likely incumbent: AT&T ENTERPRISES, LLC … [match: high]", `grounded:true`** — this entry point never ran the selection guard. |
| DLA `SPE60525R0222` (324110 / 9130) | 0 candidates on both tools. The Lockheed PAC-3 contradiction **did not reproduce**; nothing was fixed for it specifically. |

## Root causes → fixes
- **Confidence came from the textual score alone.** NAICS/PSC/sector reached only `groundIncumbent`. Now `reconcileMatchConfidence`: valid sector conflict → `low`; no NAICS or PSC agreement → at most `medium`; never raises; only verified identity lifts the sector constraint. Candidates carry `confidenceConstraint`.
- **`pscMatch` was false on every live candidate.** USASpending returns `PSC` as `{code, description}`; `String(obj)` was `"[object Object]"`. Now read from `.code`.
- **`findPredecessorAward` returned `hits[0]` with no evidence check** (feeds `find_predecessor_award`, bid/no-bid, the M-Estimate anchor, IncumbentIntel). Now refuses a sector-conflicted top candidate.
- Final selection (`groundIncumbent`) **unchanged**.

## Production after (hosted MCP, merge `826c2aab`)
- VA: `incumbent:null`; all 5 candidates `low` + `confidenceConstraint:"sector_conflict"`; `grounded_incumbent:false`.
- VA `find_predecessor_award`: `incumbent:null`, `grounded:false`.
- DLA: 0 candidates, no incumbent on either tool — no Lockheed.
- Positives, `supported` / `high` / `pscMatch:true` / `confidenceConstraint:null`: Palm Beach Harbor dredging `W912EP26BA011` → Weeks Marine (Z1KF, score 375); NRS St Paul janitorial `1240BE26Q0111` → Americlean (S201); WV grounds `W15QKN-26-Q-A110` → Joliva (S208). `find_predecessor_award` still returns Weeks Marine [high].
- Dossier `36C24226Q0857`: `incumbent:null`, `incumbent_financials:null`, `sections.financials:false`.
- Consistency: no candidate carries `high` alongside a sector conflict or a dual NAICS/PSC mismatch; mixed candidate lists (Joliva) show `medium`/`no_taxonomy_agreement` and `low`/`sector_conflict` beside the supported pick.
- Locks on merged main: Incumbent Evidence (19), P0 (11), P1 (9), P2 (8), Pursuit Dossier (13), Market Report Presentation (34), VA acceptance (13) — all green, no fixtures edited.

## Locks
`src/lib/usaspending/incumbent-evidence-truth.unit.test.ts` (13; each of the 3 fixes goes red when reverted) · live `scripts/acceptance/poteto-incumbent-evidence.mts`.

## Notes
- `find_predecessor_award` shows `pscMatch:false` for Weeks Marine because that MCP tool takes no PSC input — absent evidence, not a mismatch. Correct behavior.
- The acceptance suite is 19 checks; PR #1629 and its merge commit said "25/25". Miscount only — all checks passed.

## Deliberately unresolved (not this Poteto)
- Place-name tokens (`Orange`, `Lyons`) still count as distinctive hits; the structural cap stops them producing high confidence alone, but a same-NAICS award sharing only a place name could still be `supported`. Not reproduced; needs a place-name classifier, not a stoplist.
- No re-ranking: a contradicted candidate can still rank first and mask a clean second one (selection reads `prior[0]`).
- VA `incumbent_reason` cites guardrail 1 (no NAICS/PSC agreement), not the sector conflict — accurate; guard untouched.
- `find_predecessor_award` accepts no PSC argument, so PSC evidence is only available on the solicitation-number path.
