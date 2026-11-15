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
