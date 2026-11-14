# Any-word matching correction: capability-list tiers (Agent 3, 2026-11-14)

**Status:** built on `fix/agent3-anyword-matching`, draft PR, NOT merged, NOT deployed. C2 (direct-match counting) waits
for this correction's review. Approved by Eric 2026-11-14 ("investigate and implement the smallest correction").

## 1. The shared path and its consumers

`src/lib/discovery/matcher.ts`. A query with 4 or more meaningful words becomes a **capability list** that admitted a
record on ANY one "distinctive" word (`alternativeOf`). The same `TextMatcher` builds:
- the SQL predicate (`textPredicate`) used by every horizon of the canonical discovery plan (`plan.ts`): the Opportunity
  Map, MCP `find_opportunities` (and so Ask Mindy Chat), and saved-search alerts once PR #2043's flag is on;
- the JS mirror (`matchesText`) used by Agent 1's evidence labellers (`labelOpenRow` / `openEvidenceClass` in
  `find-opportunities.ts`, `classifyComingBackEvidence` in `match-evidence.ts`).
Ranking (`rank.ts`) and the plan's eligibility label read the alternative's word lists; neither needed a change.

Short queries (3 or fewer meaningful words, e.g. "janitorial services", "hvac maintenance", "medical staffing",
"security guard services") never use the any-word rule and are unchanged (proven below).

## 2. Root cause (measured)

"Distinctive" was the default class for any word not on a hand list. Corpus-common words therefore admitted alone:
"provide" (in 19% of active notices' title or description), "access" 9%, "air" 6%, "removal" 2.3%, "digital" 1.4%,
"grounds" (as "ground") 1.2%. A label-by-label diagnosis showed these words, not the trade nouns, admitted the
irrelevant notices: guards list 30 of 30 sampled results admitted only on "access"; nurses sentence on "provide"/"va";
marketing list on "media"/"digital"; janitorial list on "grounds"/"removal".

The repo already defines the rule ("df >= ~5% of the corpus => common", `COMMON_TERM_WEIGHT` in
`src/lib/mi-dashboard/search.ts`) but applied it through a 19-word hand list that omits these words.

## 3. Correction (smallest that measured net-positive)

`capabilityListTiers` in `matcher.ts`, with a measured table `src/lib/discovery/corpus-word-df.json` (1,906 words at or
above 1% document frequency over 42,103 active notices, title + description; built by
`scripts/build-corpus-word-df.ts`, which refuses to write a partial table):

| Corpus frequency of a listed word | Behaviour in a capability list |
|---|---|
| 5% or more | ranks only, never admits |
| 1% to 5% | admits only together with a second listed word in the same record |
| under 1% | admits on its own (unchanged) |

Guards: recognized concepts and hyphenated compounds are never tiered; a list with one 1–5% word and no rare word keeps
it admitting alone; a list of only common words falls to the existing fail-narrow rule (all required). The lookup uses
the higher of a word and its singular, matching how the matcher already treats them. SQL and JS carry the same rule
(pairs are `and(or(...),or(...))` clauses).

Narrowing only. No new search engine, no inferred certifications, geography or eligibility; agency, state and set-aside
constraints are untouched (they are structured filters, not text).

## 4. Baseline and measurement (blind labels)

`scripts/eval-anyword-matching.ts`; fixture `tests/fixtures/anyword-matching-2026-11-14/` (403 items: per search, 30
sampled current results + up to 10 relevant-candidate notices the search misses from an independent probe; 3 blind
labelers, one third each). Searches: the 8 real customer saved searches that are capability lists (2 internal test
searches excluded) plus 3 constructed beginner searches for HVAC, medical staffing and security guards, which no
customer has typed as a list. Precision / recall are stratified estimates; 30 per search, so read single-digit
differences as noise.

| Search | Source | Results today | P / R today | Results corrected | P / R corrected | Irrelevant removed (labeled) | Relevant lost (labeled) |
|---|---|---|---|---|---|---|---|
| janitorial_list | saved | 1,279 | 20% / 96% | 640 | 40% / 96% | 15 | 0 |
| construction_list | saved | 1,066 | 60% / 100% | 1,066 | 60% / 100% | 0 | 0 |
| construction_modern | saved | 1,076 | 40% / 100% | 1,076 | 40% / 100% | 0 | 0 |
| marketing_list | saved | 771 | 3% / 96% | 488 | 5% / 96% | 11 | 0 |
| bakery_list | saved | 312 | 23% / 100% | 312 | 23% / 100% | 0 | 0 |
| elearning_list | saved | 106 | 13% / 72% | 106 | 13% / 72% | 0 | 0 |
| battery_list | saved | 130 | 27% / 83% | 130 | 27% / 83% | 0 | 0 |
| novice_ac | constructed | 1,294 | 3% / 73% | 129 | 0% / 0% | 26 | 1 |
| hvac_list | constructed | 422 | 17% / 82% | 422 | 17% / 82% | 0 | 0 |
| novice_nurses | constructed | 309 | 0% / 0% | 113 | 0% / 0% | 19 | 0 |
| guards_list | constructed | 2,580 | 0% / 0% | 86 | 0% / 0% | 29 | 0 |

Totals: **100 labeled irrelevant notices removed, 1 relevant lost.** On the 8 real customer searches: 0 relevant lost.

Variants measured and rejected (same labels, simulated before implementation):

| Variant | Irrelevant removed | Relevant lost |
|---|---|---|
| Two listed words required | 181 | 27 |
| One word only in title/description; statement-of-work hits need two | 82 | 5 |
| Words above 1% rank only | 105 | 3 |
| Words at or above 5% rank only | 56 | 1 |
| Words above 1% need a partner (co-occurrence rescue) | 82 | 1 |
| Words above 0.5% need a partner | 140 | 23 |

The chosen rule is the "need a partner" variant plus "5%+ ranks only" (which closes the "provide" + "va" loophole).

**The one loss:** "I fix air conditioners for government buildings" (constructed). Relevant notices say "air
conditioning" and matched only on "air" (6%). Adding an "air conditioning" concept was measured (forms: "air
conditioner(s)" 88 notices, "air conditioning" 465) and REMOVED from this PR: recognizing it collapses the sentence to a
3-term query that then requires the verb "fix" and returns 0. That is the sentence problem (assessment C3), not the
list rule.

## 5. Verification on the three surfaces

**Map (local server, `/api/app/opportunity-map`, and the full SQL result via `applyMapsOpenFilters`):** for all 16
searches the corrected result is a subset of main's, 0 notices added. Market totals: janitorial list 1,279 → 679,
marketing 771 → 452, guards 2,580 → 65, nurses sentence 309 → 80, air-conditioner sentence 1,293 → 74; construction (2),
bakery, e-learning, battery, HVAC list unchanged; the 4 short controls and "cyber cloud compliance network server"
identical. (Pin ids are not a strict subset because the Map shows one pin per location; both "extra" pins were verified
inside main's result.)

**Alert evaluator** (the canonical evaluator PR #2043 would run: Map plan, profile scope, 30-day window), all 186
alerting watches, main vs corrected: 1 count changes (`0e41b9aa` 25 → 19); 2 more take the new rule but already return
0; 1 watch timed out on both builds (a short query, unaffected by construction). With #2043's flag off (today), alerts
use the legacy evaluator, which does not use this matcher: no alert changes on merge.

`0e41b9aa`'s 6 removed notices: MQ-9 instructor services, wet-blade flight hours, a child-care program, and 3 aircraft
test stands. Its direct matches go 6 → 3.

**Ask Mindy Chat** (approved by Agent 1; 4 turns, 2026-11-14T16:22:24Z–16:23:18Z, local main vs local branch, staff
account, gpt-4o-mini because that account is over its monthly LLM budget; both builds received identical tool
arguments). Real customer search text, `find_opportunities(query=…)`:
- Open evidence_counts: DIRECT_MATCH 269 → 166, RELATED_MARKET_CANDIDATE 38 → 73 (preset-code rows whose only text
  evidence was "grounds" or "removal" are now honestly related market).
- Blind precision of DIRECT_MATCH (same labeller, full Open result, 20 sampled per stratum + the 7 rows chat showed,
  1 independent labeler): **11% (681 rows) → 25% (214 rows)**. Recall: 1 of 20 sampled dropped rows was relevant
  ("DEBRIS REMOVAL", matched only "removal"); one item cannot size the loss (point estimate ~23 of ~77 real rows, very
  wide).
- **The 7 notices chat displayed were identical on both builds** (3 relevant, 4 not). The top of chat's list is
  decided by ranking; this correction does not change it. Chat answers for this query look the same to a customer.
- Control prompt ("janitorial services in Florida"): the planner chose `search_sam_opportunities` on both builds;
  identical result. That tool does not use this matcher.

## 6. Limits and what this does not fix

- Precision for these searches stays low after the correction (janitorial list 40%, marketing 5%, guards and nurses
  0% in sample). The remaining noise is (a) two generic words co-occurring ("grounds" + "removal"), (b) rare-but-generic
  words ("media" 0.6%), (c) statement-of-work boilerplate, (d) sentences (C3). Trade recognition (C4) and sentence
  handling (C3) are the next levers; both need their own labeling.
- Chat's top results for this query do not change (ranking, not eligibility).
- The frequency table is a snapshot; it must be rebuilt with `scripts/build-corpus-word-df.ts` when the corpus shifts.
- `find-opportunities.ts` (Agent 1's) eligibility label still prints `ANY(...)` for lists that now carry a partner rule;
  cosmetic, left for Agent 1.

## 7. C2 readiness

C2 (count only Agent 1's DIRECT_MATCH as matches on Map/alerts; related market and other shown separately; the three
sum to Ask Mindy's total) can build on this once reviewed. Effect measured here: for the one alerting watch on the
janitorial preset, direct matches go 6 → 3 and it would still email. Not implemented.
