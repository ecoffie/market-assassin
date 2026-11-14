# Security-guard matching defect: read-only investigation (Agent 3, 2026-11-14)

**Status:** investigation only (approved by Eric 2026-11-14). No code, no deploy. Proposed corrections below
need Eric's review and coordination with Agent 4's relevance benchmark
(`research/data-core-hidden-opp-benchmark-v1`, commit 41b6e3be) before any implementation.

Measured on production data after #2050 (plan v4, merge 7f328de9, prod `dpl_4aSGHeT6BPNq29GGF7p2HZpxKWmv`).
The simulation reproduces the live matched counts exactly (476 / 370 / 103 / 65), so its before/after numbers
are measured on the real retrieval set, not a sample.

## 1. Symptom

`We provide security guards.` and `guard services` match 476 open notices; 292 are labelled DIRECT_MATCH.
Coast Guard parts, Coast Guard pest control and "Marine Security Guard Residence" cooking services rank first
(8 of the top 10 in live `find_opportunities`). Only 4 of the 476 carry the guard-services codes (NAICS 561612
or PSC S206).

## 2. Root cause: one word, five meanings; the matcher counts all of them

Every occurrence of `guard(s)` in the 476 matched notices (title + description + statement of work), by meaning:

| What "guard" is in the notice | Notices | Example |
|---|---|---|
| Part of an ORGANIZATION name only (Coast Guard ~1,360 occurrences, National Guard 162) | 210 | "U.S. Coast Guard (USCG) Nationwide Environmental Engineering IDIQ" |
| A VERB ("to guard against"), mostly DLA parts boilerplate | 123 | "48--VALVE,STOP-CHECK" |
| A physical OBJECT (rail, corner, cattle, overhead, valve guard; "Coast Guard drawing") | ~115 | "Burro Creek Road" (cattle guards) |
| GUARDING WORK (security guard, guard force, guard services) | 22 | "Transition Security Guard Services, CDC Facilities" |
| A PROGRAM name that contains "security guard" (Marine Security Guard detachment) | 3 | "Food Services for the Marine Security Guard (MSG) Detachment" |

Three mechanisms let the wrong meanings through:

1. **Organization names inside the text count as the work.** `labelOpenRow` already refuses a DIRECT match that
   exists only in the buyer fields (department / sub_tier blanked, basis `buyer_name`), but it does not blank an
   organization name written into the title or description. "U.S. Coast Guard" in a title therefore satisfies
   `guard` and the row is DIRECT.
2. **The buyer column is searched as text.** `OPEN_TEXT_COLS` includes `department`. For `security guard services`
   (all of: guard + security), `security` is satisfied by "HOMELAND SECURITY, DEPARTMENT OF" on 76 rows, so a
   Coast Guard notice that mentions "Coast Guard" anywhere qualifies.
3. **The typed phrase is not kept.** `security` is a common word (>=5% of notices), so in a capability-list
   sentence it is rank-only and `guards` alone admits. The user's own phrase "security guards" (which carries the
   meaning) is split into words. Phrase handling is Agent 4's lane and was deferred by Eric; it is listed here as
   evidence only.

A fourth, separate problem is **recall**: 9 of the 13 open guard notices (NAICS 561612) never use the word
"guard". They say "Protective Security Officer Services", "Access Control and Security Escorts", "Force
Protection", "Information Monitoring and Protection Services", "Security Support Services". No word-level fix
finds them; they need code-based retrieval (the C4 trade-preset idea, which needs a labelling round).

No buyer is excluded by any proposal below. A Coast Guard notice that buys guarding work ("security guard
services at Base Portsmouth") still matches; only the word inside the organization's NAME stops counting.

## 3. Candidate corrections, measured

Truth signals: guard-services codes (561612 / S206, open and active: 13 notices) and Agent 4's 50 guard labels
(7 FIT, 43 NO; 7 reviewed by Eric). "real" = 561612/S206 rows inside the matched set.

### A. Mask registry organization names before word matching + stop searching the buyer column as text

Organization names come from `src/data/agency-aliases.json` (the registry Mindy already uses for buyer identity;
multi-word names of 6+ characters, 352 of them). They are masked in title / description / SOW before the word test, in retrieval
and in the DIRECT labeller. `department` is dropped from the text columns (the buyer constraint already handles
buyers).

| Search | Matched now → A | real kept | Agent 4 FIT kept | Agent 4 NO removed | DIRECT now → A |
|---|---|---|---|---|---|
| We provide security guards. | 476 → 273 | 4 / 4 | 3 / 3 | 7 / 13 | 292 → 160 |
| guard services | 476 → 273 | 4 / 4 | 3 / 3 | 7 / 13 | 292 → 160 |
| security guard services | 370 → 192 | 3 / 3 | 2 / 2 | 6 / 8 | 135 → 116 |
| security guards | 370 → 192 | 3 / 3 | 2 / 2 | 6 / 8 | 135 → 116 |
| long security sentence | 103 → 103 | 7 / 7 | 5 / 5 | 0 / 1 | 25 → 25 |

**Regression check, all 36 searches** (the 12 short searches, Agent 4's 12 sentences, the 16 long-list searches):
**zero target-trade notices lost on every search.** Counts change on only three non-guard searches, and every
removal checked was a buyer name supplying a search word:

| Search | Before → A | What was masked |
|---|---|---|
| We supply industrial and defense replacement parts. | 81 → 55 | "Department of Defense", "Air Force", "Coast Guard" supplying "defense" (door control units, janitorial) |
| marketing branding … advertising | 452 → 440 | "Agricultural Marketing Service" supplying "marketing" (prison meat, egg products) |
| bakery … food service | 312 → 294 | "Food and Drug Administration" supplying "food" (blood reagents, CT x-ray) |

**Risk to design for:** some registry names are also ordinary topic phrases ("Occupational Safety", "Social
Security", "Small Business"). A user who TYPES that phrase must not have it masked (e.g. "occupational safety
training"). Rule: never mask a name whose words the user's query contains as a phrase. Needs a test.

### B. A + keep the user's typed phrase (Agent 4's lane: evidence only, not proposed by Agent 3)

Requiring "security guard(s)" / "guard service(s)" / "guard force" after masking:

| Search | Now → A+B | real | FIT | NO |
|---|---|---|---|---|
| We provide security guards. | 476 → 19 | 4 / 4 | 3 / 3 | 12 / 13 removed |
| + "Marine Security Guard" treated as an organization | 476 → 13 | 4 / 4 | 3 / 3 | 13 / 13 removed |

The 9 to 15 non-coded survivors (Base Operations Support, Job Corps caretaker services, a design-build whose SOW
names guard posts) are plausible subcontract scope: exactly the case Agent 4's supporting-sentence rule exists for.
"Marine Security Guard" is not in the registry; adding it is a registry decision, not a buyer exclusion.

### C. Recall (separate): code-based retrieval for guard searches

9 of 13 open guard notices are unreachable by the word. Needs the trade-preset/labelling work (C4), not this fix.

## 4. Recommendation

1. Review A (organization-name masking from the existing registry, applied identically in retrieval, the DIRECT
   labeller and the alert/Map path, plus removing `department` from text recall). It is structural, buyer-neutral,
   removes ~43% of the guard noise and halves wrong DIRECT labels with zero measured losses on 36 searches.
   Before coding: Agent 4 scores A on its benchmark (guards with and without the org collisions, blind,
   supporting sentence shown), plus the "typed phrase is never masked" test above.
2. B (typed phrases) only through Agent 4's phrase lane and Eric's decision; the numbers above are the evidence.
3. C after a labelling round.
4. Ranking (meaning order inside a tier, Agent 4's proposal) is a separate open decision for Eric.

Ships as its own PR, separate from #2048 (C2), #2043 (alerts) and any performance change.

## 4b. Agent 4's blind scoring of A and A+B (v4, research/data-core-hidden-opp-benchmark-v1 @ 3301cb3a0)

Uses the exact sets in `tasks/guard-matching-2026-11-14/`. 1,059 blind AI-labelled pairs, 93% reviewer agreement,
supporting sentence shown.

| Guards | Production | A | A+B |
|---|---|---|---|
| Matched | 476 | 273 | 13 |
| Precision | ~2% | 1 of 25 sampled | 7 of 13 |
| Relevant among a random 25 removed rows | | 0 | 0 |
| Relevant protective-services notices retrieved (of 12) | 7 | 6 | 5 |
| Guard-coded notices retrieved (of 12) | 4 | 4 | 4 |
| Top-20 relevant | 2 | 3 | 7 of 13 |

**Correction to section 3:** "zero target loss on 36 searches" measured only trades with a NAICS target. Parts has
none, and blind labels found A drops two PARTIAL parts rows ("Replace Door Control Unit", "417 SCMS Landing Gear Depot
Support") whose only "defense" was "Department of Defense", plus one disputed guard row ("Israel S&RTS"). B drops one
PARTIAL ("REPLACE OR CHILLERS"). Five relevant protective notices are retrieved by no variant (Protective Security
Officer Services LA x2, INSCOM ACES x3): code recall (561612/S206) or protective phrases are needed.

Agent 4 also found retrieval defects in this lane (each verified with matchesText / eligibilityLabel): "We supply
industrial valves." becomes ALL(valves · supply · industrial) (0 of 23 code-floor valve notices); "like" in
"fasteners like bolts…" becomes a concept; "We clean commercial office buildings." does not match "Custodial" /
"Janitorial"; `cap.direct` is literal (no codes) for all 14 phrasings; the 500-row deadline window never ranks 687
janitorial matches. Logged for prioritisation; not started.

## 5. Cross-check with Agent 4's post-#2050 evaluation (branch research/data-core-hidden-opp-benchmark-v1, dd21f980e)

Agent 4 independently counted 136 of the 476 guard rows as Coast Guard / Marine Security Guard collisions (my
210 "organization-only" also includes National Guard). Its blind top-20 for guards: 2 relevant (production
order), 3 with meaning order, **3 with the collisions removed**. Removing organization collisions alone does not
lift guards top-20 precision, because the next DIRECT rows are "guard" as an object (brush, hose, safety guard)
and National Guard meals / laundry. This matches section 2: organizations are ~44% of the noise, verbs and
objects most of the rest.

So A is worth doing for correctness (wrong DIRECT labels on every search that shares a word with an agency name,
e.g. "defense", "marketing", "food"), but it is **not** the fix that makes guard searches useful. For guards that
requires B (the typed phrase) and C (code-based recall: 9 of 13 guard notices never say "guard"). Janitorial is
the same shape: Agent 4 finds the 271-row DIRECT tier is grease-trap / duct / hull cleaning and 8 of the 12
janitorial-coded rows in the window are classed "other": a matching and recall problem, not ranking.
