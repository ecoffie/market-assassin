# PRD: Proposal Ingestion + RAG-as-Standard + SOW Extraction

> Make Mindy genuinely good at proposals: (1) a defined INGESTION criteria so we
> can feed it full proposals and "train" (RAG, not fine-tune) on how winning
> docs are built; (2) the RAG as the DE-FACTO standard Mindy references when
> building/advising on any proposal document; (3) extract the SOW/PWS to a
> separate .docx (to send subs for pricing/bids) alongside a section-tagged
> compliance matrix.

**Status:** **v1 PARTIALLY SHIPPED 2026-06-05.** ✅ RAG-as-standard in Manual
Drive; ✅ SOW/PWS → .docx for subs; ✅ compliance matrix grouped by section.
Remaining v1: documented ingestion criteria + admin ingest path; full-proposal
smoke test. v2: notes/collab/versions.
**Trigger:** Eric: "Test it, feed it documents, train the model — determine an
ingestion criteria. Get through a full proposal. Extract the SOW/PWS to a
separate doc for sub pricing/bids. Compliance matrix tagged by sections (we have
a RAG example). Shouldn't we use the RAG as the de-facto standard for how to
build/advise on documents?"

---

## QUALITY BAR — "perfect the proposal writer like Content Reaper" (Eric, 2026-06-06)

The Content Reaper bar = output users judge you on. Hit ALL FOUR before QC:

1. **Output quality (prose, no AI-tells, human voice).** Tight per-section
   prompts; banned phrases (no "world-class/cutting-edge/leverage/robust
   scalable"); humanization pass; varied framing (lenses) so drafts read like a
   real capture writer, not GPT. *Status: partly in `lib/proposal/v2.ts`
   (anti-pattern bans, lenses, humanizeProposalDraft) — AUDIT vs the Content
   Reaper bar + close gaps.*
2. **Volume / variety (multiple drafts/angles per click).** Like Content
   Reaper's 30 posts — offer multiple section variants/angles to pick from, not
   one take. *Status: lenses give per-generation variety; add explicit
   "give me 3 versions" / regenerate-with-different-angle.*
3. **Bulk / export workflow (.docx, packaging).** Clean .docx export, bulk-draft
   all sections, assemble a submittable package. *Status: export + draft-all +
   SOW.docx exist; verify the assembled package is submission-clean.*
4. **Grounding accuracy (RFP + Vault).** Every claim traces to an RFP
   requirement + the user's REAL Vault facts; zero fabricated past performance /
   contract numbers. *Status: RAG-as-standard + Vault grounding shipped; verify
   no-fabrication holds across a full proposal.*

**Sequencing (Eric):** (1) finalize + perfect Proposal Assist to this bar →
(2) final QC pass on Mindy → (3) THEN build the interactive product tour
(`PRD-interactive-product-tour.md`, deliberately deferred so it teaches a STABLE
proposal flow and the data-tour anchors don't churn).

---

## 0. What ALREADY exists (don't rebuild — extend)

- **RAG retrieval w/ doc_type filter:** `retrieveRagContext({ query, filters })`
  → `get_rag_chunks` RPC. Can pull ONLY proposal docs.
- **Proposal RAG content:** `mindy_rag_documents` has real winning proposals —
  full technical volumes, pricing volumes, past-performance volumes, an entire
  4-volume MACC proposal (W25G1V21R0014), cap statements, proposal_templates.
- **Auto mode ALREADY uses RAG-as-standard:** `src/lib/proposal/v2.ts` retrieves
  the proposal corpus via `template-corpus.ts` (notice-family + section aware)
  and feeds it as STYLE references into drafts. **This is the model to extend.**
- **Compliance matrix ALREADY tags by section:** `/api/app/proposal/compliance`
  extracts `section: "L.3.2"` + `category` per requirement. Just needs UI
  grouping by section + a SOW/PWS extraction pass.
- **Manual Drive chat (shipped today):** `/api/app/proposal/chat` grounds in the
  user's RFP + Vault — **but NOT the proposal RAG.** Closing that is a v1 item.

So the spine exists. This PRD = ingestion criteria + extend RAG-as-standard to
Manual mode + SOW extraction + section-grouped matrix.

---

## 1. Ingestion criteria (so we can "feed it documents")

Define what makes a document worth ingesting into the proposal RAG, and tag it
so retrieval is precise.

**Accept into the proposal RAG when:**
- It's a real solicitation artifact or a real (winning/submitted) proposal
  volume: RFP/PWS/SOW, technical/management/past-perf/pricing volume, cap
  statement, sources-sought LOI, Q&A, amendment.
- Text extracts cleanly (page_count + word_count > thresholds; not a scan with
  no OCR).
- `usage_rights` allow internal reference; `has_pii` handled (redact or exclude).

**Tag on ingest (drives retrieval precision):**
- `doc_type` (already: technical_volume, pricing_volume, past_performance,
  proposal_template, sources_sought_loi, cap_statement…).
- `related_naics`, `agency`, `notice_family` (RFP/RFQ/SS), `volume`/`section`.
- `quality` (winning / submitted / sample) so we can prefer winners.

**Pipeline:** existing `mindy_rag_documents` ingest + embeddings. Add a small
admin path to ingest a new proposal set with these tags.

---

## 2. RAG-as-standard everywhere (the "train" ask, done right)

Decision (Eric): **RAG, not fine-tuning.** Mindy retrieves from the proposal
corpus to advise on HOW to build/structure/word any proposal doc.

- **Extend to Manual Drive:** the proposal chat should ALSO retrieve the
  proposal RAG (filtered to proposal doc_types + the RFP's notice family/NAICS)
  so "draft the technical approach" is informed by how real technical volumes
  are structured — not just the user's Vault. (Today it only uses RFP+Vault.)
- **Cite the standard:** when Mindy advises structure ("a technical volume
  typically has X, Y, Z"), surface which corpus doc informed it.
- **Auto mode:** already does this — align the two so both modes draw the same
  corpus.

---

## 3. Full-proposal pipeline (get a full doc through)

- **Test harness:** feed a full multi-volume proposal (we have W25G1V21R0014 in
  RAG) end-to-end: upload → extract → compliance matrix → SOW extract → draft
  each volume → export. Confirm nothing truncates; large-doc context handled via
  retrieval (not stuffing).
- **Success = a complete, coherent multi-section response** generated from a
  real solicitation, grounded in the RFP + Vault + proposal RAG.

---

## 4. SOW/PWS extraction → separate .docx (for subs)

Eric: extract the SOW or PWS to its OWN doc to send subcontractors for pricing /
bids — paired with the compliance matrix.

- **Extract:** detect + pull the SOW/PWS/SOO section from the uploaded
  solicitation (heading patterns: "STATEMENT OF WORK", "PERFORMANCE WORK
  STATEMENT", "C.", "SECTION C"). New `/api/app/proposal/extract-sow`.
- **Export:** a clean **SOW.docx** (reuse the existing `.docx` export from
  Proposal Assist) the user can hand to subs.
- **Pair with compliance matrix:** a "sub package" = SOW.docx + the
  section-tagged compliance matrix (what each sub must cover).

---

## 5. Compliance matrix tagged by SECTION (surface what exists)

The matrix already extracts `section` (L.3.2 etc.). This is mostly UI:
- **Group the matrix BY section** (L / M / C, then sub-sections) — matching the
  RAG example Eric referenced.
- Keep the category color tags; add a section column/grouping header.

---

## 6. Scope / phasing

- **v1 (toward June 19):**
  - Ingestion criteria documented + a small admin ingest path with tags.
  - Manual Drive chat ALSO retrieves the proposal RAG (RAG-as-standard in both
    modes).
  - SOW/PWS extraction → SOW.docx (+ pairs with the matrix as a "sub package").
  - Compliance matrix grouped BY section in the UI.
  - Full-proposal smoke test through the pipeline.
- **v2.0 (NOT June 19 — per Eric):** notes area; compliance who/status assignee
  tracking; draft version history (v1/v2/v3); multi-user.

---

## 7. Risks

- **Context size:** full proposals are huge — rely on retrieval (RAG chunks),
  never stuff whole volumes into the prompt. The chat engine already chunks.
- **SOW detection variance:** SOW/PWS headings vary; detection needs fallbacks
  (let the user confirm/adjust the extracted range).
- **PII/rights in ingested proposals:** real proposals contain pricing + names —
  honor `has_pii`/`usage_rights`; corpus is STYLE reference, "do NOT copy
  verbatim" (Auto mode already instructs this).
- **Don't regress Auto:** extending Manual to use RAG must not change Auto's
  behavior.

---

## 8. Success criteria

- A full real solicitation runs end-to-end → coherent multi-section draft.
- Manual Drive answers are informed by the proposal RAG (cites a corpus doc when
  advising structure), not just the user's Vault.
- User can export a SOW.docx + section-grouped compliance matrix to hand subs.
- Ingestion criteria is written; new proposal docs can be added with tags.

---

## 9. Decision log
| Date | Decision | By |
|---|---|---|
| 2026-06-05 | Build full-proposal ingestion + RAG-as-standard (RAG, NOT fine-tuning) as the proposal-improvement core. Extend the RAG-as-standard pattern (already in Auto via v2.ts/template-corpus) to Manual Drive. Add SOW/PWS→.docx extraction for subs + section-grouped compliance matrix. v2 = notes/collab/versions. | Eric |
