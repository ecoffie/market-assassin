# v6: blind scoring of Agent 3's release-candidate retrieval `1b7f3c129` (2026-11-14)

**AI labels only** (two blind reviewers, Sonnet and Opus; v4 rubrics plus the full business description). In-sample on the v4 phrasings. Diagnostic only.
**Not a release verdict.** 570 new items, plus 321 reused from v3–v5. Reviewers agreed exactly on 535 of 570 and on relevant-vs-not on 549 (96%).
Agent 3's matched sets are copied to `a3_matched_sets_rc.json`. Baseline is production `7f328de91`.

## 1. Retrieval: recall

- **Agent 3's counts confirmed:** 120 of the 160 v4 missed notices are recovered on the short phrasings.
- **Within the trade's own codes**, pooled over the v4 floor samples, recall is **182 of 222 (82%)**. Production was 34%.
  - At or near 100%: valves, fasteners, aircraft, grounds, guards, HVAC, janitorial.
  - Electrical 11 of 24, medical 13 of 24.
  - IT hardware, nursing, steel buildings and paving are unchanged.
- ⚠️ **The recall gate leg is now close to passing by construction.** The candidate retrieves by the same codes that define the floor. The holdout must
  also measure **relevant notices outside those codes** (added to the protocol below). Otherwise the 50% leg certifies nothing.

## 2. Retrieval: precision of what the candidate adds, and relevant work removed

| Phrasing | Added | Relevant in added sample | Est. relevant added | Removed | Relevant in removed sample |
|---|---|---|---|---|---|
| Valves, short / long | 768 / 362 | 21–22/30 · 16/20 | ≈ 540–560 · 290 | 0 | — |
| Electrical, short / long | 447 / 247 | **25/30** · 16/20 | ≈ 370 · 200 | 0 | — |
| Aircraft, short / long | 408 / 475 | 23–25/30 · 14–15/20 | ≈ 310–340 · 330–355 | 0 | — |
| Fasteners, short | 155 | 18/30 | ≈ 95 | 0 | — |
| Parts, short | 1,184 | 9/30 | ≈ 355 | 0 | — |
| **Medical, short** | 353 | **3/30** | ≈ 35 | 50 | 1/25 |
| Medical, long | 62 | 15–19/20 | ≈ 45–60 | 0 | — |
| Grounds, short / long | 38 / 35 | 22–24/30 · 17–20/20 | ≈ 30 · 30–35 | 0 | — |
| Guards, short / long | 9 / 9 | 6–8/9 · 3–5/9 | 6–8 · 3–5 | 0 | — |
| HVAC, short / long | 68 / 22 | 11–18/30 · 3–9/20 | ≈ 25–40 · 3–10 | 0 | — |
| Janitorial, short | 30 | 19/30 | ≈ 19 | 0 | — |
| IT hardware, short | 0 | — | — | 42 | 0/25 |

- **About 2,700 relevant notices added** (lower bound), and essentially nothing relevant removed: one row on medical short, about 2 notices scaled.
  Your rule ("keep measuring relevant notices lost by filtering") is met on this sample.
- **Medical short is the one weak spot.** `ALL(medical·supplies)` admits notices where the two words occur apart: a sleep-lab computer, pressure washing,
  RRC services. 3 of 30 added rows are relevant. The fix is a phrase or proximity requirement, or the FSC 65 item noun, for this sentence shape.

## 3. Ranking: top-20 (ranking and classification unchanged, as Agent 3 said)

| Short phrasing | Production (v4) | Candidate | Short phrasing | Production (v4) | Candidate |
|---|---|---|---|---|---|
| Valves | 10–13 | **20** | Fasteners | 7–8 | 7–8 |
| HVAC | 16–17 | 16–17 | Electrical | 9 | **7** ↓ |
| Paving | 15–17 | 15–17 | Aircraft | 9–11 | **4–7** ↓ |
| Grounds | 12–13 | 12 | Medical | 6–7 | **4–5** ↓ |
| Parts | 5–6 | 7–8 | Nursing | 6–8 | 6–8 |
| Steel | 3–4 | 3–4 | Janitorial | 2–3 | 2–3 |
| Guards | 2 | 2 | IT hardware | 0 | 0 |

**Pooled 37.5–42% (production 36–42%). 10 of 14 below 40%.** The gate fails on ranking alone. Every top-20 row is labelled DIRECT. The irrelevant ones are:

- **Incidental words** (classification): Coast Guard / Marine Security Guard / National Guard, plus "GUARD,BRUSH" parts (guards 18 of 20);
  grease-trap, hull, laundry and clean-room "cleaning" (janitorial 17 of 20); "electrical" inside construction or ship repair (electrical).
- **Repair notices, not supply:** "16--WHEEL HALF,AIRCRAFT, IN REPAIR/MODIFICATION OF", "FUEL CELL,AIRCRAFT … return to RFI". 13 of 20 on aircraft
  short. Both reviewers, applying the rubric, judged repair work not relevant for a supplier. ⚠️ **Eric decides** whether a parts supplier's search
  should include DLA repair/overhaul notices. If yes, the rubric changes and these become relevant.
- **Unrelated DLA items** reaching DIRECT on electrical and aircraft-long ("53--HELICAL SPRING", "53--KEY", "36--CANISTER", "PARTS KIT,BALL VALV").
  They appear to match on boilerplate such as "replacement parts" or "components". Agent 3 to diagnose.

## 4. Fulfillment restrictions among relevant added product rows

Approved-source restrictions are common: valves short 10 of ~22, electrical short 11 of 25, fasteners 9 of 18, aircraft short 7 of ~24, plus QPL, OEM-only,
brand-name and sole-source. Show them on the card. Never filter on them.

## 5. Recommendation

1. **Retrieval:** the candidate is a large, essentially lossless improvement on this sample. Fix medical short (phrase, proximity or item noun) before freezing.
2. **Next is classification, then ranking.** Retrieval has improved enough that the top-20 is now the binding constraint:
   - DIRECT must not be awarded for an organization name, a different object of the same verb, or a part named "GUARD,".
   - Code-and-item-noun rows should outrank incidental-word rows.
   - Repair vs supply waits on Eric's ruling above.
3. **Holdout protocol addition:** an off-code recall pool. A random sample of relevant notices outside each business's codes, found by the union of
   variants plus a blind probe, so the recall leg measures more than the code list.

## Files

`r6_plan.json` · `labels/` (both reviewers plus `r6_meta.json`) · `results/r6_eval.json` · `scripts/r6.py plan|build|score` · `scripts/fetch_rows.mts`
(read-only, credentials via `v4/scripts/bench-env.mts`). The notice text and sheets are reproducible and not committed.

## Addendum: medical rc2 variants (`761b8d73b`), scored blind the same day

The short medical phrasing now matches shared list items as adjacent phrases. The long phrasing is unchanged except for PSC 6505.
45 new items (two reviewers; 38 of 45 agree on relevant-vs-not, so the ranges are wider). Script: `scripts/r7_medical.py`; results: `results/r7_medical_eval.json`.

| Medical | Matched | Added vs production | Relevant in added sample | Est. relevant added | Removed vs production | Relevant in removed sample | Est. relevant lost |
|---|---|---|---|---|---|---|---|
| rc1, short (v6) | 459 | 353 | 3/30 | ≈ 35 | 50 | 1/25 | ≈ 2 |
| **rc2_phrase**, short | 134 | 118 | 13–22 / 36 | ≈ 43–72 | 140 | 2/30 | **≈ 9** |
| **rc2_phrase_6505**, short | 155 | 135 | 13–23 / 40 | ≈ 44–78 | 136 | 1/29 | **≈ 5** |
| rc2_phrase, long | 1,290 | 62 | 11–18 / 19 | ≈ 36–59 | 0 | — | 0 |
| rc2_phrase_6505, long | 1,308 | 80 | 12–19 / 25 | ≈ 38–61 | 0 | — | 0 |

- **rc2 fixes the precision problem:** added rows go from about 10% relevant to about 35–60%. Production's own short-medical matches were mostly noise: rc2 drops 140
  of production's 156, and only about 1 in 15 of the dropped rows is relevant.
- **Cost:** about 9 relevant notices lost with `rc2_phrase` (sample: "Q301 Automated Blood Bank Solid Phase Analyzer", "Epinephrine Injector"), and about 5 with `_6505`.
- **What PSC 6505 adds on its own:** 21 rows on short and 18 on long. About 1 of the 10 sampled is relevant. It wins back the epinephrine notice but mostly adds
  drugs and biologicals that a medical-supplies business does not sell.
- **Recommendation:** `rc2_phrase` as the default. Recover injector-type items through their item noun, not the whole FSC 6505. Whether "medical supplies" includes
  pharmaceuticals is a scope ruling for Eric. If yes, `_6505` is slightly better on both added and lost. The difference between the two is within sampling error.
