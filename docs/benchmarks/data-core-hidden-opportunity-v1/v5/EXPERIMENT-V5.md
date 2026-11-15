# v5: blind scoring of Agent 3's retrieval steps 1 and 3 (2026-11-14)

**AI labels only** (two blind reviewers, Sonnet and Opus, v4 product rubric). In-sample on the v4 phrasings. Diagnostic only. Not a release verdict.
305 new items, plus 13 reused from v4. Reviewers agreed exactly on 299 and on relevant-vs-not on 301. Retrieval only: ranking was not changed or measured.

- **Compared:** production `7f328de91` vs Agent 3 commit `b449c043c` (local-only, branch `agent3/search-stabilization`; matched sets
  copied to `a3_matched_sets_step1_3.json`).
  - **Step 1:** frame verbs (supply/provide/sell…) and segment/role words (industrial/defense/supplier/distributor…) rank only.
  - **Step 3:** single-sentence lists split on like/such as/including and the final "and".
- **Emulation:** active and deadline after the snapshot, no 500-row window. Reproduces production counts for the 14 short phrasings.
- **Changes:** only product phrasings changed. Every service phrasing is identical.
- **Sampled:** a random 30 added rows per short phrasing, 20 per long phrasing, and 25 removed rows per phrasing (hash-seeded).
  Added and removed rows were shuffled together, so reviewers could not tell which was which.

## Recall (the goal of this step)

| Short phrasing | Code-floor recall (relevant retrieved / relevant in v4 floor sample) | v4 missed-notice set recovered |
|---|---|---|
| Valves | **0 → 18 of 23** | 18 of 23 |
| Fasteners | **6 → 20 of 25** | 14 of 19 |
| Medical | **4 → 10 of 24** | 6 of 20 |
| Electrical, aircraft, IT hardware, all services | unchanged | 0 |

Agent 3's own count is confirmed: 38 of 160 recovered. On the v4 gate's floor-recall measure, the pooled sample moves from 81 to about 119 of 241
(≈ 49%), still just under the 50% bar. Electrical (2 of 24) and aircraft (4 of 21) are untouched; they wait for step 2 (item noun and product code).

## Precision of what was added, and relevant work removed

| Phrasing | Added | Relevant in added sample | Est. relevant added | Removed | Relevant in removed sample | Est. relevant lost |
|---|---|---|---|---|---|---|
| Valves, short | 725 | **19–21 / 30** | ≈ 460–510 | 0 | — | 0 |
| Fasteners, short | 131 | 14–15 / 30 | ≈ 60–65 | 0 | — | 0 |
| Parts, short | 1,184 | 6–7 / 30 | ≈ 240–280 | 0 | — | 0 |
| **Medical, short** | 528 | **0 / 30** | ≈ 0 (the 6 recovered floor notices are among them, so ≈ 1%) | 0 | — | 0 |
| Parts, long | 423 | 10 / 20 | ≈ 210 | 163 | **11 / 25** | **≈ 70** |
| **Valves, long** | 82 | **0 / 20** | ≈ 0 | 0 | — | 0 |
| Medical, long | 54 | 0 / 20 | ≈ 0 | 531 | 0 / 25 | ≈ 0 (a clean-up) |
| **Electrical, long** | 0 | — | — | 18 | **6 / 18 (census)** | **6** |
| IT hardware, long | 0 | — | — | 50 | 4 / 25 | ≈ 8 |
| Aircraft, long | 0 | — | — | 62 | 0–1 / 25 | ≈ 0–2 |
| IT hardware, short | 0 | — | — | 42 | 0 / 25 | 0 |

Every relevant row removed is listed in `results/r5_relevant_lost.csv` (22 rows, with SAM links).

## What it means

1. **Step 1 works where the product noun carries the meaning.** Valves and fasteners gain hundreds of relevant notices at 50–70% precision of
   what is added, with no losses. Keep it.
2. **List splitting detaches the shared head noun, and that is a defect.** "medical, dental and laboratory supplies" becomes bare "medical" | "dental" |
   "laboratory supplies". Bare "medical" then admits medical services, construction at VA hospitals, security guards at CDC: 528 rows at 0/30.
   "gate, globe, ball, check, butterfly valves" likewise admits dredging, hull cleaning and a booster plant: 82 rows at 0/20.
   **Fix:** distribute the head noun to every listed modifier ("medical supplies", "dental supplies", "laboratory supplies"; "gate valve",
   "check valve"…). A modifier must never stand alone as a concept.
3. **Making role words rank-only removed real product buys on the long phrasings.**
   - **Parts:** 11 of 25 removed rows were relevant, about 70 notices, all clean DLA item buys ("47--HOSE ASSEMBLY,METAL", "16--CYLINDER ASSEMBLY",
     "48--VALVE, BUTTERFLY", an NSN-identified Virginia-class part).
   - **Electrical:** 6 of the 18 removed were relevant ("Magnetic Contactor", "CHASSIS,ELECTRICAL-", two "MODULE ASSEMBLY"). Agent 3's own check
     found 1, because it only looked at notices already labelled in v4.
   - These notices were reachable only through words that are now rank-only. **Step 2 (item noun plus FSC group) should recover them.** Until it lands,
     the long phrasings lose relevant work, and that loss is counted, not waived.
4. **"replacement parts" now matches 1,265 notices at about 20–23% precision**, against about 35–38% before on a far smaller set. The recall gain is real
   (≈ 240–280 relevant added). The burden moves to evidence labelling and ranking. Neither is measured in this round.

## Recommendation to Agent 3

- Keep step 1 for the short phrasings.
- Fix list splitting so the head noun is distributed before step 3 ships. Then I re-score medical and valves.
- Treat the parts, electrical and IT-hardware long-phrasing losses as a blocker for shipping step 1 on long phrasings, unless step 2 lands in the same release candidate.
  I score them blind again when it does.
- Send the matched sets for each change in the same format; this harness re-scores in one pass (`scripts/plan_r5.py` → `build_r5.py` → label → `score_r5.py`).

## Files

`a3_matched_sets_step1_3.json` (Agent 3's sets) · `r5_plan.json` · `labels/` (both reviewers + `r5_meta.json`) · `results/r5_eval.json`,
`results/r5_relevant_lost.csv`, `results/r5_rows_min.jsonl` · `scripts/` (plan, read-only fetch through `v4/scripts/bench-env.mts`, build, score).
The full notice text (`r5_rows.jsonl`) and the label sheets are reproducible and not committed, as in v4.
