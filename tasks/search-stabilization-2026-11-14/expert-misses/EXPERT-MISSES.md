# The 5 Eric-Direct notices no version retrieves — gate by gate (2026-11-15)

Branch `agent3/expert-misses`, parent `5c5098165` (RC3). Dev only; no tag; RC1/RC2/RC3 untouched.
Source: Agent 4's expert regression set (`expert_labels.jsonl`, research 489e28364) and `check_expert.py`. The Nov 14
fixture, the holdout runner (1.1.0 + full-window dump), labels with Eric's precedence. No sealed material.

`check_expert` at RC3 lists 8 misses (per phrasing), which are 5 distinct notices.

| Notice | Phrasing | Gate that drops it | Minimal change | Result |
|---|---|---|---|---|
| nursing `7292f1b6` BOP FCC Pollock optometrist services | both | **Not open data:** `active=false` in `sam_opportunities` (its only version; deadline 2027-08-31). Absent from the fixture, and FIND Open keeps `active=true` (frozen rule) | **None.** The active rule is frozen; SAM marked it inactive | stays missed (2 of 8) |
| HVAC `28d5fb2c` CRAC Units Replacement, Grand Forks | short | **Text + preset + code:** says "Computer Room Air Conditioner", but the HVAC vocabulary has only "air conditioning", the short matcher's only term is "hvac", and it is filed N099 / 236220 (not 238220 / J041). The long phrasing already retrieves it | **H1** (`27d3ac9d6`): HVAC vocab + "air conditioner(s)" | **retrieved**; HVAC matched 279→282 / 723→725; **no top 20 changes in any phrasing** |
| parts `f8b01216` 48--VALVE,THROTTLE | both | **Text matcher; no preset.** "parts" is a literal search. Short needs "replacement" AND "parts"; long needs "supplier" or other list words. The notice says only "Proposed procurement for NSN …" | see below | not fixed |
| parts `c29f7956` 31--BEARING,BALL,ANNULA | both | Same as the valve ("NSN …; this part requires engineering source approval") | see below | not fixed |
| parts `8fb40125` 53--KNOB - AND OTHER REPLACEMENT PARTS | long | **Text matcher:** the long phrasing demotes "replacement" and "parts" to rank-only terms, so its title match does not retrieve. The short phrasing retrieves it (rank 1) | see below | not fixed |

## Parts: two retrieval changes measured, both REJECTED

| | Change | Misses retrieved | Parts top 20 |
|---|---|---|---|
| P1 (`d00e41ab9`, reverted) | "replacement / spare / repair parts" product preset, FSC groups 10–59 as retrieval codes | all 3 parts misses | **destroyed:** matched 1,265→5,733; the window fills with "NN--PARTS KIT" product-code rows; 0 of 20 labelled |
| P2 (reverted) | Same preset, no codes; vocabulary "replacement parts / spare parts / NSN / national stock number" over title + description | all 3 parts misses | **destroyed:** matched 1,265→5,534; 496 of the 500 window rows are WEAK ("NSN" is boilerplate to the evidence classifier); the Direct "REPLACEMENT PARTS" title rows are pushed out of the deadline window |

**Root cause:** for a generic replacement-parts supplier, the misses are ordinary DLA NSN item buys. About 4,600 of the
9,701 open notices are such buys. They are indistinguishable by text from the rest, apart from "NSN" (which the classifier
correctly reads as boilerplate). Any retrieval widening runs into the 500-row deadline window. No minimal retrieval change
closes this without making the top 20 worse.

**What would close it is a product decision, not a matcher tweak.** Is every DLA NSN item buy in the hardware groups Direct
for "We supply industrial and defense replacement parts"? Eric said yes on all 3 he judged; the AI reviewers said Direct on
25 of the 28 labelled NSN extras. If yes, the parts preset would label those rows Direct, and the top 20 becomes the
soonest-closing NSN buys. That trades the current "REPLACEMENT PARTS"-titled top 20 for a far larger, deadline-ordered
market. It needs Eric's ruling before anyone builds it.

## Net

- **H1 is the only change worth keeping:** 1 miss closed, zero top-20 change.
- Not fixable by retrieval: nursing (inactive in SAM) and parts (a product scope question).
- After H1, `check_expert` misses drop from 8 to 7.
