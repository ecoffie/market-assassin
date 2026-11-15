# Audit of Eric's previous expert reviews (2026-11-15)

**Requested by Eric before any new human review is assigned. Nothing new has been sent to Eric for review.**

## Findings

| Question | Answer |
|---|---|
| How many opportunities Eric previously reviewed | **47** judgments on 47 notices, in one sitting on 2026-11-14 (saved 18:08–20:12 UTC) |
| Any other review exercises | **None found.** The searches covered every benchmark folder (v1–v7) and `v2/labels_v2.jsonl` (0 human rows), Agent 3's fixtures at the RC3 tag, `~/mindy-release-private`, `~/mindy-bench-sealed` and both repos' task folders. The 8 product calibration answers and the guards spot-check were never sent to him |
| Where they are stored | `labels.jsonl` (`human_label`, `human_decision`, `human_notes`, `human_saved_at`), committed `41b6e3be6`. Also the v1 review page's database (`reviews`, 47 rows): re-read today, identical to the file 47/47 |
| Stable solicitation IDs | **Yes, 47/47.** Each has a SAM notice_id and a solicitation number |
| Business descriptions preserved | **Yes, 47/47.** The text Eric judged against is identical to today's full description for all 6 businesses (HVAC 12, steel buildings 17, guards 7, janitorial 5, parts 4, nursing 2) |
| Rubric fit | v1 FIT ("the main work bought is this business's service") = **Direct**. PARTIAL ("a real, explicitly stated component of a bigger job") = **Related**. NO = **Not relevant**. They map one-to-one |
| Reusable | **46**: 18 Direct, 10 Related, 18 Not relevant |
| Disputed | **1**: S30 (`4c7574e2`, "61--DISTRIBUTING SYSTEM, IN REPAIR/MODIFICATION OF", parts). Eric said Related; his own ruling 1 the same day says repair is not supply for a parts-only business. It is also calibration item C15. **It needs one ruling from Eric (≈ 30 s)** |
| Missing or unusable | **0 missing.** The 278 other v1 rows were never human-reviewed: they are AI-only and were never claimed as his |
| Exposed to Agent 3 | **All 47.** They have been on the research branch since 2026-11-14, which Agent 3 can read. `HUMAN-REVIEW-RESULTS.md` (same commit) shaped the gate-sentence design both agents adopted. No code at the RC3 tag reads them: there are no references outside `docs/benchmarks`. Agent 3's `tests/fixtures/anyword-matching-2026-11-14/labels.json` (403 keys) is Agent 3's own blind labelling of different query keys, not Eric's |

**Dataset:** `expert_labels.jsonl` (47 rows, built by `build_expert_regression.py`).
Each row carries the notice and solicitation IDs, both business phrasings, Eric's raw and mapped labels, notes, timestamp, sample type (S random / R recovered / G gate), status, exposure, the v7 AI labels, and RC1/RC2/RC3 top-20 membership.
It is **development material only**. It is never mixed into the sealed holdout (`~/mindy-bench-sealed/`).

## What the prior labels can and cannot replace

- **They cannot replace any holdout judgment.** The holdout is notices posted after the freeze, snapshot Dec 12. All 47 were posted on or before Nov 14 and are exposed, so none can appear in it. This is by design (Eric's leakage rule), not data loss.
- **They already replace Eric's calibration.** 12 of the 20 calibration items are his own v1 judgments. Eric should not redo them. Only the verifier calibrates. Eric confirms the 8 product answers (≈ 5 min) and rules on S30/C15.
- **They overlap the RC3 benchmark lightly:** 8 sit in some RC3 top-20 and 21 are in the v7 AI-labelled pool. On those 21, the AI agrees with Eric 19 times.
  The two disagreements are G04 (HVAC: Eric Direct, AI No) and S14 (steel: Eric Related, AI No). Neither is in any candidate's top 20, so no reported number changes.
- **The guards spot-check and the 8 product calibration items share no notices with his 47.** So they are genuinely new.

## Why the earlier work was not reused (evidence-supported)

1. **The v4–v7 AI benchmark never merged Eric's labels as overrides.** The scorer (`v6 r6.load_labels` → `v7 r16.py`) loads the two AI reviewers plus 3 rubric adjudications only. Eric's 21 overlapping judgments were ignored.
   They were joinable all along: both key on (business, notice_id). This was Agent 4's omission. It changed no reported number (the 2 disagreements are outside every top 20), but it should have been done.
2. **Revision 2 of the holdout protocol budgeted "the 20-item calibration (≈ 15 min)" for Eric.** 12 of those 20 are his own earlier judgments. Revision 1 correctly gave calibration to the verifier, and the wording drifted. Corrected here.
3. **Not a failure:** excluding the 47 from the holdout. They are pre-freeze and exposed, so using them would break the independence Eric required.

## Actual new judgments needed from Eric (RC3 only, Eric's 2026-11-15 rules)

The overall 60% now counts **Direct only** (Eric's RC3 brief). On the AI preview that puts RC3 at 62–70%, near the bar, which lengthens the pooled leg. Re-simulated: `v7/scripts/holdout_load_v3.py --pooled-direct` and `v7/scripts/holdout_stage1_sim.py`.

| Step | New judgments | Eric's minutes |
|---|---|---|
| Rule on S30/C15 (repair) | 1 | ≈ 0.5 |
| Confirm 8 product calibration answers | 8 | ≈ 5 |
| Guards spot-check (optional; the holdout census decides guards anyway) | 10 | ≈ 5 |
| **Stage 1, fail-first (Dec 12 snapshot):** census of guards and steel buildings' Direct floor | **≈ 32** (p10–p90 27–38) | **≈ 16–24** |
| Stage 2, only if guards and steel both pass: the rest of the RC3 protocol | ≈ 200 more (≈ 232 total, p10–p90 197–284) | ≈ 100–150 more |

- **Why fail-first:** Eric ruled that RC3 fails if guards or steel buildings fail. On the Nov 14 AI preview, guards has 6–8 Direct of 20 and steel 5–9. In simulation, at least one of them fails in **≈ 90%** of runs (guards 79%, steel 53%).
  If one fails in Stage 1 (verified by the independent reviewer on those ≈ 32 items), RC3 has failed and Stage 2 is unnecessary.
- **Expected Eric time before the RC3 decision:** ≈ 25–35 min (Stage 1 + the confirmations), not 100–150 min.

## Decisions needed before any review starts

1. Rule on S30/C15: is a parts "IN REPAIR/MODIFICATION OF" notice Not relevant (ruling 1) or Related (your Nov 14 label)?
2. Approve fail-first staging: guards and steel first, and stop if either fails.
3. Recall gate: does within-code recall count Direct only, or Direct + Related?
4. Guards on the Dec 12 snapshot or Jan 9? December has few guard notices. The earlier plan deferred guards and nursing to Jan 9, but with guards now decisive, the date decides when RC3 can be called.
5. The independent reviewer, and their pay.

## Eric's decisions (2026-11-15, recorded by Agent 4)

1. **Fail-first staging approved.** Judge guards and steel buildings first, and stop if either fails (once the independent reviewer confirms).
2. **S30/C15: Not relevant.** Ruling 1 is upheld: a repair/modification notice is not relevant for a parts-only supplier. `expert_labels.jsonl` now has **47 reusable** (18 Direct, 10 Related, 19 Not relevant). The sealed calibration key C15 is now NO, and its kind is corrected to product.
3. **Recall gate counts Direct only.** All three gates are now Direct-only: overall ≥ 60%, per business ≥ 40%, within-code recall ≥ 50%. Related is reported separately.
4. **Guards is judged on the Dec 12 snapshot.** RC3 can be decided in December. If Dec 12 holds fewer than 20 distinct guard solicitations in RC3's top 20, the floor is ceil(40% × distinct shown). The thin volume is reported with the result.

Still open: the independent reviewer (name, pay ≈ $110–150), confirming the 8 product practice answers, and the optional guards spot-check.

## Now in use (2026-11-15)

- **Permanent store:** `expert_labels.jsonl`, append-only. The one-time builder refuses to overwrite it.
- **The scorer uses it.** `v7/scripts/r16.labels()` applies Eric's labels last. `check_expert.py precedence` gives 47/47 from Eric, 0 violations. No previously reported RC number changes, because neither AI disagreement is in a top 20.
- **No re-asking:** `expert.filter_new()` is required before any human review sheet. The guards spot-check and the 8 product calibration items have zero overlap.
- **Regression check:** `check_expert.py candidate`. On RC3, none of Eric's Not-relevant notices reach the top 20, but 5 of his Direct notices (3 parts, 1 nursing, 1 HVAC) are never retrieved by any version. See `README.md`.

## Eric's decisions, second set (2026-11-15)

5. **Thin-market floor.** When fewer than 8 Direct solicitations exist for a business on the snapshot, the business passes the per-business floor if the top 20 contains **every** Direct solicitation that exists (floor = min(8, Direct available)).
   Applied as written: the denominator stays the top 20, and no related work is padded in.
   **Holdout consequence:** to use this rule, the number of Direct solicitations that exist on Dec 12 has to be established by humans, not assumed. For guards that means Eric judges every guard-coded notice plus the full-text guard-phrase candidates outside the codes.
   On Nov 14 that was 13 coded notices (9 solicitations) and ~93 phrase hits, nearly all obvious non-matches. So expect ≈ 15–25 extra guard judgments in Stage 1. The same applies to steel if it falls under 8 available.
6. **Steel ranking change approved for development:** within the top-20 sort, rank RELATED rows that carry real steel-building wording in the description above code-only and filler rows, without relabelling them Direct.
   Agent 3 builds it on a dev branch. Agent 4 scores it independently. No tag or release.
