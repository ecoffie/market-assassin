# PRD — Federal Code Glossary (NSN/FSC decode is Phase 1)

**Status:** Phase 1 (FSC/FSG decode) BUILT this task · Phases 2-4 proposed/future · **Author:** Eric (via Claude) · **Date:** 2026-07-26
**Trigger:** Eric's real example — a DLA/DoD parts-buy notice reads `"NSN: 2915-012187655, Rod & Piston, ACTU; Part Number 2665806; Qty 266; WSDC 06F"` and a user has to leave Mindy and Google every one of those tokens to understand what's being bought. Eric: *"codify them so people can figure them out without searching. There has to be an NSN database somewhere."* (There is — DLA publishes it. GOS #7: research it, don't say can't.)
**Scope correction (2026-07-26, same day):** the first draft of this PRD was scoped narrowly to "NSN/part-number." Eric asked to scout the corpus for OTHER cryptic codes worth the same treatment — NSN turns out to be **one instance of a general pattern**: the opportunity corpus is full of acronyms, clause citations, and codes that intimidate a new entrant and are genuinely opaque without external lookup. This PRD is now the **Federal Code Glossary roadmap** — a durable architecture for decoding ANY cryptic code inline, with FSC/FSG as Phase 1 and a measured, prioritized backlog for what comes next.

---

## 1. The problem, and why it's bigger than NSN

GovCon notices — especially DoD/DLA parts-buys, but not only those — are dense with
codes that mean nothing to a reader without specialized knowledge: NSNs, FAR/DFARS
clause numbers, CAGE codes, contract-type acronyms, delivery terms, evaluation-basis
jargon. An experienced contracts professional reads these fluently; a new small
business owner reads them as a wall of noise and either Googles each one (slow,
breaks flow) or gives up and skips the opportunity. This is exactly the kind of
"intimidating domain → make it approachable" wedge the GovCon Operating System calls
for (see `docs/strategy/MINDY-OPERATING-THESIS.md`) — and it is a **distinctive**
one: incumbents (GovWin, SweetSpot, HigherGov) show the raw codes as-is; nobody
explains them inline.

### Measured demand — the real prevalence of decodable codes (11,240 active+open opps)

Filter: `sam_opportunities` where `active = true AND response_deadline > now()` —
the same "still open, respondable" definition used elsewhere in the app
(`map-data.ts`, `mi-dashboard`). **11,240 opportunities** match. Scanning title +
description + SOW text for each code family:

| Code family | Count | % of 11,240 | What it is |
|---|---|---|---|
| SOW/PWS reference | 2,364 | 21% | Statement/Performance Work Statement language |
| NSN (National Stock Number) | 2,113 | 19% | The exact-item identifier on a DoD/DLA parts-buy |
| FAR/DFARS clause citation | 2,044 | 18% | e.g. "FAR 52.219-14" — a specific contract clause |
| Notice type (RFQ/RFP/RFI) | ~3,465 | — | Already surfaced as a badge (see Daily Alerts notice-type badges) |
| LPTA / Best Value (eval basis) | 638 | 6% | How the award will be judged — **partially surfaced already** (SOW Card Facts Tier 1, `eval_basis`) |
| CAGE code | 1,090 | 10% | Commercial And Government Entity ID — identifies a specific manufacturer/vendor |
| FOB (delivery terms) | 1,127 | 10% | "Free On Board" shipping/risk-transfer point |
| IDIQ (contract type) | 895 | 8% | Indefinite Delivery/Indefinite Quantity vehicle |
| Set-aside codes (8a/SDVOSB/WOSB/HUBZone) | 523 | 5% | **Already surfaced** — set-aside chips/labels exist across the app |
| CLIN | 694 | 6% | Contract Line Item Number — a specific priced line on the contract |
| CONUS/OCONUS | 576 | 5% | Continental US / Outside CONUS — where performance happens |
| CMMC/NIST/CUI (cyber) | 331 | 3% | Cybersecurity Maturity Model Certification / NIST controls / Controlled Unclassified Information |
| Part Number | 666 | 6% | A manufacturer's own part identifier (not a federal code — see Phase 3 below) |

Eric's example, decoded end-to-end against the LIVE database (this exact notice
exists — `notice_id f80cfa6c1ab14410880236b16d62b99c`):

> `NSN: 2915-012187655, Rod & Piston, ACTU; Part Number 2665806; Qty 266; WSDC 06F`

- `2915` = FSC **"Engine Fuel System Components Aircraft"** (FSG 29, "Engine
  Accessories") — decoded by this PR's Phase 1 build.
- `012187655` = the NIIN (National Item Identification Number) — the unique item
  ID within that class. Not decoded by any bundled table; it's a per-item key into
  the full PUBLOG catalog (Phase 4 below).
- `2665806` = the manufacturer's own **Part Number** — meaningless outside DLA
  PUBLOG's part-number cross-reference (Phase 4).
- `WSDC 06F` = a **Weapon System Designator Code** — DLA's internal routing/
  cataloging code identifying which weapon system/platform this part supports
  (e.g. an aircraft type). Public WSDC tables exist but are a smaller, lower-
  prevalence win than FSC/FSG or FAR clauses — parked as a Phase 3 candidate,
  not built this round.

**Verdict:** the demand signal is real and broad — not a one-off NSN quirk. Several
of the highest-prevalence families (FAR/DFARS clauses at 18%, CAGE at 10%) are
*cheaper to decode* than NSN (a bundled lookup table, no per-item catalog needed)
and were previously invisible because nobody had scanned for them.

---

## 2. The architecture: ONE glossary pattern, many tables

The durable idea is not "an NSN feature" — it's **one shared decode pattern**,
reused per code family:

```
decodeCode(family, value) → { label, plainEnglish, moreInfo? } | null
```

Backed by a **bundled lookup table per family** (JSON, same shape as the existing
`src/data/psc-codes.json` / `src/data/naics-codes.json` pattern — grounded reference
data, not an LLM guess). Rendered as an **inline tooltip / hover-glossary** wherever
opportunity text is shown, so any recognized code gets a plain-English explainer
without the user leaving the page — the SAME UX regardless of which family matched.

**Phase 1 (this PR) builds the FIRST table** (FSC/FSG) and the extraction/decode
lib pattern (`src/lib/codes/fsc.ts`) that the rest of the roadmap will mirror:
`extractX(text) → string[]` (find code-shaped substrings) + `decodeX(code) →
Decode | null` (bundled-table lookup, honest null on no match). Phases 2-3 are
"build the next table, reuse the pattern" — not new architecture.

**What NOT to duplicate** — some of this is already partially shipped and this PRD
should reference it, not rebuild it:
- **Set-aside labels** — already surfaced as chips/badges across opp cards and the
  detail API (`SET_LABEL` in `src/lib/opportunities/map-data.ts`).
- **Eval basis (LPTA/Best Value)** — already partially extracted in SOW Card Facts
  Tier 1 (`src/lib/opportunities/sow-card-facts.ts`, `eval_basis` field).
- **PSC and NAICS code tables** — already bundled (`src/data/psc-codes.json`,
  `src/data/psc-naics-crosswalk.json`) with a working lookup lib
  (`src/lib/utils/psc-crosswalk.ts`) — the direct structural model this PR's
  `src/data/fsc-codes.json` + `src/lib/codes/fsc.ts` mirror.
- **DoDAAC (buying-office code)** — already decoded and anchored throughout the app
  (office contact rosters, TMR events, target opp counts — see CLAUDE.md "DoD office
  anchoring" sections). Not part of this glossary; it's a different code family
  (organizational routing, not item/clause classification) already solved.

---

## 3. Phase 1 — FSC/FSG decode (BUILT this PR)

**What:** decode the 4-digit Federal Supply Class embedded in any NSN, plus its
parent 2-digit Federal Supply Group.

**NSN structure:** `NSN = FSC (4 digits) + NIIN (9 digits)`. Example
`2915-01-218-7655`: `2915` = FSC; `01-218-7655` = the NIIN (the specific item's
unique identity, not decoded here). FSC codes roll up into FSG (2-digit) — e.g.
FSC 2915 "Engine Fuel System Components Aircraft" belongs to FSG 29 "Engine
Accessories."

### Authoritative sources (named, with access notes)

- **DLA Cataloging FSC/FSG reference (the H2 handbook)** — the official DoD
  cataloging classification; publicly documented but DLA's own site
  (`dla.mil`) returns 403 to non-browser fetches, so this PR sourced from two
  independent public mirrors that both republish the same DLA table verbatim:
  - `armyproperty.com/fsg` — organizes all 78 FSGs with their nested FSC children
    inline (both code + title), the source actually used to build the bundled
    table (662 FSC codes, matches the ~650 ballpark).
  - `everyspec.com/FSC-CODE/` — an independent public index of ~488 numeric FSC
    codes (a subset — some retired/merged classes only appear on the fuller list),
    used to CROSS-VERIFY titles (both sources agree, including on 2915 vs 2910 —
    see the correction note below).
- **WebFLIS (Federal Logistics Information System)** — DLA's official web lookup
  for full NSN → item detail. No bulk public API; browser-only lookup tool.
  Referenced for Phase 4, not used in Phase 1 (Phase 1 only needs the small
  fixed FSC/FSG table, not per-NSN lookups).
- **DLA PUBLOG (Public Logistics data)** — the full official DoD catalog:
  NSN → item name, manufacturer part numbers, CAGE codes. Distributed as a bulk
  CD/download (millions of NSN rows), not a REST API. This is the Phase 4 dataset
  (sized below) — explicitly NOT pulled into Phase 1.
- **CAGE codes (Commercial And Government Entity)** — manufacturer/vendor
  identifiers, maintained by DLA + also queryable via SAM.gov entity data. Public,
  finite-ish but very large (hundreds of thousands of active CAGE codes) —
  scoped as Phase 2 (see below): decode a CAGE **on demand via lookup**, not a
  bundled table (too large to ship as static JSON, unlike FSC/FSG).

### ⚠️ Correction found during sourcing (ground-in-real-data catch)

Eric's brief description of the 2915 example said "2915 = Engine Fuel System
Components, **Nonaircraft**." Cross-checking BOTH independent public sources
(armyproperty.com and everyspec.com) shows they agree: **2915 = Aircraft**, and
**2910 = Nonaircraft** (the reverse). The bundled table ships the verified value
(2915 = Aircraft) rather than repeating the unverified brief text — this is
exactly the class of "ground every fact in the real source, not an assumption"
GOS #1 exists to catch. (The item in Eric's example — "Rod & Piston, ACTU" — an
actuator rod & piston, is also plausibly aircraft-related, consistent with the
corrected value.)

### What was built

- **`src/data/fsc-codes.json`** — 662 FSC codes across 78 FSG groups, sourced +
  cross-verified as above. Shape mirrors `psc-codes.json`: `{ lastUpdated,
  version, source, totalCodes, totalGroups, groups: {fsg: title}, codes: {fsc:
  {title, fsg, fsg_title}} }`.
- **`src/lib/codes/fsc.ts`** — `decodeFSC(codeOrNsn) → {fsc, fscTitle, fsg,
  fsgTitle} | null` (accepts a bare 4-digit FSC or a full NSN in any of several
  real-world formats — see below); `extractNSNs(text) → string[]` (finds
  NSN-shaped substrings in free text); `getFSGTitle(fsg)`. Pure, synchronous, no
  DB call — safe on every request.
- **NSN pattern coverage, tuned against REAL opp titles** (not just Eric's one
  example) — live-tested against 5 real active-opp titles pulled from
  `sam_opportunities`, including edge cases the first-draft regex missed:
  `NSN: 2915-012187655` (dash+run-together), `NSN 6110-01-728-7884` (fully
  dashed), and two underscore-glued forms with no word boundary at all —
  `..._NSN_6115012345860HY_...` and `NSN: 1680994354135KT` (13-digit run
  immediately followed by a 1-3 letter suffix code, no space). All 5/5 decode
  correctly after tuning; 17 unit tests lock the behavior (including the
  underscore/no-boundary cases as regression tests).
- **Wired into `GET /api/app/opportunity-detail`** — every detail response now
  computes `nsnDecodes` (up to 5 distinct FSC classes found in the opp's title/
  description/SOW text) and folds the first one into the existing `bidFacts` grid
  as an "NSN item class" row (e.g. "2915 — Engine Fuel System Components Aircraft
  (+1 more)"). Additive only — no existing field changed, no schema change, no
  new DB column (computed live from data already selected by `DETAIL_COLS`).

**Why the detail API, not the map route:** a separate agent was concurrently
editing `src/app/opportunity-map/route.ts`, `template-html.ts`, and
`contacts-map/route.ts` (geocoding work). The detail API
(`src/app/api/app/opportunity-detail/route.ts`) is a completely separate file with
zero overlap, and is the more correct home anyway — the FSC decode is opp-detail
data, not map-rendering logic, so it belongs in the data layer that the eventual
UI (detail drawer) already reads from.

---

## 4. Phase 2 — highest-value untapped decodes (next, both cheap bundled tables)

Prioritized by **prevalence × decode-value × build cost** — both of these are
public, finite (bundle-able), and higher-prevalence than NSN:

### FAR/DFARS clause decode (18% of active opps — the single biggest opportunity)
"FAR 52.219-14" means nothing to a new entrant; "Limitations on Subcontracting"
does. The FAR/DFARS clause list is public and finite (~2,000 total clauses across
both, most notices citing only a small recurring subset) — a bundled
`{clause_number: title}` table, same shape as FSC/FSG. Source:
acquisition.gov's FAR/DFARS full text (structured, parseable). This is the
**single highest-value, highest-prevalence, lowest-cost** entry left on the board
— users are visibly intimidated by clause citations, and explaining them inline is
a strong, cheap trust win.

### CAGE code decode (10% of active opps)
CAGE → manufacturer/vendor name. Public via DLA CAGE search / SAM.gov entity
data, but the CAGE universe (hundreds of thousands of active codes) is too large
to bundle as static JSON like FSC/FSG — this is an **on-demand lookup** (a small
cached API call, not a bundled table), architecturally different from Phase 1/3.
Ties directly into the Phase 4 idea below (NSN → part number → CAGE → "who makes
this").

---

## 5. Phase 3 — small fixed acronym tables (cheap, high polish)

A single `acronyms.json` covering the remaining high-prevalence, low-build-cost
families, each needing only a 1-line plain-English gloss (no external per-code
lookup, just a static glossary):

- FOB terms (10%) — "FOB Destination" / "FOB Origin" and what risk/cost transfer
  they imply.
- Contract-type acronyms (IDIQ 8%, plus BPA/GWAC/MAS/etc.) — what kind of vehicle
  this is and how it differs from a standalone contract.
- CLIN (6%) — what a "Contract Line Item Number" is and why it matters for
  pricing.
- CONUS/OCONUS (5%) — plain-English performance-location framing.
- RFQ/RFP/RFI (notice type, ~3,465 mentions) — largely already surfaced as a
  color-coded badge (Daily Alerts notice-type badges); this phase would add the
  plain-English "what does this mean for how I respond" gloss, not the badge
  itself.
- SOW/PWS (21%) — already surfaced structurally via SOW Card Facts / the sow_text
  extraction; this phase adds the acronym-level gloss for readers unfamiliar with
  the term itself.
- LPTA/Best Value (6%) — **partially built already** (SOW Card Facts Tier 1
  `eval_basis`); this phase would extend the existing surfaced value with a
  plain-English explainer, not rebuild the extraction.
- CMMC/NIST/CUI (3%) — cybersecurity compliance jargon; lower prevalence than the
  above but high anxiety-per-mention (a CMMC requirement can gate an entire bid
  decision), so worth a short gloss despite the lower count.
- WSDC (Weapon System Designator Code, seen in Eric's own example) — DLA's
  platform-routing code; a smaller, DoD-parts-specific win, bundled here rather
  than as its own phase.

Each of these is a 1-line lookup, not a research project — the whole family could
plausibly ship in one PR once Phase 2 proves out the inline-glossary UI pattern.

---

## 6. Phase 4 — the big ingestion (future, sized here — measure before building)

**DLA PUBLOG: full NSN → exact item name + manufacturer part numbers + CAGE.**

This is the "real NSN database" Eric referenced — and it is real, but it is a
**bulk ingestion project**, not a bundled table:

- **Scale:** PUBLOG covers the ENTIRE DoD supply catalog — on the order of
  several million distinct NSNs (the exact current count needs a fresh pull from
  DLA to confirm; historically cited in the multi-million range). This is
  qualitatively different from FSC/FSG's ~650 fixed rows — it would be a real
  ETL pipeline (download → parse → store → index), not a static JSON bundle.
- **Access:** distributed as a CD/bulk download from DLA (dlis.dla.mil /
  Product Data Reporting and Evaluation Program channels), historically requiring
  a registered logistics account for the full extract; a public-facing subset is
  browsable one-NSN-at-a-time via WebFLIS but that's not a bulk source.
- **Refresh cadence:** PUBLOG updates periodically (DLA's cataloging cycle) —
  a real sync job would need its own cadence decision (likely monthly/quarterly,
  not daily — item catalogs don't churn like opportunity postings).
- **Storage:** a multi-million-row reference table — comparable in shape to
  `recompete_opportunities` (129K rows) but 1-2 orders of magnitude larger; would
  need its own Supabase table + indexing strategy, not a JSON bundle.
  **This is explicitly a measure-first task** — before committing to build it,
  the next step is confirming (a) current row count from a real DLA extract,
  (b) whether the free/public channel actually contains the full catalog or a
  redacted subset, and (c) whether the 5-14% NSN-mention rate in OUR corpus
  justifies the ETL cost versus the smaller win of just decoding the FSC (which
  Phase 1 already does for ~100% of that same subset, for a fraction of the
  effort).

**Verdict on Phase 4: NOT started, correctly.** Phase 1's FSC/FSG decode already
captures most of the "figure out what this is without Googling" value for the
~5-14% of opps that mention an NSN — full item-name/part-number resolution is a
materially bigger lift for an incremental gain (knowing the FSC class already
answers "roughly what kind of part is this," which is most of what a BD person
needs before deciding whether to pursue).

---

## 7. Phase 5 (was Phase 3 in the original NSN-only draft) — part-number → vendor

Once CAGE lookup exists (Phase 2) and/or PUBLOG is ingested (Phase 4), a specific
manufacturer part number ("Part Number 2665806" in Eric's example) could resolve
to "who makes this" via the NSN → part-number → CAGE → vendor-name chain. Explicitly
sequenced AFTER Phase 2/4 since it depends on both existing.

---

## 8. Success criteria

- **Phase 1 (this PR):** FSC/FSG table loads with 662/78 codes; `decodeFSC`
  correctly resolves Eric's real example (`2915-012187655` → "Engine Fuel System
  Components Aircraft") against the LIVE database record it came from; 5/5 spot-
  checked real active-opp titles decode correctly; unit tests (17) pass; tsc
  clean; wired additively into the opportunity-detail API with zero schema change.
- **Phase 2/3 (future):** ship when FAR/DFARS clause table + CAGE lookup are
  built — success = the same "decode a real example end-to-end against the live
  corpus" bar this PR set, not just "table loads."
- **Phase 4 (future):** success criteria is itself a MEASURE-FIRST deliverable —
  confirm real PUBLOG row count + access channel before writing a success bar for
  the ingestion.
- **Kill criteria:** if a future phase's measured prevalence in the live corpus
  is below ~2-3% AND the build cost is non-trivial (unlike Phase 1/2/3's cheap
  bundled tables), don't build it — same discipline as the "94-char-stub trap"
  in the Process Non-Negotiables.

---

## 9. Scope discipline

**In scope (this PR):** FSC/FSG bundled table + decode lib + NSN extraction +
wiring into the opportunity-detail API. Nothing else changed.

**Out of scope (this PR, roadmap only):** FAR/DFARS table, CAGE lookup, acronym
glossary, PUBLOG ingestion, part-number→vendor chain, any UI beyond the existing
`bidFacts` grid row. These are Phases 2-5 above — proposed, not built, not
estimated as committed work until Eric prioritizes them.

**Not duplicated:** set-aside labels, eval-basis (LPTA/Best Value), PSC/NAICS
tables, DoDAAC decoding — all already exist elsewhere in the codebase (see
§2 "What NOT to duplicate").
