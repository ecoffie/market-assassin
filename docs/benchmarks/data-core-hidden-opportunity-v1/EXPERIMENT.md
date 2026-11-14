# Evidence-gate experiment (offline, 2026-11-14)

All labels are AI-generated (see README). All numbers reproduce with `python3 -I scripts/score.py`.

## Methods compared

| | Method | Definition |
|---|---|---|
| A | Title + code (traditional) | Trade NAICS/PSC or trade words in the title (per-trade lists in `scripts/provenance/exp.py`; steel uses 238160/238120/332311 + title words, not 236220). |
| B | Existing semantic | Cosine between the customer's profile description (one embedding) and the stored notice vectors; top-k. Production hidden-match additionally requires `has_sow_doc` and a fixed 0.50 floor. |
| C | Semantic + umbrella routing | B's top-100, minus anything A already returns, kept only if NAICS is 236*/237*/561210. |
| D | C + evidence gate | C, kept only if a sentence from the description or SOW (never the title) contains a trade term. The sentence is returned for display. Two frozen lexicons: **profile** (phrases taken from the customer's own description) and **vocab** (Mindy's `naics_vocabulary` for the trade codes, minus a generic stoplist, minus terms that also occur in umbrella-code vocab). |

Lexicons were frozen (sha256 `1d87fc4e…`) before the 73 extension items were labeled and before any gate
outcome was scored. This was in-session only, with no external timestamp.

## Results — the lane (C vs D), all six trades pooled

| Method | Shown | Relevant | Precision (95% CI) | Recall vs C | Abstained (of which relevant) |
|---|---|---|---|---|---|
| C @ top-100 | 100 | 23 | 23% (16–32) | — | — |
| **D profile gate** | **20** | **13** | **65% (43–82)** | 57% | 80 (10) |
| D vocab gate | 65 | 20 | 31% (21–43) | 87% | 35 (3) |
| D either | 69 | 22 | 32% (22–44) | 96% | 31 (1) |
| C @ top-30 | 26 | 9 | 35% | — | — |
| D profile @ top-30 | 10 | 6 | 60% (31–83) | 67% | 16 (3) |

By solicitation, the profile gate shows 16 (business, solicitation) families. 10 are relevant (62.5%).

### Per trade @ top-100 (relevant / shown)

| Trade | C | D profile | D vocab |
|---|---|---|---|
| Steel buildings / metal roofing | 11/53 | 5/8 | 11/30 |
| HVAC | 12/23 | 8/12 | 9/13 |
| Janitorial | 0/9 | **0/0** | 0/8 |
| Nursing / staffing | 0/6 | **0/0** | 0/5 |
| Security guards | 0/9 | **0/0** | 0/9 |
| Parts | 0/0 | 0/0 | 0/0 |

### Context: A and B (from the audit, same snapshot)

- A misses relevant work only in construction trades. Steel: 5 open jobs, all filed 236220. HVAC: 6 jobs.
  Janitorial, nursing, guards: 0 hidden. Parts misses are NSN/null-code records, not a meaning problem.
- B top-30 precision: janitorial 50%, nursing 20%, HVAC 63%, guards 23%, steel 43%, parts 100%.
  Semantic-only false positives: 3 / 22 / 5 / 16 / 6 / 0.
- Production hidden-match as configured (0.50 floor, SOW-only pool) would have shown **0 of the 11** recovered jobs.

## What the gate does and doesn't do

1. **It removes the noise trades completely.** Janitorial, nursing and guards go from 24 wrong lane items to zero shown.
   This is the largest effect, and it doesn't depend on the construction sample size.
2. **It reaches the 60% line on AI labels, with a wide interval.** 13/20 at top-100 and 6/10 at top-30. The lower bound is 43%.
   The bar is **not met** until human labels confirm it.
3. **It loses the wording-mismatch cases the lane was meant to catch.** Of the 11 demo jobs, the profile gate keeps 5.
   It drops Red Iron, Vandenberg PEMB and Monclova because the government wrote "red iron", "pre-engineered metal
   building" and "pre-fabricated metal storage building", while the customer wrote "steel buildings". Three HVAC jobs
   can't enter the lane at all. FCI McKean (333415) and the VA plenum cleaning (562910) are not umbrella codes, and
   MRAR ranks below 400 on meaning.
4. **Mindy's vocabulary is the wrong lexicon source.** `naics_vocabulary` is built from award titles. It has no steel-building
   terms, it is full of agency-specific noise (graves, vault toilets, funeral liners under 238120), and its generic words
   ("security", "armed", "medical") pass guards and nursing junk.
5. **Roles line up.** Every gated item is SUB_SCOPE (the trade appears in the body, not the title), and every relevant gated
   item was labeled PARTIAL. The lane surfaces subcontract scope, not prime opportunities. No prime candidates appeared.
6. **Two false-positive patterns.** Spec table-of-contents lines (`DIVISION 05 – METALS 05 12 00 Structural Steel Framing`)
   and incidental mentions (lightning-protection terminals "at the highest point of the HVAC ductwork").
7. **Measurement caveat.** For 6 of the 7 gated false positives, the quoted sentence lies outside the excerpt the AI reviewers
   saw. Their NO may mean "no visible evidence". These items are `G01–G06` in the review package. Human calls on them
   move precision anywhere from 65% to 95%.

## Agent 1 overlap (net-new value)

Agent 1's released Open labeller already gives DIRECT_MATCH when the customer's phrase appears in the **description**.
It deliberately keeps SOW-only rows WEAK because their evidence isn't shown. Of the 13 relevant gated items, 8 have
their sentence in the description. Those are reachable today *if* lexical retrieval brings them back. 5 are SOW-only
and are net-new. The gate's job is to show the SOW sentence, which is what makes those rows defensible.

## Production latency and cost (measured read-only, 2026-11-14)

| Step | Measured | Production design |
|---|---|---|
| Query embedding | 460 ms, ~$0.000001 per query | Cache per profile text; 0 ms on repeat |
| Load umbrella-code open vectors | 773 rows, 20.4 MB JSON, **2.6–3.6 s** | Not acceptable per request. Keep an in-memory or KV snapshot refreshed on the existing 10–15 min embed cadence |
| Cosine over 773 × 1536 | < 1 ms (numpy); low ms in JS | — |
| Fetch text for top-100 candidates | 650 ms | Single `in()` select; could run alongside FIND stages |
| Evidence gate | ~2 ms per notice (Python) | — |
| **Added latency** | — | **~0.7–1.2 s with a vector snapshot; ~3.5–4.5 s without** |
| **Cost per search** | — | **< $0.00001**. No backfill, index, migration or model |

## Next test before any production work

Run v2 on a **time-split holdout**: notices posted after 2026-11-14, never seen by anyone. Pre-register two changes and
nothing else:
1. Drop spec table-of-contents lines (CSI `DIVISION nn` / section-number runs) before matching.
2. Add a trade-synonym list taken from an external source, not from these labels: the Census NAICS 2022 index entries
   for the trade's codes (e.g. "pre-engineered metal buildings" under 238120/332311).

Label the holdout with humans. The production bar is ≥ 60% human-labeled precision, and ≥ 3 of the 5 steel wording cases
should come back.
