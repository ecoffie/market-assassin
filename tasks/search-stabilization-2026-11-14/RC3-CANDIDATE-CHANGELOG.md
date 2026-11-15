# RC3 candidate: changes since RC2 (`search-rc2-2026-11-14` @ 065451a66)

Branch `agent3/rc3-candidate`. **NOT TAGGED**: tagging by Dec 5 is Eric's call. Nothing deployed.

**Numbers:** Agent 4's two-reviewer AI labels on the 28 public benchmark phrasings, Nov 14 snapshot, top-20 relevant
(raw). Diagnostic only, not the sealed holdout.

**Pooled top-20 relevance:**

| | RC2 | RC3 preview | this candidate |
|---|---|---|---|
| short | 67–74% | 71–79% | **76–85%** |
| long | 62–66% | 61–66% | **77–84%** |

- Below 40%: guards only. Guards depends on Eric's top-20 / "how strict is Related" rules: only 6 DIRECT guard
  solicitations exist.
- No business drops versus RC3.

| commit | change | Agent 4 effect |
|---|---|---|
| b675e057a | IT hardware product preset (7x PSCs, item nouns, strict item rule) | IT short 2–4 → 13–15 |
| ea5870d46 | Cached open retrieval seam (`OPEN_SNAPSHOT_RETRIEVAL`, **default OFF**: no behaviour change) | n/a (flag off; hardening lives on `agent3/cache-hardening`) |
| 82cce617b | Collapse solicitation versions; nurse-staffing and steel/roofing trades | steel short 6–7 → 12–15; duplicates no longer pad lists |
| df15df2d7 | Code-recall sub-window: a product preset's coded notices always reach ranking (matched sets unchanged) | with C: IT long 7 → 15–16 (A alone dropped IT short, so it ships only with C) |
| 3158a994e | DLA computer-hardware nouns in the strict IT vocabulary | with A: IT short 15–16 |
| 0a43081a9 | Long-list family guard: one list word in a long description is DIRECT only in the business's code family | long pooled 61–66% → 67–74%; parts long 11 → 17, aircraft 14 → 18 |
| 1c30ed33d | NAVSUP repair buys (carcass / TD&E / full repair effort) are not a reseller's sale | IT short 15–19, long 16–19 (the demoted rows were NO/NO) |
| 8b2b594e1 | Cheap code sub-window (same rows; skips the text OR) | identical results; live 0.49–0.92 s vs 0.55–0.97 s |
| 74b9dec43 | N2/N2b: in long descriptions, where-words-only text, and a trade's text without its own vocabulary, are NOT RELEVANT | nursing long 5–6 → 9–10 |
| 5d48336e1 | Nurse staffing related family + "locum" / "healthcare staffing" vocabulary (narrowed by c8d56fb42) | see c8d56fb42 |
| e4cee694a | RELATED reason for a service code talks about adjacent work, not an item | wording only |
| d1815890e | S1: a named trade preset beats the bare word "construction" | steel long 6–7 → 11–12; all 37 relevant steel notices still matched; the 542 dropped rows sampled 30/30 NO/NO |
| c3adc76ef | P1/P2: literal parts suppliers get the repair rule; a supplier's words only in a service notice's text are NOT RELEVANT | parts short 7–9 → 14–17; parts long 17 → 19 |
| c8d56fb42 | Nursing V-narrow: related family = Q501, Q518, Q701 only | nursing short 12–13, long 13–14 (Q519 adds nothing: left out) |

Docs, data and harness commits on this branch (no runtime effect): 4ff671fd4, 34aad5828, b3ed2c8c1, d56ebc307,
20d4c1659, 6ed369e33, 8cd6b8f1f.

## Open items for Eric

- Tag or not (by Dec 5).
- Top-20 counting rule: raw, shown or distinct. Ball-valve parts kits appear 15× from 6 titles.
- How strict "Related" is (decides guards).
- S1 shrinks steel long's matched set (1,562 → 1,022, all broad-construction code recall). Relevant recall is
  unchanged (37/37).

## Production note

Option A cannot help long product phrasings in production today. Their main query already hits the 8 s statement
timeout, so it is coupled to the cached open retrieval, which is still behind its flag and the infrastructure approvals.
