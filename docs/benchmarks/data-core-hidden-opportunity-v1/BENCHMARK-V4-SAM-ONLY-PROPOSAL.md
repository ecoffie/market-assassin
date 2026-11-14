# Benchmark v4 proposal: SAM.gov only, services and products as separate categories (2026-11-14)

Status: proposal for review, nothing run yet. Agent 4 owns the benchmark; Agent 3 owns search. Source of the scope change:
Eric's brief to Agent 3, "Search scope change: SAM.gov first".

## 1. Source: the benchmark is already SAM.gov only

| Fact (read-only, production, 2026-11-14) | Value |
|---|---|
| `sam_opportunities` rows, all `source = 'sam.gov'` | 265,938 |
| Open now as production search defines it (`active = true` and `response_deadline > now()`; corrected by Agent 3) | 9,716 |
| Future deadline but inactive (not shown by any search; excluded) | 1,081 |
| Open and bought by DLA (published on SAM.gov) | 4,211 |
| Open product notices (PSC begins with a digit) | 6,575 |

- FIND Open reads only `sam_opportunities`. DIBBS RFQs live in the separate `dibbs_rfqs` table and have never been in the benchmark,
  v1 through v3. **No benchmark row needs removing.**
- The benchmark filter going forward is `sam_opportunities.source = 'sam.gov'` AND `active = true` AND `response_deadline > now()` (production's open definition, `map-filters.ts`). Active rows with no deadline (9,712) are shown by no search and are excluded until Eric decides. DLA notices published on SAM.gov
  stay in. DIBBS-only RFQs (rows existing only in `dibbs_rfqs`) are out.
- Products are the majority of open SAM.gov work (6,575 of 9,716, 68%). About 1,937 DIBBS solicitations also appear on SAM.gov and stay in scope through their SAM row. SBIR topics shown on the Open map are not SAM.gov and are left out. A services-only benchmark would miss most of the corpus.

## 2. Categories and phrasings

Each business gets a short phrasing (what a customer types) and a profile phrasing (a fuller description), as in `queries.json`.
Synthetic, with no customer data. The reference codes below are a **recall floor** for retrieval (notices filed under the
trade's own code). They are never the definition of relevance.

**Services**

| Business | Status | Recall-floor reference (open now) |
|---|---|---|
| Security guards | existing | NAICS 561612: 13 |
| Janitorial | existing | NAICS 561720: 42 |
| HVAC maintenance | existing | NAICS 238220: 67 |
| Steel-building erection / metal roofing | existing | no single code; umbrella 236/238 plus labelled set |
| Nursing / medical staffing | existing | NAICS 621399 + 561320: 14 |
| Grounds maintenance / landscaping | new | NAICS 561730: 34 |
| Asphalt paving / site work | new | NAICS 237310: 64 |

**Products and parts**

| Business | Status | Recall-floor reference (open now, by FSC/PSC group) |
|---|---|---|
| Industrial and defense replacement parts (general) | existing | mixed; labelled set |
| Fasteners and hardware | new | PSC 53xx: 757 |
| Electrical and electronic components | new | PSC 59xx: 874 |
| Valves | new | PSC 48xx: 600 |
| Aircraft components | new | PSC 16xx: 496 |
| Medical, dental and lab supplies | new | PSC 65xx: 100 |
| IT hardware and peripherals | new | PSC 7A/7B/7G: 110 |

## 3. Relevance rules

Both categories show the reviewer the supporting sentence plus context (Nov 14 human-review lesson). Reviewers are blind to
method, rank and ordering. Labels stay FIT / PARTIAL / NO, with a separate role field. AI-only and human labels stay in separate fields.

**Services: requirement vs incidental mention.** A notice is relevant only if it buys the work, as a whole or as an explicitly
stated component. NO when the trade word comes from:

- an organization name (Coast Guard, National Guard, Marine Security Guard Detachment, Department of Defense)
- boilerplate ("guard against", clause text)
- an object ("brush guard", "clean room" as a place)
- a different trade sharing the word (grease-trap or hull "cleaning" for a janitorial firm)

**Products: semantic similarity alone never establishes fit.**

- FIT requires the requested item to fall in the supplier's described product line. It must be established from the notice's
  own item name, specification, FSC/PSC, NSN or part number. A nearby product family (a valve seal for a valve supplier) is
  PARTIAL at most, unless the text says the item is in scope.
- A separate `fulfillment_constraint` field records approved-source, qualified-products-list, brand-name-only and
  OEM-only restrictions. It does not change relevance, but it is reported, because a relevant notice a supplier cannot legally
  fill is a different failure from an irrelevant one.
- Where an NSN or part number is present, the label quotes it.

## 4. Evaluation order: retrieval before ranking

1. **Retrieval** (per business, production FIND Open, read-only):
   - precision of a random 50 from the matched set
   - recall against the code-defined floor (share of open notices under the trade's own code that FIND retrieves)
   - matched count and the share lost to the 500-row deadline window
2. **Classification**: share of relevant retrieved rows that land in DIRECT vs other (v3 found 8 of 12 janitorial-coded rows in "other").
3. **Ranking**, only after retrieval passes: top-20 precision under production order vs meaning order, urgent rows displaced, as in v3.
4. **Release gate** (unchanged): a blind, human-labelled holdout of SAM.gov notices posted after Nov 14, with ≥60% top-20
   precision per category and no loss of DIRECT rows that are relevant.

## 5. Customer-facing consequences of the scope

- None from the benchmark itself; it is offline and read-only.
- If search is narrowed to SAM.gov, DIBBS RFQs remain in their own panel (`DibbsPanel`, `/api/app/dibbs`) unless Eric decides
  otherwise. Agent 3 owns the exact list of search surfaces that read `dibbs_rfqs` and the proposed source filter. Agent 3's audit (correcting this note): the hidden DLA Map mode (off), the opportunity-detail fallback, the DIBBS panel and API, and the sync cron. The multisite briefings read `aggregated_opportunities`, not `dibbs_rfqs`.

## 6. Ready to run on approval

The v3 harness (`v3/scripts/`) works for the new businesses unchanged; only `queries.json` grows. Cost: no new embeddings except
one cached query vector per new phrasing (about 22 calls at about $0.000001 each, which needs approval because it is API
spending), and two AI reviewers per labelled item.
