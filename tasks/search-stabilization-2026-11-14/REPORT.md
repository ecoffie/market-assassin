# SAM.gov search stabilization: retrieval fixes, evidence, risks (Agent 3, 2026-11-14)

**Status:** developed on `agent3/search-stabilization` (fix commit `b449c043c`). Not deployed, no PR merged, no migration,
no watch or alert change. Offline measurement only (read-only snapshot of the open corpus, 9,701 notices,
`active = true AND response_deadline > now()`, 2026-11-15T00:52Z). DIBBS-only RFQs excluded; DLA notices on SAM.gov included.
Labels are Agent 4's v4 blind AI labels (two reviewers; lo = both relevant, hi = either). Not a release verdict: the
human-reviewed holdout is still required.

## 1. Current failures, by cause

| # | Defect | Cause in code | Example (production `7f328de91`) |
|---|---|---|---|
| 1 | All-word matching misses product notices | A short query (<= 3 meaningful words) requires every word; "supply" and "industrial" count as meaningful (`alternativeOfConcepts`, `CONCEPT_QUERY_MAX`) | "We supply industrial valves." = ALL(valves · supply · industrial): 43 matched, 0 of 23 relevant PSC 4810/4820 notices |
| 2 | Lists misparsed | "like" becomes a search word; "screws and nuts" stays one ALL group (`buildTextMatcher` splits only on `,`/`;`/`or`) | "fasteners like bolts, screws and nuts" misses "53--SCREW,CAP,SOCKET HE" |
| 3 | No customer↔government vocabulary bridge | `PHRASE_PRESET` covers construction, janitorial/custodial (exact words) and IT only | "We clean commercial office buildings." = ANY(clean): grease traps, hulls; misses "Custodial Services" |
| 4 | No industry/product-code recall for 14 of 14 phrasings | `cap.direct` is literal unless a preset fires | 9 of 13 guard-coded notices never say "guard"; electrical/aircraft titles never say "electrical"/"aircraft" ("59--RELAY,THERMAL") |
| 5 | Incidental agency words match | buyer column `department` is searched as text; org names inside titles count | "security" satisfied by HOMELAND SECURITY on 76 rows; "Coast Guard" = guards |
| 6 | Long paragraphs 500 | ~250 ms per regex clause over title/description/SOW on ~9.7k rows vs 8.3 s statement timeout | 4 benchmark paragraphs: 50–65 clauses, timeout every attempt |
| 7 | Hidden truncations | `queryWords` keeps 8 words per alternative; FIND classifies a 500-row deadline window | 687 janitorial / 303 electrical matches never ranked |

## 2. Fixes developed (one regression describe per cause: `src/lib/discovery/sentence-frame-and-lists.unit.test.ts`)

1. **Frame verbs** (`FRAME_VERBS`, `framedVerbs`): a commerce verb right after a subject pronoun ("we supply", "I sell",
   "we source and deliver") counts toward shape, then ranks only. "power supply" / "office supply" untouched.
2. **Segment and role words** (`DISCOVERY_SEGMENT_WORDS`, `DISCOVERY_ROLE_WORDS`): industrial/commercial/military/defense and
   supplier/distributor/reseller rank only, shape-preserving. (First attempt reclassified them and lost 9 of 15 relevant
   janitorial notices; corrected.)
3. **List parsing** (`listItems`), single sentence <= 15 words only: example words split and are dropped; the final "and"
   of a comma list separates items. Head-noun sharing was built, measured (halved PSC 65 recall at equal precision) and removed.
   Multi-sentence paragraphs keep today's split: splitting them produced one-word items ("number", "systems") and 4,000+ matches.

### Measured before → after (short phrasing unless noted; unchanged searches omitted)

| Search | Matched | Relevant found (lo) | Labelled precision (hi) | Own-code floor retrieved |
|---|---|---|---|---|
| We supply industrial valves. | 43 → 768 | 10/28 → **24/28** | 13/35 → 31/55 | 10/245 → **202/245** |
| We supply fasteners like bolts, screws and nuts. | 245 → 376 | 13/32 → **27/32** | 14/52 → 28/66 | 10/39 → **32/39** |
| We supply medical, dental and laboratory supplies. | 156 → 684 | 9/20 → 13/20 | 13/52 → 19/58 | 16/88 → 41/88 |
| We supply industrial and defense replacement parts. | 81 → **1,265** | 17/17 → 17/17 | unmeasured on the 1,184 added rows | no floor |
| medical paragraph | 1,228 → 751 | 9/20 → 11/20 | 13/42 → 17/56 | 35/88 → 36/88 |
| electrical paragraph | 916 → 898 | 20/37 → **19/37** | | 359 → 355 /843 |
| aircraft / IT-hardware paragraphs, IT short | −42 to −62 each | unchanged | | ~unchanged |

- Agent 4's missed set (`missed_relevant_full`, 160 not retrieved, all still open): **38 recovered** (valves 18/23,
  fasteners 14/19, medical 6/20). 0 recovered for electrical, aircraft, services (they need causes 3–4).
- **Relevant lost:** one row, both reviewers FIT: "CHASSIS,ELECTRICAL-" on the electrical paragraph. It matched only because DLA
  boilerplate contains "distributor", which paired with "electrical".
- **Customers:** 0 of the 57 alerting saved searches that contain text change plan or match set (they are keywords, not sentences).
- Unit suites (discovery, opportunities, beginner, saved-searches, mi-dashboard): 1,156 passed. tsc clean on discovery.
- Matched sets for Agent 4: `matched-sets-step1-3.json` (28 phrasings, `baseline` vs `step1_3`, no 500-row window).

## 3. Proposed, not built (each needs approval)

| Cause | Proposal | Evidence | Risk |
|---|---|---|---|
| 4 products | Item-noun + FSC-group recall: DLA title noun with abbreviations (VALVE,/VLV,/SCREW,/RELAY,) and FSC 48, 53, 59, 15/16, 65 as a recall signal, never proof | Within-code precision in Agent 4's floor samples: valves 23/25, fasteners 25/25, electrical 24/25, aircraft 21/25, medical 24/25 | ~1,500 more product rows; ranking must cope |
| 3–4 services | Trade presets (code recall + vocabulary bridge) in `PHRASE_PRESET`: 561612/S206 + protective-officer phrases; 561730/S208 ↔ landscaping; 561720/S201 ↔ clean; 238220/J041 ↔ chiller/boiler | Within-code precision: guards 12/13, grounds 23/25, janitorial 25/25, hvac 20/25; nursing 8/12, steel 11/17, IT 4/25 are weaker | in-sample to the benchmark: holdout required; related families must NOT retrieve (the #2043 janitorial 93%→43% lesson) |
| 5 | Drop `department` and `solicitation_number` from word-concept text columns (keep for code mode) | After fixes 1–3: 0 change on all 28 benchmark phrasings; removes HOMELAND SECURITY collisions; 40% fewer clauses | DIRECT labeller (`labelOpenRow`) must change identically |
| 5 | Fix A (registry org-name masking) + B (typed phrase, Eric: may be developed with the "typed phrase never masked" test) | Agent 4: A+B guards precision ~2% → 7/13, 0/25 removed rows relevant | B never ships as a standalone restriction; wait for step 4 |
| 6 | Long paragraphs: (a) honest failure now: classify 57014 in the Map route as "search too long, shorten it", not a raw 500; (b) real fix: JS matching over a cached open corpus (in-memory evaluation of 28 queries over 9.7k rows takes seconds) or a text index (migration) | Timing: 5 cols 8.3 s timeout; 3 cols still times out; title+description only 4.7–6.7 s | (b) is architecture; no column trim is reliable |
| 7 | Remove the silent 500-row window; make `queryWords`' 8-word cap explicit | 687 / 303 / 72 matches never ranked | performance on the request path |

## 4. Alerts (PR #2043)

The canonical evaluator is the Map adapter, so activating #2043 makes alerts inherit exactly the matcher above, including
these fixes. The existing parity audit (36 of 186 differ, 21 owners; Full & Open booleans honored on the canonical side) stands,
re-derivable privately with `scripts/audit-saved-search-parity.ts --all`. The three matcher fixes change 0 alerting
searches, so they do not alter #2043's watch-by-watch table. Open issue still blocking activation: janitorial precision 93% → 43%
from related-family retrieval. Recommendation: activate only after that is resolved and the audit is re-run on the release SHA.
No customer settings are modified by any of this work.

## 5. Other investigations

- **Active notices without deadlines** (`tasks/no-deadline-notices-2026-11-14.md`): 9,712; 97% award/J&A (not biddable). SAM
  publishes no date. ~233 non-award notices are candidates for a labelled "no response date" group. Separate data defect:
  `SAM_STALE_CLEANUP` not applied (6,200 past archive date still `active`).
- **DIBBS panel:** 58 open RFQs from data last synced 2026-11-02 with no paused/freshness notice. Proposal: show "Paused · last
  updated Nov 2" in the panel. Ingestion untouched.
- **PR #2048 functional review:** `evidenceMarket` is byte-identical to the inline derivation it replaces (no flag-off change);
  totals are null with a reason above the window or on failure, never 0; invariant enforced; merges cleanly with main
  (`7f3a14ac9`). Not wired to any surface (F1/F7/F8 still open). No defects found in the library.

## 6. Agent 4 dependencies and release gates

Gates (>= 60% relevant in top 20; no business < 40%; >= 50% within-code recall; human-reviewed fresh holdout) are not
claimed. Needed from Agent 4: blind scoring of `step1_3` additions (especially the 1,184 new replacement-parts rows and the
~700 new valve rows), the parts recall pool, and the sealed holdout. Agent 3 owes a frozen release-candidate SHA before Dec 12.

## Harness (read-only)

`harness/dump.mts` (snapshot), `harness/eval.mts` (FIND retrieval emulation + scoring; reproduces production matched counts
for all 14 v4 phrasings), `harness/saved-search-shapes.mts` (customer-impact diff; output contains customer text, keep outside
the repo), `harness/timing.mts`, `harness/words.mts`.
