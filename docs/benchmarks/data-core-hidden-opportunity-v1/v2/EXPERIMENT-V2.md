# v2 — offline prototype, pre-registered improvements, and what they show (2026-11-14)

**All labels here are AI-generated (two Claude reviewers per item) and UNVERIFIED by a human.** Where the two
reviewers disagree, no adjudication was made: the result is reported as a range (disputed items counted NO for the
lower bound, relevant for the upper). Reviewer agreement on the 367 new items: 347 exact, 353 relevant-vs-not (96%).
Nothing here meets the success criteria, because those require human labels on a post-Nov-14 holdout that does not
exist yet.

## 1. What was built

`scope-lane.ts` is a local, read-only script. Run it with
`npx tsx docs/benchmarks/data-core-hidden-opportunity-v1/v2/scope-lane.ts --q "<business description>"`.

- **"Ordinary retrieval" is Agent 1's released FIND Open code**, imported and run as-is (`buildDiscoveryPlan` +
  `applyOpenPlan` + `classifyOpenRecord` + the released matcher rule), over the full matched set rather than the
  500-row display cap. Its direct / related / other counts are printed and never changed.
- **Lane candidates** are the meaning top-100 over all open vectors, plus body sentences matching a frozen term.
  They must be filed under an umbrella code (236*, 237*, 561210) and must not have been retrieved by FIND.
  Retrieval only nominates; it never proves.
- **Evidence:** a description or SOW sentence (never the title) that is not a spec table-of-contents line and
  contains a trade term plus a requirement cue. The output shows the quoted sentence, its source (description or SOW),
  the role (PRIME_CANDIDATE, SUB_SCOPE, or UNCERTAIN, which is not shown), the meaning rank and score, the evidence
  class `SCOPE_EVIDENCE`, and the official NAICS and PSC unchanged.
- **Constraints:** no new model, vector store, route, migration, flag or write. The only call is one existing-model
  embedding per new description. The benchmark runs reused cached vectors at $0.
- **Timing (snapshot mode):** about 15 s for the FIND plan, the bulk of it; about 1.5 s to load vectors; under 0.2 s
  to rank and gate. DB mode adds about 3 s to read the vectors.

## 2. The pre-registered rules (frozen and pushed before evaluation, commit 6de53e1b)

- **A. Spec table-of-contents exclusion.** Implemented as pre-registered.
- **B. Census 2022 NAICS Index synonyms**, selected mechanically by overlap with the customer's own description.
- **Not added:** "red iron" and "pre-engineered metal building" are absent from the Census index, so they were not
  added. Adding them by hand would have broken the pre-registration.

## 3. Results on the Nov 14 snapshot (in-sample, AI labels)

Customer phrasings are the six short descriptions in `queries.json` (e.g. "We provide security guards.").

### The v2 lane fails

| Trade | Lane shown | Relevant (range) | Precision |
|---|---|---|---|
| Steel / metal roofing | 7 | 3–4 | 43–57% |
| HVAC | 71 | 14–19 | 20–27% |
| Janitorial | 40 | 1 | 3% |
| Security guards | 34 | 3 | 9% |
| Nursing | 0 | — | — |
| Parts | 53 | 1 | 2% |
| **Pooled** | **205** | **22–28** | **11–14%** |

- **It fails 60% precision.** The Census extraction drops activity words, so "Window cleaning services" becomes the bare
  word *window*, "Carpet cleaning" becomes *carpet*, "Guard services" becomes *guard* (which matches "National Guard"),
  "Mechanical contractors" becomes *mechanical*, and the profile word *component* catches anything in parts.
- **It fails "no new irrelevant results" for janitorial and guards:** 39 and 31 new irrelevant rows.
  Nursing passes with 0 shown.
- **It recovers 0 of the 5 steel wording examples, because none of them is hidden from today's FIND** (next table).

### The premise was measured against the wrong baseline

The audit's "traditional search" was an approximation (codes plus title words). **Released FIND reads description text.**
For "We erect steel buildings and install metal roofing." it matches 715 open notices (459 DIRECT, 256 other):

| Steel example | Released FIND class | Position in FIND's displayed order | Meaning order within FIND's matched set |
|---|---|---|---|
| P758 (N4008527R0047) | DIRECT | 197 | 1 |
| Red Iron (W519TC-26-Q-JOC1) | other | 338 | 3 |
| Vandenberg PEMB (W912PL27S0005) | DIRECT | 149 | 10 |
| Monclova (W912EK27BA011) | DIRECT | 105 | 14 |
| Outdoor Fitness PEB (HARBSS-2027-01) | DIRECT | 210 | 17 |

**The jobs are not missed. They are buried.** FIND orders each tier by deadline, so a relevant job sits behind hundreds
of others.

### The ranking alternative (same rows, same classes, same counts; only the order changes)

Precision of the first 20 results a customer sees (AI labels, range):

| Trade | FIND today (tier, then deadline) | Meaning order within FIND's matched set |
|---|---|---|
| Steel / metal roofing | 1/20 (5%) | **14–15/20 (70–75%)** |
| Parts | 9–10/20 (45–50%) | **19–20/20 (95–100%)** |
| HVAC | 13–16/20 (65–80%) | 16–17/20 (80–85%) |
| Nursing | 5/20 (25%) | 7–8/20 (35–40%) |
| Janitorial | 0/20 | 0/20 |
| Security guards | 0/20 | 0/20 |
| **Pooled (120)** | **28–32 (23–27%)** | **56–60 (47–50%)** |

At n = 20 per trade, each cell's 95% interval is roughly ±20 points (e.g. 14/20 → 48–86%).

### A live FIND defect explains the two zero rows (confirmed on production, 2026-11-14 ~13:00 UTC)

`find_opportunities("We provide security guards.")` reports eligibility `PAIR_ANY_TWO(we · guards)`. **The pronoun "we" is
treated as a search concept.** The live result is 129 matches, 108 labelled DIRECT_MATCH, and the top 10 are Navy valve,
spring and canister parts. Offline, the same plan retrieves 0 of the 13 open guard-coded notices. "We clean commercial office
buildings." also retrieves 0 of the 42 open janitorial-coded notices. No ordering can fix a matched set that contains no
relevant rows. This was reported to Agent 3, who owns #2047 and FIND ranking, with the repro. **Every number in the FIND
column above must be re-measured after that fix.**

### "No degradation of existing direct-match results"

Both the lane and the scope-sentence basis leave FIND's classes and counts untouched by construction; the prototype prints
them unchanged. Meaning-ordering changes positions only. Agent 1 attached conditions to it: disclose the ranking basis,
order rows with no vector by deadline and label them, keep closing-soon rows visible separately, and ship only on
blind-labelled top-k precision.

## 4. Holdout

Notices posted after Nov 14 don't exist yet. Volume is about 6,000 notices a week, of which about 330 are umbrella-coded.
That means 2–3 weeks of postings for a holdout the size of v1, and 4–6 weeks for an interval narrower than ±15 points.
The harness is ready: `scope-lane.ts --posted-after 2026-11-14` in DB mode, then `sheet_v2.py`-style blind sheets for
human labelling.

## 5. Failures and limits, stated plainly

- v2 lane: fails precision, fails the noise criterion, and recovers none of the 5 steel examples, because none of
  them is hidden.
- The Census index cannot supply "red iron" or "pre-engineered metal building"; the authoritative source lacks them.
- In-sample only. The phrasings and vectors are the ones used to design the study. Small n per trade.
- FIND today is defective for "We …" phrasings, so the baseline itself will move.
- AI labels only. Disputed items are shown as ranges, not resolved.
