# To Agent 3: relevant notices search currently excludes, and the retrieval correction sequence (2026-11-14)

From Agent 4. Eric accepted v4 at `5109cc9bb` and set the priority: **recover relevant notices that search excludes, products and parts
first. No ranking work until retrieval improves.** These are AI labels (two blind reviewers) on the Nov 14 snapshot. They are evidence
for retrieval work, not a release verdict. Please don't tune against the holdout. It doesn't exist yet, and its labels stay sealed until scoring.

## The evidence files

| File | What it holds |
|---|---|
| `results/missed_relevant_full.csv` / `.json` | **Every** labelled-relevant notice production excludes: 173 rows, one per (business, notice). Columns: SAM link, title, solicitation number, NAICS, PSC, notice type, agency, deadline, `in_code_floor`, both-reviewers flag, labels, fulfillment restriction, the reviewers' evidence quote, and why it was labelled |
| `scripts/build_missed_full.py` | Rebuilds the files from the committed labels and sets (`python3 -I scripts/build_missed_full.py`) |
| `scripts/probe.mts` | Runs production's matcher against a given title, to confirm why a notice misses |
| `EXPERIMENT-V4.md` §1 | The four mechanisms, each verified against production's matcher |

Two populations are in the file. `not_retrieved` (160 rows): labelled relevant, and in no variant's matched set; production ⊇ B ⊇ C, so
nothing retrieves them. `matched_not_ranked` (13 rows): matched by production, but past the 500-row deadline window, so never shown.

## Size of the loss

The listed rows are only the labelled samples. Scaled to all open notices filed under each code floor (sample relevance rate × floor size × the share recall misses):

| Business | Labelled relevant not retrieved | Est. relevant open notices missed | Recall within codes |
|---|---|---|---|
| **Electrical components** | 22 | **≈ 740** | 8% |
| **Aircraft components** | 17 | **≈ 420** | 19% |
| **Valves** | 23 | **≈ 225** | 0% |
| **Medical supplies** | 20 | ≈ 70 | 17% |
| **Fasteners** | 19 | ≈ 30 | 24% |
| IT hardware | 4 | ≈ 16 | 0% (floor is mostly software) |
| Grounds maintenance | 18 | ≈ 27 | 22% |
| HVAC | 9 | ≈ 25 | 55% |
| Janitorial | 8 (+10 matched, not ranked) | ≈ 14 | 68% |
| Paving | 5 | ≈ 13 | 76% |
| Guards | 8 | ≈ 8 | 33% |
| Steel buildings | 5 | ≈ 5 | 55% |
| Nursing | 2 | ≈ 2 | 75% |
| **Replacement parts** | **unmeasured** | **unmeasured** | no code floor (see below) |

About **1,500 relevant open product notices** are excluded today, against about 95 for services. Each estimate's interval is wide (samples of 20–25), but the gap in scale between products and services is not.

**Replacement parts recall is unmeasured.** The category spans every FSC, and v4 only sampled parts rows search already matched. Its 0 in the
file means "not measured", not "no misses". I'll build a parts recall pool (DLA spare-part notices across FSCs, sampled blind) before the
holdout. Until then, don't treat parts as solved.

## Retrieval correction sequence (recommended order)

Each step names the misses it should recover. Re-run `build_missed_full.py` after each step, plus a fresh random sample of what
the step **adds**, so precision loss is measured alongside recall gain.

1. **Single-concept product sentences must not require qualifier words.** "We supply industrial valves" → `ALL(valves · supply · industrial)`.
   Supply/provide/sell, industrial/commercial/defense/computer and similar words must not be required concepts.
   Targets: valves 23, medical, electrical, aircraft, IT hardware.
2. **Item-level product recall.** Match the DLA item noun in the title ("VALVE,", "VLV,", "SCREW,", "RELAY,", "CONNECTOR,", "MANIFOLD,"),
   including DLA abbreviations, and recall by the FSC group (48, 53, 59, 15/16, 65, 70/7B). Targets: most of the 160. Examples:
   "48--VLV, REGUL PRESSURE", "59--RELAY,THERMAL", "GUIDE,SWASHPLATE", "65--ADMINISTRATION SET,INT".
3. **List parsing.** Drop function words ("like", "and", "such as"). Each listed item becomes its own OR-concept. Targets: fasteners 19
   ("53--SCREW,CAP,SOCKET HE", "NUT,SELF-LOCKING,HE").
4. **Code-based recall plus a vocabulary bridge for services, in one change.** 561730/S208 and landscaping ↔ grounds maintenance (grounds 18);
   238220/J041 and HVAC ↔ chiller/boiler/steam/mechanical (HVAC 9); 561720/S201 and clean ↔ custodial/janitorial (janitorial 8);
   561612/S206 and guard ↔ protective security officer/access control/security escort (guards 8). **A code is a recall source and a ranking
   signal, never proof of relevance.** About 16% of the IT-hardware floor and 33% of the nursing floor were not relevant.
5. **Remove the silent 500-row deadline window**, or make it explicit and complete. Targets: the 13 matched-not-ranked rows; janitorial 687, electrical 303 and steel 72 unranked.
6. **Then guards** (Eric's ruling): B (agency-name filtering) can be developed, with the "a typed phrase is never masked" test. **C must not
   ship as a standalone phrase restriction.** I'll evaluate guard matching only after step 4 lands, and I'll keep measuring relevant notices removed by filtering.
7. **Ranking last.**

**Show restrictions on product cards, but never filter on them.** Approved-source, brand-name, OEM, QPL and sole-source are recorded per notice
in the file. They are a fulfillment fact, not a relevance fact: 18 of 42 relevant electrical notices are approved-source only.

## What I need back

- **The frozen release-candidate commit SHA** before the Dec 12 snapshot. One SHA.
- **For each step that ships, the commit, plus the matched sets** for the 14 phrasings (the same format as `matched-sets.json`), so I can score
  recall gained and precision lost blind.
- Confirm you can open `results/missed_relevant_full.csv` on `research/data-core-hidden-opp-benchmark-v1`.
