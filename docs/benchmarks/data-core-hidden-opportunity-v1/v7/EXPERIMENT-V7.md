# v7: AI-label preview of RC1 vs RC2 top-20 (2026-11-14)

**Diagnostic only.** AI labels (two blind reviewers, Sonnet and Opus), in-sample on the benchmark phrasings, Nov 14 snapshot. **Not the human holdout and not a
certification.** It tells Eric and Agent 3 what the holdout is likely to find. 182 new items, all double-labelled (relevant-vs-not agreement 177/182 = 97%),
plus labels reused from v3–v6. `RUBRIC-ADDENDUM-2026-11-14` rulings and adjudications applied.

- **RC1:** tag `search-rc1-2026-11-14` (`8c4ba2ea1`).
- **RC2:** tag `search-rc2-2026-11-14` (`065451a66`). Verified annotated; four commits on RC1: evidence classification/ranking, the pharma rule, and an
  unwired cache library. Matched sets are identical to RC1 on all 28 phrasings, so only labels and order differ.
- **Top-20:** Agent 3's FIND emulation (500-deadline window, ties by notice_id).

## Top-20 relevance (relevant = FIT or PARTIAL; lower–upper bound across reviewers)

| | RC1 | RC2 | Gate |
|---|---|---|---|
| Short phrasings, pooled | 38–42% | **67–74%** | ≥ 60% |
| Long phrasings, pooled | 41–45% | **62–66%** | ≥ 60% |
| Short businesses below 40% | 10 of 14 | **4**: nursing, steel buildings, replacement parts, IT hardware | none |
| Long businesses below 40% | 8 of 14 | **4**: the same four | none |

| Short phrasing | RC1 | RC2 | Long phrasing | RC1 | RC2 |
|---|---|---|---|---|---|
| Janitorial | 2–3 | **17** | Janitorial | 7 | 13 |
| Guards | 2 | **10–12** | Guards | 4 | 11–13 |
| Fasteners | 7–8 | **20** | Fasteners | 5 | 19 |
| Electrical | 7 | **19** | Electrical | 9 | 20 |
| Aircraft | 4–7 | **16–18** | Aircraft | 0–1 | 14 |
| Medical | 5–6 | **15–20** | Medical | 5–7 | 16–17 |
| Grounds | 12 | 17 | Grounds | 12–14 | 17–20 |
| HVAC | 16–17 | 18–19 | HVAC | 16 | 16–17 |
| Valves | 20 | 20 | Valves | 14–16 | 16–18 |
| Paving | 15–17 | 15–17 | Paving | 18–19 | 15–17 |
| Nursing | 6–8 | 6–8 | Nursing | 2–4 | 6 |
| Steel / roofing | 3–4 | 6–7 | Steel / roofing | 3–5 | **2–3** |
| Replacement parts | 7–8 | 7–8 | **Replacement parts** | **18** | **6** ↓ |
| IT hardware | 0 | 2–4 | IT hardware | 1–2 | 2–3 |

## Classification (evidence labels)

| | DIRECT rows in top-20 | DIRECT rows relevant | Rows in "other"/related | Relevant among them |
|---|---|---|---|---|
| RC1 | 560 (every row) | 220 (39%) | 0 | — |
| RC2 | 479 | **326 (68%)** | 81 | 35 |

- RC2 no longer calls Coast Guard, grease-trap or HM&E rows DIRECT.
- RC2 under-calls DIRECT for medical short (4 DIRECT, 15–20 relevant), paving short (3 DIRECT, 15–17 relevant) and nursing short. Relevance is unaffected,
  but the card's label understates the match.

## What still fails, and why

1. **Replacement parts, long (18 → 6).** The paragraph names "military equipment, vehicles, aircraft". RC2 now promotes whole-vehicle and site buys to DIRECT and to the top:
   "Mobile Tactical Cannon – Tracked" (×5), "Access Control Point … Vehicle Barrier" (×2), "Supply and delivery of 2 new Right-Hand Vehicles", a vehicle lift.
   A parts supplier sells parts *for* vehicles, not vehicles. All 18 relevant RC1 rows dropped out of RC2's top-20.
2. **The same notice repeated in the top-20:** the MTC-T notice 5 times, ACP 2, TS2 2. Collapsing one solicitation's versions and amendments to one row
   would free those slots. This affects any business.
3. **Nursing:** incidental "nurse"/"nursing" ("Nursing Practice Oversight Course" ×3, nurse-call construction, bed cables).
4. **Steel buildings:** steel *products* (plates, poles, scrap sales, gas cylinders) rank for an erection contractor.
5. **IT hardware:** IT *services* (network/cyber support, licences) rank for a hardware reseller. The in-code pool is itself mostly services (v4 note).

## What this means for the holdout

- On this preview RC2 would likely clear the pooled 60% leg and earn Tier 2.
- It would likely **fail the per-business 40% leg on four businesses**, so certification would fail unless those are fixed.
- RC2 is frozen. A fix would be a new tag (RC3), and evaluating a third candidate on the Dec 12 holdout is Eric's decision.
- Human labels may differ, especially on the "related" calls. This preview certifies nothing.

Files: `a3_matched_sets_rc2_classification.json` (Agent 3's file), `labels/` (both reviewers plus `r8_meta.json`), `results/r8_eval.json`, `scripts/r8.py`, `scripts/fetch_rows.mts`.

## Addendum: RC3 development preview (`agent3/search-rc3` @ `34aad5828`, NOT tagged, not a holdout candidate unless Eric approves)

89 new items (two reviewers, 82 of 89 agree on relevant-vs-not). Script: `scripts/r9.py`; results: `results/r9_eval.json`.
RC3 changes vs RC2:
- IT hardware: hardware PSCs plus a strict item rule.
- Duplicate solicitation versions demoted behind the first of each family (nothing dropped).
- Nursing on Q401 only.
- Steel on 238120 / 238160 / 332311.

**The raw top-20 is the frozen gate measure.** "Distinct family" is shown for every candidate as a supplementary view.

| Pooled | RC1 | RC2 | RC3 |
|---|---|---|---|
| Short, raw | 38–42% | 67–74% | **71–79%** |
| Long, raw | 41–45% | 62–66% | 61–66% |
| Short businesses below 40% | 10 | 4 | **2**: guards, replacement parts |
| Long businesses below 40% | 8 | 4 | **4**: nursing, guards, steel, IT hardware |

- **Fixed or improved:**
  - IT hardware short: 2–4 → **13–15**
  - steel short: 6–7 → **12–15**
  - parts long: 6 → 11 (RC1 was 18)
  - nursing short: 8–9, borderline 40–45%
- **Retrieval additions:**
  - IT hardware short +119 at 11–12 of 30 relevant
  - IT long +83 at 6–9 of 20
  - steel +12 at 8 of 12
  - Nothing removed.
- **Guards 10–12 → 6–8 is a measurement artifact, not lost work.** The number of distinct relevant guard solicitations in the top-20 is the same, 6, under RC2 and RC3.
  RC2 looked better only because duplicate copies of relevant notices (ACES ×2, PSO LA) filled extra slots. Janitorial short is the same (14 distinct relevant in both).
- **Regressions to check:** paving long 15–17 → 12–14 (RC1 was 18–19), medical long 16–17 → 13–17.

**A protocol question this raises for Eric:** when fewer than 8 distinct relevant opportunities exist in the window (guards has about 6–7), a 20-slot top-20 *cannot* reach 40% without duplicates.
Three options: (a) keep the raw top-20 (guards fails by construction unless search shows fewer, better results); (b) measure relevance over the results actually shown, so a search
that returns 13 strong rows is judged on 13 (as in the v4 Fix A+B case); (c) measure over distinct solicitation families. The frozen definition is (a). Changing it
is Eric's decision and must happen before Dec 12.

## Addendum 2: long-list family guard (`agent3/long-list-family-guard` @ `38cd537ad`, off the RC3 line; NOT tagged, not a holdout candidate unless Eric approves)

**Method.**
- Top-20 lists were produced by Agent 3's validated holdout runner, run from Agent 4's own checkout on the fixture snapshot (`runner_flg_longlist_guard.json`).
- Only 7 top-20 items lacked labels. Their text came from the same snapshot, with no database call. Two blind reviewers labelled them and agreed on 6 of 7.
- Script: `scripts/r10.py`. Results: `results/r10_eval.json`.

**The change.** One list word in a title now counts as DIRECT only inside the business's own code family. Matched sets are identical to RC3 on all 28 phrasings, so this is a ranking and classification change only.

| Pooled, raw top-20 | RC2 | RC3 | Family guard |
|---|---|---|---|
| Short | 67–74% | 71–79% | **71–79%** (identical to RC3) |
| Long | 62–66% | 61–66% | **67–74%** |
| Long businesses below 40% | nursing, steel, parts, IT | nursing, guards, steel, IT | **nursing, guards, steel, IT** (unchanged) |

- **Improved (long, lower bound vs RC3):**
  - parts 11 → **17** (RC1 was 18)
  - aircraft 14 → 18
  - paving 12 → 14
  - medical 13 → 15
  - steel 4 → 6
  - janitorial 11 → 12
- **No business is lower on any phrasing.** Short is unchanged.
- **What it doesn't fix:**
  - The four long below-40% businesses remain. Nursing (5) and IT (7) are far off. Steel (6) is short of 8.
  - Guards (7) is the duplicate and too-few-families case raised in Addendum 1.
- Diagnostic only: AI labels, in-sample on the fixture.

## Addendum 3: are nursing and guards scarce markets? (r12, full pool labelled)

**Pool.** Every fixture notice open at the snapshot whose code, NAICS or title keyword fits the trade (`scripts/r12.py`): nursing 327, guards 136.
All of them are now labelled. The 382 new items were labelled by two blind reviewers, who agreed relevant-vs-not on 370 of 382. Results: `results/r12_eval.json`.

| | Distinct relevant solicitations (both / either reviewer) | Direct only (both FIT) | Relevant solicitations in the guard-window branch's matched set (short / long) | Relevant in its top 20 (short / long) |
|---|---|---|---|---|
| Nursing | **23** / 31 | 14 | 10 / 15 | 8 / 5 |
| Guards | **12** / 14 | **6** | 10 / 10 | 6 / 7 |

- **Nursing is not scarce.**
  - Short is now a retrieval gap as well as a ranking gap: its 47-notice matched set reaches only 10 of the 23 relevant solicitations.
  - Many of the new relevant items are clinical-service buys (therapy, psychologist, Job Corps medical) that the reviewers called PARTIAL for a nurse-staffing firm. How strictly "Related" is applied matters here.
- **Guards depends on the rule.**
  - Counting Direct + Related, 12 relevant solicitations exist. That is enough for 8/20 in principle.
  - Counting Direct only, 6 exist, so no ranking reaches 8/20.
  - Six borderline Related solicitations go to Eric's 5-minute spot-check (`~/mindy-release-private/guards-related-spotcheck.md`, key sealed).
- AI labels, diagnostic only. The pool is keyword- and code-bounded, so a relevant notice outside it would be missed. Counts are therefore near-census lower bounds.

## Addendum 4: rc3-guard-window @ `8b2b594e1` (combined + NAVSUP repair demotion + cheap code window) and n2-modifier-text @ `74b9dec43` (N2/N2b)

**Method.**
- Both branches were run with runner 1.1.0 from Agent 4's checkouts on the fixture snapshot. Route parity is 28/28 on both.
- 39 new top-20 items were labelled by two blind reviewers, who agreed relevant-vs-not on 36 of 39.
- **Every number below rests on two-reviewer labels.** Round 11's single-reviewer IT items are not used.
- Script: `scripts/r13.py`. Results: `results/r13_eval.json`.

| Pooled, raw top-20 | RC3 | `8b2b594e1` | `74b9dec43` (N2b) |
|---|---|---|---|
| Short | 71–79% | 72–80% | 72–80% |
| Long | 61–66% | 73–79% | **74–80%** |
| Short businesses below 40% | guards, parts | guards, parts | guards, parts |
| Long businesses below 40% | nursing, guards, steel, IT | nursing, guards, steel | **guards, steel** |

- **IT after repair demotion:**
  - short 15–19, long 16–19 relevant of 20 (RC3: 13–15 and 7).
  - It still clears 8/20 comfortably. Agent 3's DIRECT 20 → 13 is a change in the class label shown, not in relevance.
  - The repair rows that left (NRP keyboard, keyboard repair, the N00104 server and others) were NO for both reviewers.
- **N2b, nursing long:** 5–6 → **9–10**, which crosses 8/20. Nursing short stays at 8–9, borderline.
- No other business moved between `8b2b594e1` and `74b9dec43`. Cheap code window matched sets are identical to the earlier code-window branch.
- **Still failing:**
  - guards, short and long: duplicates and a scarce Direct supply (Addendum 3)
  - parts, short: 7–9
  - steel, long: 6–7
- Diagnostic only: AI labels, in-sample, fixture snapshot.

## Addendum 5: nurse-staffing related-PSC retrieval (n2-modifier-text @ `5d48336e1`)

**Method.**
- Run with runner 1.1.0. Route parity is 28/28.
- Every nursing row in the new matched sets and top 20s was already two-reviewer labelled in round 12 (the full nursing pool), so no new labels were needed.
- Only nursing changes. Script: `scripts/r14.py`. Results: `results/r14_eval.json`.

| Nursing, relevant of the top 20 | `74b9dec43` | `5d48336e1` |
|---|---|---|
| Short | 8–9 | **11–15** |
| Long | 9–10 | **10–13** |
| Pooled short / long | 72–80% / 74–80% | 73–83% / 74–81% |

- The businesses below 40% are unchanged: short has guards and parts, long has guards and steel.

**The new rows (short: 45 added to the matched set):**

| Category | Rows |
|---|---|
| FIT/FIT | 6 (13%) |
| Relevant with a PARTIAL | 17 (38%) |
| Reviewers split | 9 (20%) |
| NO/NO | 13 (29%) |

| Added rows by PSC | Breakdown |
|---|---|
| Q201 (24) | 9 NO/NO, 6 split, 9 relevant (mostly PARTIAL): Bureau of Prisons comprehensive medical, TRICARE, TSA occupational health, Job Corps medical |
| Q518 (7) | 3 FIT/FIT, 4 relevant |
| Q501 (1) | 1 FIT/FIT (locum anesthesia) |
| Q701 (3) | 2 FIT/FIT, 1 NO |
| Q403 (4) | 2 NO/NO, 1 split, 1 relevant |
| Q511 (3) | 2 split, 1 relevant |
| Q519 (3) | 2 relevant, 1 NO/NO |

- **The top-20 swap (short):** 15 rows out and 15 in. The rows out were mostly NO/NO "nurse"-word noise (11 of 15). The rows in were 5 NO/NO, 4 split, 3 FIT/FIT and 3 relevant.
- **View:** Q518, Q501 and Q701 are clean (6 FIT/FIT of 11, 1 NO). Q201 is the noise source: comprehensive-medical buys are provider or facility contracts, not staffing.
  - Narrowing to Q501/Q518/Q701 (plus Q519) would keep most of the FIT gain.
  - It would give up the Q201 PARTIALs, which count toward the bar only if Eric counts Related for this trade. Short would then likely sit near 8–11, not 11–15.

## Addendum 6: nursing variants, parts/steel fixes (S1, P1/P2), all-in head

**Method.**
- Run with runner 1.1.0, route parity 28/28 on every head.
- 10 new top-20 items were labelled by two reviewers, who agreed on 9 of 10. Script: `scripts/r15.py`. Results: `results/r15_eval.json`.
- **Heads:**
  - nursing V-narrow (Q501/Q518/Q701) `43a1c6ca7`
  - V-narrow plus Q519 `96b283535`
  - V-ranked `522b82da2`
  - S1 `f94a01444`
  - S1 plus P1/P2 `4a89f74f6`
  - all-in `e4cee694a`. It does not contain the nursing variants or S1/P1/P2, so its scores equal `5d48336e1`.

| Pooled, raw | all-in `e4cee694a` | S1 + P1/P2 `4a89f74f6` |
|---|---|---|
| Short | 73–83% | **76–85%** |
| Long | 74–81% | **77–84%** |
| Short businesses below 40% | guards, parts | **guards** |
| Long businesses below 40% | guards, steel | **guards** |

- **Steel long (S1):** 6–7 → **11–12**. It clears 8/20.
- **Parts (P1/P2):** short 7–9 → **14–17**, which clears 8/20. Long 17 → 19.
- **No business is lower** than `5d48336e1` under any head.
- **S1 drop check.** Steel long's matched set falls from 1,562 to 1,022 (542 dropped).
  - All 37 labelled-relevant steel notices are still matched.
  - None of the 542 had been labelled, so two reviewers labelled a sample of 30: every title-keyword hit (6, including the hangar builds) plus 24 random. All 30 came back NO/NO.
  - Bound on the random part: under 12% relevant (95% upper, 0 of 24).
  - Caveat: the hangar and new-building notices likely include steel erection but never say so. The rubric counts only stated work, so a human SME could call those Related.
- **Nursing variants (relevant of the top 20):**

| Variant | Short | Long |
|---|---|---|
| Full family | 11–15 | 10–13 |
| **V-narrow** | **12–13** | **13–14** |
| V-narrow + Q519 | 11–13 | 13–15 |
| V-ranked | 11–13 | 12–14 |

  V-narrow matches or beats the full family on the lower bound and carries fewer split or NO rows. It is the recommended variant.

## Addendum 7: RC3 candidate evaluation, `agent3/rc3-candidate` @ **`5c5098165`** (untagged; all-in + S1 + P1/P2 + V-narrow + cache seam hard-disabled)

**One SHA, one set of numbers, for Eric's approval.** Diagnostic only: AI labels, in-sample, Nov 14 fixture. **Not the human holdout and not a certification.**

**The SHA to tag is `5c5098165`.** It is one commit on top of `23dcfae03` and touches only `open-cache.ts` and its test. The numbers below were measured on `23dcfae03`. Agent 4 re-ran the runner on its own checkout of `5c5098165`:
- the output is identical to `23dcfae03` in every field except `src.commit`
- the rerun is byte-identical (sha256 `7ecb47f77ed9fd34…`, `src.commit` `5c50981653a7…`, not dirty)
- route parity is 28/28

So every number in this addendum applies to `5c5098165` unchanged.

**Independent checks, from Agent 4's own checkout under the shared lock:**

| Check | Result |
|---|---|
| (a) Runner output | Byte-identical to Agent 3's `outputs/rc3-candidate-23dcfae03-nov14-fixture.json` (sha256 `75963f39e376d73b…`). Agent 4's rerun is also byte-identical. `src.commit` = `23dcfae03b80…`, not dirty |
| (b) Composition | 28/28 phrasings have matched sets and top-20 identical to the evaluated part head: V-narrow `43a1c6ca7` for nursing, S1+P1/P2 `4a89f74f6` for parts and steel, all-in `e4cee694a` for everything else. No new labels were needed |
| (c) Route parity | 28/28 |

| Pooled, raw top-20 | RC1 | RC2 | RC3 preview | **RC3 candidate** |
|---|---|---|---|---|
| Short | 38–42% | 67–74% | 71–79% | **76–85%** |
| Long | 41–45% | 62–66% | 61–66% | **78–84%** |
| Short businesses below 40% | 10 | 4 | guards, parts | **guards** |
| Long businesses below 40% | 8 | 4 | nursing, guards, steel, IT | **guards** |

**Per business, relevant of the top 20 (lower–upper bound across the two reviewers), short / long:**

| Business | Short | Long |
|---|---|---|
| Janitorial | 14–15 | 12–14 |
| Nursing | 12–13 | 13–14 |
| HVAC | 17–18 | 15–16 |
| **Guards** | **6–8** | **7–9** |
| Steel buildings | 12–15 | 11–12 |
| Grounds | 16–17 | 15–18 |
| Paving | 17–18 | 14–17 |
| Replacement parts | 14–17 | 19 |
| Fasteners | 20 | 20 |
| Electrical | 19 | 20 |
| Valves | 20 | 20 |
| Aircraft | 16–18 | 18 |
| Medical | 15–20 | 18–19 |
| IT hardware | 15–19 | 16–19 |

**Open items carried with this candidate:**
1. Guards fails 40% on the lower bound, short and long. On the full labelled pool, only 6 Direct solicitations exist (12 counting Related). This is Eric's rule decision: how strict Related is and how the top 20 is counted, with the spot-check sheet as evidence. Ranking alone cannot fix it.
2. Paving long (14–17) is below RC1's 18–19. It is above the bar and was noted in Addendum 1.
3. Valves long: 15 of 20 are the same "PARTS KIT,BALL VALV" item under 20 solicitation numbers. This bears on the top-20 counting rule.
4. Steel: the S1 drop sample was 0/30 relevant. Hangar and new-building notices that never state steel work could be called Related by a human.
5. Nursing: the Related strictness also governs its clinical-service rows.
6. These numbers are AI labels on the snapshot the fixes were designed against. The Dec 12 human holdout, the protocol in `v4/HOLDOUT-PROTOCOL-ADAPTIVE.md`, is what certifies. The candidate must be tagged by Dec 5 to be evaluated on it.

Files: `runner_rc3_candidate.json` (23dcfae03), `runner_rc3_candidate_final.json` (5c5098165), `scripts/r16.py`, `results/r16_eval.json`.
