# Guards and steel buildings: why RC3 misses the 8/20 Direct floor (2026-11-15)

Agent 3, branch `agent3/guards-steel-diagnosis`, parent `5c5098165` (= `search-rc3-2026-11-15`). RC1/RC2/RC3 and
`agent3/rc3-candidate` are untouched. No new RC tag (Eric paused extra candidates).

**Evidence used:** the Nov 14 dev fixture (9,701 open notices); Agent 4's v4–v7 AI labels (two reviewers; Direct = FIT);
Eric's 47 expert judgments (`expert_regression_v1.jsonl`, research @ 58167ecbf). No sealed holdout material.
**Counting:** distinct solicitations, Direct only (Eric's 2026-11-15 rules). "6–8" = both reviewers say Direct – either does.
**AI labels; in-sample; diagnostic only.**

## Summary

| Business | RC3 Direct /20 | Ceiling in the labelled pool (distinct solicitations) | Root cause | Fixable by ranking? |
|---|---|---|---|---|
| Guards (short and long) | 6–8 | 6–8 | **Supply.** Every guard-coded solicitation on the snapshot is already in RC3's top 20 (ranks 1–9) | **No** |
| Steel short | 5–9 | 7–12 (Eric: +3) | (b) code-only Direct admits non-building items; (c) real steel-building jobs are filed under general building codes with evidence only in the description | Partly; no measured gain |
| Steel long | 4–7 | 7–12 | (a) the 500-row deadline window closes before four coded roofing notices; plus (b) | **Yes: 4–7 → 6–10 with F1+F3** |

**The 8/20 lower bound cannot be met on this snapshot by either business, whatever the ranking:** guards has 6 both-AI-Direct
solicitations in existence, steel has 7. That is a property of the Nov 14 market, not of RC3. Eric already moved guards to
the Dec 12 snapshot; steel will be decided the same way.

## Guards: supply ceiling

- The snapshot holds **13** notices under the guard codes (S206 / NAICS 561612), which are **9 distinct solicitations**.
  RC3 puts all 9 at ranks 1–9 (short and long are identical in this respect).
- Of those 9: **6 are Direct for both reviewers**, 2 are split (NAVSUP "Information Monitoring and Protection Services",
  R430, NO/FIT), and 1 is Not relevant for both (PANDHA "Security Support Services", R430).
- A full-text search of title, description and SOW for guard-service phrases outside the codes finds nothing Direct
  (93 hits: VA construction boilerplate "security officer / watchman", MSG cooking and food service, ship-support
  "guard service"). **No guard notice is being missed by retrieval.**
- Ranks 10–20 are filler (short: DLA items "28--GUARD,DIESEL ENGINE", "GUARD,PROPELLER"; long: "Armed Forces Career
  Center", CSOs). They cost no Direct slot, because nothing Direct is left to fill them. They are a precision and honesty
  issue for the customer, not a floor issue.
- Eric's 7 guards judgments agree: his one Direct (INSCOM ACES) is at rank 7; none of his 6 Not-relevant notices is in
  RC3's top 20.

## Steel: three causes, measured

**(a) Long only: the window truncates coded roofing notices.** The long description's text matcher admits 1,022 notices
("steel", "structural", "panels", "framing" → steel plate, steel poles, aircraft structural panels). The first 500 by
deadline close on 2026-12-01, so four 238160 roofing notices with later deadlines are never ranked: GAOA Mesa Falls
(FIT/FIT), Albuquerque IHS roof (FIT/FIT), FMC Lexington roof (PARTIAL/FIT), RF Roof Replacement (NO/PARTIAL). The short
phrasing (583 matched) ranks all four at 4–16. Same mechanism as the IT long diagnosis; the existing code-recall
sub-window covers product presets' PSC only, and steel has NAICS codes and no PSC.

**(b) Both: code-only Direct admits non-building items.** Under 238160 / 332311, RC3 makes these tier-0 Direct, all
NO/NO: "Gutter Maintenance" (J056), "GAOA Single Vault Toilet" (5410), "54--FLOOR,PORTABLE SHELTER". (Also "Market
Survey: modular, transportable buildings", NO/NO, which a title rule cannot separate.)

**(c) Both: real steel-building construction lives under general building codes.** Two of the 7 both-AI-Direct
solicitations, and 2 of Eric's 3 Direct, are 236220 / Y1 construction (F-15 AGE Facility, Vandenberg; Large Aircraft
Temporary Hangars, NAS JAX; Eric: Outdoor Fitness Facility). Their only evidence is in the description, so they land in
RELATED (short ranks 17, 74, 251). Tested and **rejected**: promoting a notice to Direct when its description says
"pre-engineered metal building / standing seam / metal roofing / steel building". Of the 16 labelled notices carrying
such a phrase, only **5** are Direct; 11 are partial jobs (hangars, labs, VA renovations) whose specs include a metal roof.
It would lower precision on both phrasings.

## Candidate fixes (dev branch only; not tagged, not deployed)

| | Change | Steel short | Steel long | Side effects on the other 24 phrasings |
|---|---|---|---|---|
| **F1** | NAICS code-recall sub-window: a trade preset's own 6-digit codes, drawn as a capped set (200) after the deadline window, only when that window is full. Subset of the matched set; count unchanged. `openCodeWindowNaics` + `queryOpenNow` (cheap form via `retrievalOpIndex`, now code-type aware) | unchanged (window not full of junk before them) | **+4 coded roofs enter the top 20** | Janitorial short 14–14 → **16–17** (+2 unlabelled; both custodial). **HVAC long 9–11 → 7–12, 3 unlabelled**: ten 238220 J041/Z1DA rows displace text-matched ones, some FIT/FIT. Net effect unknown until those 3 are labelled |
| **F3** | Steel only: a code-only Direct needs a trade object in the title (roof, building, shed, hangar, barn, structure, steel, metal, canopy, pavilion, warehouse); otherwise RELATED by code | 3 NO/NO leave tier 0; the slots go to more NO (USCG station, valves) → **5–9 unchanged** | removes the same 3 | none (scoped to the steel preset; guards' PANDHA stays Direct) |
| F1+F3 | | **5–9** | **6–10** | as F1 |

Eric's Not-relevant notices in any top 20 with F1+F3: **0** (as at RC3).

**Reading:** F1+F3 lift steel long by two on the lower bound and three on the upper bound. They do not reach 8 on the lower
bound because the snapshot has only 7. F3 is a precision fix that moves no Direct count here. F1 needs the three unlabelled
HVAC long notices labelled before it can be judged: it may cost HVAC long up to 2 Direct.

## What I would not do

- **Not** lower or reshape the floor in code, or pad guards with related work. The shortfall is the market's, and the gate
  should report it as such. Whether a business-level floor is waived when fewer than 8 Direct solicitations exist is
  Eric's decision, not a ranking change.
- **Not** promote description-only phrases to Direct (measured above: 5 of 16).

## Open items for Agent 4 / Eric

1. Labels for the 5 new unlabelled notices F1 brings in (HVAC long 3: "J041--Condensate Pump Replacement", "REPLACE
   CHILLER 1 B104", "Replace B28 AHU…"; janitorial short 2: "Custodial Services at Aviano Air Base", "Cleaning of MSGR
   guard and Embassy support staff assigned areas").
2. Floor policy when supply < 8 (guards 6, steel 7 on Nov 14). Dec 12 decides; this note only shows the ceiling.

## Reproduce

```bash
export PATH="$HOME/local/node-v24.13.0-darwin-arm64/bin:$PATH"
cd .claude/worktrees/agent3-steel     # this branch, own node_modules
RUNNER_FULL=1 npx tsx tasks/search-stabilization-2026-11-14/guards-steel-diagnosis/runner-full.mts run --src . \
  --snapshot <corpus.json (Nov 14 fixture)> --phrasings <holdout-runner>/fixtures/queries_v4.json \
  --cutoff 2026-11-15T00:52:58.895Z --today 2026-11-15 --out f13-full.json
```

`runner-full.mts` is holdout runner 1.1.0 plus two diagnosis-only additions: `RUNNER_FULL=1` writes the whole ranked
window, and the F1 NAICS sub-window is emulated when the source exports `openCodeWindowNaics`. Running it at
`5c5098165` reproduces RC3's published top 20 byte for byte.
