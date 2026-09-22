# POTETO — Compliance Matrix Truth

Fixture: VA **36C24226Q0857** (demolition/asbestos IDIQ, East Orange & Lyons NJ).
Journey: PACKAGE → DOCUMENT → REQUIREMENT → QUOTE → SOURCE → MATRIX → VERIFY

> **No customer-visible source claim survives unless it can be verified against the source
> Mindy actually has.**

## 1. The package Mindy actually holds

| document | availability | chars |
|---|---|---|
| notice description | complete | 2,103 |
| `36C24226Q0857_1.docx` (SF 1442 + Sections A–E + SOW) | complete | 148,483 |
| `VAAR+852.219-75.docx` | complete | 3,100 |
| `EXHIBIT+C+-+Past+Performance+Questionnaire.docx` | complete | 6,050 |
| `LINE+ITEM+PRICING+SHEET…xlsx` | complete | 12,937 |
| `WD+Essex.docx` / `WD+Somerset.docx` (identical wage determinations) | complete | 41,803 each |
| `EXHIBIT+B+-+Sample+Transmittal+Letter…docx` | complete | 1,388 |

7/7 documents complete, 0 unreadable, 0 image-only, no amendments, assembled source
257,724 chars. `truncated_attachments` reported **6** because it compared a trimmed body
with the untrimmed `char_count`. Fixed: now **0**.

**Section L does not exist.** This is a FAR Part 12 commercial buy on an SF 1442. Its
table of contents runs Sections A–E. Instructions to offerors are **E.1 (52.212-1)** and
evaluation is **E.10 (52.212-2)**. Nothing is truncated or unreadable before a Section L,
and no other version of the document contains one. The model produced one because it
expected one (§4).

## 2. Production before the fix (hosted MCP)

68 rows, `truncated: true`, `truncated_attachments: 6`, `source_coverage.complete: true`.
There was no verification of any kind. The frozen copy is at
`scripts/acceptance/fixtures/compliance-matrix-36C24226Q0857-prod-before.json`.

## 3. Verification method (independent, deterministic)

- **Locate.** Search for the quote in each named document's stored text. The match is
  exact first. If that fails, it is retried after harmless normalization: typographic
  quotes and dashes, whitespace runs and line wraps, extraction hyphenation across a line
  break, case, and a whitespace-only difference such as `10:00 EST` vs `10:00EST`.
  Ellipsis fragments must appear in order. A normalized hit maps back to an exact
  character range.
- **Classify** each row as `verified_exact`, `verified_normalized`, `paraphrase`,
  `source_mismatch`, `unverifiable`, `source_unavailable` (the package had
  unreadable/partial documents), or `no_source_quote`.
- **Support.** A real quote must carry the row. At least 30% of the requirement's content
  words (or 3 of them) must appear in it, and **every figure/code the requirement states**
  (`1.5`, `2.4.A`, `12`, `$35,000.00`) must appear in the quote.
- **Section.** A label is kept only if the document prints it at the start of a line
  before the quote, with no sibling heading of the same shape in between. That rules out
  table-of-contents entries, other sections, prefixes the model added, and clause
  paragraph letters.
- **No second LLM.** The acceptance script re-verifies every trusted row with a separate
  implementation that does not import the gate.

## 4. Reproduced failures vs prior claims

| claim | now |
|---|---|
| 9/72 quotes unverifiable | Varies by run (the model is nondeterministic). Hosted prod-before run: **0/68** absent. Three local pre-fix runs: **8/69, 4/72, 7/69** not verbatim. Each is either a true fabrication (e.g. `NJAC 5:23-8` with the source's "(NJAC)" dropped and words spliced) or a paraphrase of a real sentence. |
| 4 rows cite "Section L" | **Reproduced exactly** (pre-fix run 3: 4 rows with `section: "l"`). The label is 52.212-4's paragraph `(l) Termination for the Government's convenience`. Hosted prod-before had 3. |
| not previously reported | **13 submittal-log rows** each "quoted" the one sentence *"Contractors shall submit all required 10-day notifications…"*. The quote is real, but it doesn't support the row. One row also said "Fire Safety Plan … Section 1.5"; the table prints **1.14**. |
| not previously reported | **39/68** rows carried sections the document does not establish: `C.2.3.1` / `C.2.15` (the SOW prints `2.3.1` / `2.15`), `C.1` on SOW text, and `m(3)`, `B(vi)`, `k`, `j`. |

Example row trace: REQ-031 *"Submit Fire Safety Plan as specified in Section 1.5"*, quoting
*"Contractors shall submit all required 10-day notifications to applicable regulatory
agencies."* with claimed section `C.1`. The quote exists (verified_normalized) in
`36C24226Q0857_1.docx`, but it shares no content word with the requirement, `1.5` is not
in it, and `C.1` is a table-of-contents entry. **Result: withheld
(`quote_does_not_support_requirement`).**

## 5. Root causes (pipeline trace)

1. **Nothing checked the output.** Model-generated quotes and sections went straight to
   the customer. Document identity was flattened into one blob, and no code looked for a
   quote in the source.
2. **The prompt primed the fabrication.** Its example section was `"L.3.2"`, it told the
   model to look for "Section L/M/C", and `source_quote` was optional.
3. **The model reads 19% of the package.** It sees 50,000 of 257,724 chars: the notice
   description plus the first 47,866 chars of the main document. Section E (the actual
   instructions and evaluation factors) and all six attachments are never seen. Coverage
   was reported as `source_coverage.complete: true` (true of the source, not of what was
   read), plus a false `truncated_attachments: 6`.

It was not purely a model problem: (1) and (3) are pipeline defects.

## 6. Fix

- `src/lib/proposal/matrix-verification.ts` is the gate.
- `src/mcp/tools/compliance-matrix.ts` now returns `requirements` / `interpretations` /
  `withheld`, and adds `_meta.verification`, `_meta.extraction_coverage` (per document),
  `_meta.amendments_detected`, and `_meta.truth_contract`. `extraction_completeness` stays
  `unproven` unless every document was fully read and every candidate verified.
- The prompt drops the Section L priming, requires `source_quote`, and requires quotes to
  carry the requirement's figures.
- `truncated_attachments` compares untrimmed length.

## 7. Before / after on the gold master

| run | candidates | verified | interpretations | withheld |
|---|---|---|---|---|
| hosted prod-before, gated | 68 | **52** | 0 | 16 (13 submittal misquotes, 1 "12 days" not in quote, 2 weak) |
| pre-fix local run 3, gated | 69 | 46 | 4 | 19 |
| fresh (fixed prompt + gate), 3 runs | 65 / 62 / 60 | 65 / 62 / 59 | 0 / 0 / 0 | 0 / 0 / 1 |
| fresh acceptance run | 61 | 59 | 0 | 2 |

In every case, 0 trusted rows fail independent re-verification.

## 8. Deliberately unresolved

- **Recall: 81% of the package is unread.** The 50K window means E.1/E.10 and every
  attachment contribute nothing. This is now disclosed per document, not fixed: widening
  the window is a cost/recall product decision.
- **Submittal-log table rows.** With the stricter prompt the model now omits them (it
  can't produce a quote that carries the table's section column). That is honest, but a
  recall loss.
- **Semantic polarity.** The gate proves the quote is real and lexically related, not that
  Mindy's `requirement` reading is correct. E.g. *"Provide material testing…"* from
  *"…shall be provided by the VANJHCS at no cost to the contractor"*. That is why
  `requirement` is labelled Mindy's reading and `source_quote` is the source.
- **Amendment precedence** isn't resolved. There are none in this package; amendment
  documents keep their own `source_doc` and are listed in `amendments_detected`.
- The in-app route `/api/app/proposal/compliance` shares the prompt but not the gate.
- **Pursuit Dossier** still does not recommend this tool. Re-enabling that is a separate
  product decision.

## 9. Billing (Credit Integrity, unchanged)

- Source fetch fails: `degraded:true, grounded:false`, so `nonbillable_system_failure`.
- Every model chunk fails: same.
- Extraction ran but every candidate was withheld: `billable_no_result` (a valid paid
  result).
- Verified rows: `billable_success`.

These are pinned in `compliance-matrix.unit.test.ts`. No metering code changed.
