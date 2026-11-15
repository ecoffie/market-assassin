# Nursing (healthcare staffing): why both phrasings stay below 40% (diagnosis only, 2026-11-15)

Agent 3. Requested by Agent 5. No code change.

**Method:** holdout runner on the RC3 preview (34aad5828), using the Nov 14 snapshot (9,701 notices). The guard and A/C
do not change nursing.

**Labels:** Agent 3's v4–v6 labels: 6 nursing notices labelled relevant by at least one reviewer. Agent 4's v7 labels
are the real score: long 5/20.

| | short ("We provide nurses and medical staffing.") | long (healthcare staffing firm …) |
|---|---|---|
| interpretation | trade preset `nurse_staffing`: own PSC Q401, staffing vocabulary | same |
| matched | 47 | 344 |
| notices under the trade's own code Q401 | **3**, all DIRECT and ranked 1–3 | **3**, ranked 1–3 |
| labelled-relevant notices matched / in window / in top 20 | 4 / 4 / 1 | 6 / 6 / **0** |

## Finding 1: the market itself is thin (scarcity, not only ranking)

- Only **3** open notices carry Q401 (nursing services). Both phrasings already put all 3 at the top as DIRECT.
- Everything else a healthcare staffing firm could bid on is filed elsewhere:
  - Q701 "7 FTE Medical Technologists" (NAICS 561320 Temporary Help);
  - Q531 inpatient dialysis services;
  - Q201 occupational medicine and audiology;
  - Q999 "Commercial Non-Personal Healthcare";
  - Q501 CRNA services.
- Reviewers labelled these FIT or PARTIAL. If the snapshot holds fewer than 8 relevant open notices, **no ranking can
  reach 8/20**. That is the same family-scarcity question as guards, and it belongs in the top-20 rule decision (e.g.
  scoring against the relevant notices that exist, not a fixed 8).

## Finding 2: the adjacent healthcare-services notices rank BELOW unrelated description-only matches

- In the long phrasing, all 6 labelled-relevant notices are inside the 500 window, but none reaches the top 20.
- **The adjacent notices:** Q701 medical technologists is RELATED `description_text`. Q531 dialysis, Q201 occupational
  medicine and Q519 telebehavioral health are WEAK `no_evidence`. The trade path makes DIRECT only on its own code
  (Q401) or its staffing vocabulary, and it has no related family.
- **What fills ranks 4–20 instead:** RELATED `description_text` rows whose requirement text mentions "hospitals",
  "clinics", "medical facilities" or "nurse". Examples: contaminated soil disposal, solar panel maintenance, equipment
  transportation, Lean/HRO consulting, a nurse-call system and bed cables. Seven of these are labelled NO/NO.
- **Where those words come from:** "hospitals, clinics and medical facilities" is the "in …" clause of the query (WHERE
  the staff are placed), not what the firm sells. The long-list guard's modifier logic would classify them as
  modifiers. But the guard only acts on title evidence, and trade presets are out of its scope.

## Options (not built; each needs runner + Agent 4 v7 measurement)

**N1. Related family for the trade (largest ranking effect).**
- Give `nurse_staffing` a related market: healthcare-services PSCs (Q-family medical services, e.g. Q201, Q501, Q519,
  Q531, Q701, Q999) and NAICS 561320 / 621xxx.
- A family-coded notice whose title or description names clinical staff becomes RELATED at the product-code tier
  (offset 0), ahead of description-only text matches (0.1).
- This mirrors the product presets' "code retrieves, never DIRECT" rule. Q401 stays the only DIRECT code.

**N2. Modifier-only description evidence is NOT RELEVANT in long queries.**
- Extend the guard's modifier rule to requirement text. If the only words a description shares with the query are
  "where/for whom" words ("in hospitals, clinics and medical facilities"), the row is WEAK, not RELATED.
- This removes the soil-disposal and solar-panel class from ranks 4–20 for every long phrasing. It needs the same
  no-regression check as the guard.

**N3. Report scarcity honestly.**
- The release gate already counts "no business below 40%". For businesses where the open market holds fewer than 8
  relevant notices (nursing, possibly guards), a fixed 8/20 is unattainable.
- That is a gate-definition decision for Eric, not a code change.

**Recommended order:** N2, which is general and also helps other long phrasings, then N1. N3 goes to Eric with the
top-20 rule.
