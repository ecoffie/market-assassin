# v3: fresh ranking evaluation after PR #2050 (2026-11-14)

**All labels in this round are AI-generated (two Claude reviewers per item, Sonnet and Opus) and unverified by a human.**
Disputed items are shown as ranges: counted NO for the lower bound, relevant for the upper. Human labels from
`HUMAN-REVIEW-RESULTS.md` are kept separate (see the end). In-sample, one snapshot: this does not meet the release requirement.

## What was compared

- **A: current production order.** The six short phrasings in `../queries.json` were run through the real `findOpportunities`
  (Open now only) at origin/main `7f328de91`, which includes #2050, against production (read-only).
  A one-line observer (`scripts/observer.diff`, in a throwaway worktree, never committed) captured the full ranked list.
  For every trade, the captured top 20 equals the live API's top 20 (`faithful_top20: true`).
- **B: meaning order of exactly the same rows.** Same rows, same classes, same counts. Each evidence tier is kept
  (DIRECT, then RELATED, then other). Inside a tier, rows are ordered by cosine similarity between the stored notice vector
  and the stored query vector. Rows without a vector go after the vector rows of their tier, by deadline. No new embeddings
  (the query vectors are the 12 cached in `vcache.json`), indexes, writes or production changes.
- **Labelling:** the union of the A and B top-20s (plus both guards variants) is 203 items. Reviewers saw them shuffled and
  were blind to ordering, rank, method and codes. Each item showed the business in the customer's words, title, agency,
  notice type, the notice sentence sharing the most words with the business (the supporting sentence) plus the sentences
  around it, and the first 1,200 characters of the description. Reviewer agreement: 185/203 exact, 193/203 relevant-vs-not.

## Top-20 precision by trade

| Trade | Retrieved (matched) | A: production | B: meaning order | Median position of relevant rows, A → B |
|---|---|---|---|---|
| Steel / metal roofing | 500 (572) | 3–4 | **11–14** | 52 → 12 (n=13) |
| Parts | 81 (81) | 7–8 | **12–14** | 28 → 15.5 (n=14) |
| HVAC | 211 (211) | 16–17 | 17–18 | 16 → 16.5 (n=26) |
| Nursing | 46 (46) | 6–8 | 7–9 | 14 → 4 (n=7) |
| Janitorial | 500 (1,187) | 2–3 | 3–4 | 125 → 19 (n=5) |
| Security guards | 476 (476) | 2 | 3 | 10 → 2 (n=3) |
| Guards, Coast Guard / Marine Security Guard rows removed | 340 | 3 | 3 | |
| **Pooled (120)** | | **36–42 (30–35%)** | **53–62 (44–52%)** | |

Pooled 95% intervals: A 23–39% (lower bound) to 27–44% (upper); B 36–53% to 43–60%.
Retrieved = the rows production ranks (deadline-ordered fetch window of 500). Matched = the plan's full count.

## Urgent opportunities (deadline within 7 days of the snapshot) in the top 20

| Trade | Urgent in A top 20 | Urgent in B top 20 | A's urgent rows pushed out of B's top 20 | Of those, judged relevant (upper bound) |
|---|---|---|---|---|
| Janitorial | 18 | 18 | 12 | 2 |
| Guards | 11 | 12 | 7 | 0 |
| Parts | 10 | 7 | 6 | 1 |
| Steel | 9 | 7 | 9 | 0 |
| Nursing | 9 | 9 | 1 | 0 |
| HVAC | 4 | 7 | 3 | 2 |
| **Total** | **61** | **60** | **38** | **5** |

Meaning order keeps about the same number of urgent rows in view, but swaps 38 of them for others. Five of the displaced
rows may be relevant. Agent 1's condition holds: closing-soon rows need their own visible group if meaning order ships.

## What the results say

1. **Ranking helps where the matched set holds the right jobs.** Steel improves from 3–4 to 11–14 of 20 and parts from 7–8
   to 12–14. Relevant steel rows move from a median position of 52 to 12.
2. **Janitorial and guards are matching and classification problems; ranking cannot fix them.**
   - Janitorial: "We clean commercial office buildings." matches 1,187 notices. The DIRECT tier (271 of the 500 retrieved)
     is full of grease-trap, hull, duct and laundry cleaning. Only 12 janitorial-coded (561720) notices are inside the
     500-row window, and 8 of them are classed "other", so tier-preserving order cannot lift them.
   - Guards: removing the 136 Coast Guard / Marine Security Guard rows does not help (3/20 either way). The rest of the
     DIRECT tier is "guard" as a part (brush guard, hose guard), National Guard meals and laundry. Only 4 guard-coded (561612)
     notices are retrieved. Meaning order puts 3 of them at positions 1, 2 and 10, but that is still only 3 of 20.
3. **HVAC was already good** (16–17/20) and stays so. Nursing moves slightly, from 6–8 to 7–9.
4. **Neither ordering reaches 60% pooled.** B reaches it for HVAC (85–90%), parts (60–70%) and steel (55–70%).
5. **The #2050 fix works as intended:** janitorial and guards now retrieve and display results. What they display is
   mostly wrong for a word-collision reason, not a ranking one.

## Human labels (kept separate)

10 of the 203 items also have a human label from the Nov 14 review. The AI relevant-vs-not call matched the human on 8 of
10 (both bounds). The two misses are listed in `results/r3_eval.json` under `human_overlap`.

## Reproduce

1. Make a throwaway worktree at the production commit and apply `scripts/observer.diff`.
2. Run `npx tsx <path>/scripts/harness.mts <capture_dir> ../queries.json` from that worktree. It needs the production
   service-role env and is read-only.
3. Run `R3_CAPTURE=<capture_dir> python3 -I scripts/build_r3.py` to make the orderings and sheets.
4. Run `python3 -I scripts/score_r3.py` to score the committed labels; it writes `results/r3_eval.json`.

The captured per-trade files (raw text and vectors, about 42 MB) are not committed. The committed
`results/r3_orders.json` holds both orderings, classes, deadlines, cosines and the redacted reviewer-facing text.

## Limits

AI labels only, one reviewer pair. In-sample on the benchmark phrasings. One snapshot (2026-11-14, 20:24 UTC).
n=20 per trade, so each cell's 95% interval is roughly ±20 points. The supporting sentence is chosen by word overlap, so
it can surface the colliding word (for example "guard"). The blind holdout of notices posted after Nov 14 is still required
before any release decision.
