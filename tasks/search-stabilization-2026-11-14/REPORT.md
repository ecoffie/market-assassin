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

---

# Phase 2 (approved 2026-11-14): results

Release-candidate commit for Agent 4 scoring: **`1b7f3c129`** (retrieval). Later commits add safe failure handling
(`293155b98`) and the DIBBS notice (`9ea12caed`); neither changes retrieval.

## A. Pre-push gate findings

| Failure | Classification | Evidence | Action |
|---|---|---|---|
| `merge-identity.pglite` "Hook timed out in 10000ms" | **Resource contention, nondeterministic** | load average 17–28 on 16 cores; passes alone (13/13, setup ~2.8 s); full `npm run test:unit` passes on main `8bb887bd4` (12,043) and on this branch | `c168e0bdc`: the 4 pglite hooks lacking the repo's explicit 60 s setup budget get it (8 others already had it) + a guard test (red without the fix, green with it). No assertion changed. |
| design-token drift (34 files) | **Existing on main, non-blocking** | identical failure on main; the gate prints "not blocking" | none (out of scope; not weakened) |
| Anything caused by this branch | **none found** | | |

Node on this Mac Studio is the x64 build under Rosetta, which slows the WebAssembly Postgres boot; worth fixing machine-side.

## B. Retrieval changes in the candidate

1. Sentence fixes now apply only to a single sentence of <= 15 words (paragraphs match exactly as production); the
   shared head noun is restored ("medical, dental and laboratory supplies" → medical supplies | dental supplies | …).
   Both corrections follow Agent 4's blind v5 scoring (bare "medical" added 528 rows at 0/30 relevant; paragraph
   demotion lost ≈70 relevant DLA item buys).
2. Product retrieval: specific 4-digit FSC codes (valves 4810/4820; fasteners 5305–5325; electrical 20 codes in 59xx;
   aircraft 1560/1610/1615/1620/1630/1650/1660/1680/2840; medical 6510/6515/6520/6532/6540/6545/6550/6640) retrieve, but a
   code-only row is RELATED (basis `product_code`, its own explanation). DIRECT needs item evidence: the customer's
   words or the item noun / DLA abbreviation in the title ("VLV").
3. NSN / part number: one identifier, matched in every separator form; "4820-01-249-1348" was NAICS 4820 + 5678 + words.
4. Service retrieval: guards 561612/S206 (+ protective-officer vocabulary), plain "cleaning" phrasing → 561720/S201
   (+ janitorial/custodial), grounds 561730/S208, HVAC 238220/J041. Own codes only, no related family.
   Quoted queries never reach a preset; exclusions, buyer, state and set-aside constraints still AND.

## C. Measured results vs production (offline; Agent 4 labels; harness/eval.mts)

| Business (short phrasing) | Relevant found (lo) | Within-code recall | Added rows (labelled rel / irrelevant / unlabelled) | Relevant removed |
|---|---|---|---|---|
| Valves | 10 → **28/28** | 10 → **245/245** | +768 (23 / 2 / 743) | 0 |
| Fasteners | 13 → **32/32** | 10 → **39/39** | +155 (19 / 0 / 136) | 0 |
| Aircraft | 26 → **42/42** | 163 → **496/610** | +408 (17 / 4 / 387) | 0 |
| Electrical | 16 → 24/37 | 96 → 463/843 | +447 (9 / 0 / 438) | 0 |
| Medical | 9 → 15/20 | 16 → 55/88 | +353 (9 / 0 / 344) | 0 (−50 unlabelled) |
| Guards | 5 → **11/11** | 4 → **13/13** | +9 (8 / 1 / 0) | 0 |
| Grounds | 15 → **30/30** | 6 → **37/37** | +38 (18 / 2 / 18) | 0 |
| HVAC | 21 → **27/27** | 29 → **69/69** | +68 (9 / 5 / 54) | 0 |
| Janitorial | 15 → **23/23** | 27 → **44/44** | +30 (8 / 0 / 22) | 0 |
| Replacement parts | unchanged 17/17 | no floor | +1,184 unlabelled (step 1) | 0 |
| Nursing, steel, paving, IT hardware | unchanged | unchanged | 0 | 0 (IT −42 unlabelled) |

- Agent 4's missed set: **120 of 160 recovered** on short phrasings (38 at b449c043c); 134 on paragraphs.
- **Paragraphs lose nothing** now (the v5 losses came from demotion in paragraphs, which is reverted).
- Approved-source / sourcing restrictions among recovered relevant rows are listed per business in the matched-set file's
  eval output (`vs_baseline.added_relevant_restricted`); they are surfaced, never filtered.
- Customer impact: alert crons do not use this interpretation (unchanged). 2 of 57 alerting saved searches with text
  reach a new preset and would show more rows only when opened on the Map: +25 and +30 (no removals).
- Tests: discovery/opportunities/beginner/saved-searches/mi-dashboard/mcp: 2,325 passed; map: 1,370 passed; tsc clean.

**Top-20 precision is not established.** Valves and aircraft top-10s are clean item buys; guards, janitorial,
electrical and medical top-10s are still led by rows that are DIRECT only because a customer word appears
(Coast Guard notices, grease-trap cleaning), ranked above the new own-code rows. That is classification/ranking,
deliberately not changed in this phase. Agent 4's blind top-20 scoring of `rc_top20_ranked` is the measure.

## D. Release-gate status

| Gate | Status |
|---|---|
| >= 60% relevant in top 20 | **Not met / unmeasured** (ranking unchanged; needs Agent 4) |
| No business below 40% | **Not met** (guards, janitorial, IT hardware top-20 were 0–3 relevant in production) |
| >= 50% within-code recall | Met in-sample for 9 of 13 measured businesses; electrical 55%, medical 63%; IT hardware 9% (floor is mostly software); nursing 50%, steel 53%, paving 71% unchanged. **In-sample only.** |
| Human-reviewed fresh holdout | **Not run** (sealed; Dec 12 snapshot) |
| A2 long queries | **Failing** (safe message only; see LONG-QUERY-DESIGN.md) |

---

# RC2 (Eric approved 2026-11-14): classification, rulings, cache, environment

Branch `agent3/search-rc2` from tag `search-rc1-2026-11-14` (unchanged). Frozen as tag `search-rc2-2026-11-14`.

## What RC2 changes (retrieval is identical to RC1 on all 28 phrasings)

| Change | Commit |
|---|---|
| Pharmaceuticals / FSC 6505 only when the customer explicitly sells drugs, medications or pharmaceuticals | `cf084bb41` |
| Evidence-based classification (`evidence-classifier.ts`): DIRECT = the work / item in the title head (agency and program names masked) or the trade's own specific code; product searches also need a product notice and the item code or DLA noun slot. RELATED = description-only, product code only, family code (in-code products first). NOT RELEVANT (kept, last, explained) = DLA boilerplate on product notices, agency / program name only, repair / return-to-RFI notices for a parts-only seller. Broad family codes alone are never DIRECT. | `0f94a4062` |
| Cached open retrieval library (not wired) + description change marker | `cf8a04690` |

## Evidence

- **Retrieval:** matched sets identical to RC1 (asserted for all 28). Recall results of RC1 stand.
- **Top-20 (indicative, labelled rows only, benchmark labels v4–v6 + Agent 4's 3 adjudications pending in my copy):**
  RC1 181/423 relevant → RC2 206/267. Short phrasings: janitorial 0/0 → 10/10, guards 0/0 → 7/10,
  grounds 12/20 → 17/20, fasteners 7/20 → 17/17, electrical 7/20 → 8/9, medical 5/15 → 10/15, valves 20/20 → 17/17,
  aircraft 4/20 → 4/5, paving 15/20 → 15/20, parts 7/20 → 7/20, IT hardware 0/20 → 0/3. RC2's top 20 contain many
  unlabelled rows, so this is NOT a gate measurement; Agent 4 scores both tags blind.
- **Repair detector:** 57 of 746 benchmark rows both reviewers marked NO; 3 of 458 marked relevant, all three adjudicated
  NO by Agent 4 under the repair rule (their own text states a repair requirement).
- **Cache benchmark** (`harness/cache-bench.mts`, read-only): identical count and window on all 17 searches where SQL
  completes; on the 11 long phrasings SQL's count timed out (null) while the cache returned complete results in 1.4–2.5 s.
  Snapshot 9,702 rows, 9.9 s build, 68 MB JSON / 20.5 MB gzip.
- **Tests:** classifier 10, cache 11, presets 12, sentence 11; opportunities/discovery/mcp/map/saved-searches 3,543 passed;
  full unit suite on native arm64 Node 11,995 passed in 51 s; tsc clean.

## Environment

Native Node v24.13.0 arm64 (official tarball, SHA-256 verified) installed at `~/local/node-v24.13.0-darwin-arm64`; this
worktree's dependencies reinstalled natively; the pre-push gate runs under it. The machine-wide default (`~/.zshrc` →
`~/local/nodejs` = Intel v22.14, the wrong major for `engines: 24.x`) is NOT switched yet: every other worktree's
`node_modules` holds Intel native binaries, and switching under them would break their sessions. Switching needs a
coordinated `npm ci` per worktree.

## Remaining failures / risks

- Top-20 gate: not established until Agent 4's blind holdout scoring of both tags.
- IT hardware: retrieval is weak (code floor is mostly software); unchanged.
- The cache is not wired; A2 (long queries) still fails in production behaviour. Wiring needs Agent 5 + Eric.
- Classification precision depends on title conventions (DLA "NOUN,MODIFIER"; "for / at" clauses). Unconventional
  titles fall to RELATED, never removed.
