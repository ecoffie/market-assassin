# PRD: Proposal Doc Extraction, Classification & Compliance Referee

> Get ALL the docs off a multi-attachment solicitation, CLASSIFY each (SOW / PWS
> / wage det / Q&A / pricing / amendment), route the right file to the right
> person, align sections to drafts — then run the final draft against an
> INDEPENDENT 3rd-party LLM to verify it meets every requirement (compliance
> referee). The foundation under the proposal writer.

**Status:** Draft / scoping — 2026-06-06. Build next (foundation for proposals).
**Trigger:** Eric: "With as many as 10 documents on some combined synopsis
solicitations, make sure we get ALL the data — properly separate + disseminate
the right files to the right people, and get the sections we need aligned to our
drafts. Also cross-reference a draft against a 3rd-party LLM to ensure it meets
all requirements: extract requirements → create draft → final gets run against
an independent evaluator so at minimum it's compliant."

---

## 0. REAL DATA (not guessing — queried the SAM cache 2026-06-06)

- **10,907 respondable opportunities** (active + future deadline).
- Notice-type mix: **Combined Synopsis 41% + Solicitation 32% = 73% full-proposal
  (RFP-style)**; Sources Sought 9% (LOI); Presol 11%; Special 6%.
- **Attachment reality (combined synopsis):** median 3, **avg 4, max 17**; **30%
  have 5+ docs, some 10+** — Eric's "10 documents" is real.
- Attachments are stored as **bare download URLs** in `sam_opportunities.
  attachments` — NO filename, NO type, NO classification today.
- RFQ/IDIQ/BPA/OTA are <1% by keyword — they're CONTRACT VEHICLES, not response
  styles. Confirms the model strategy: **2 fine-tunes (LOI + technical) + RAG for
  the long tail**, not a model per vehicle.

---

## 1. The gaps (current extraction)

`fetch-pursuit-docs.ts` already: discovers resourceLinks, downloads each blob,
extracts text, upserts `pursuit_documents`. What's MISSING:

1. **No filename/type capture** — SAM gives a filename in the resource metadata
   we're not keeping, so we can't tell SOW from a wage determination.
2. **No classification** — every doc is just "a doc"; can't separate/route.
3. **No section alignment** — can't map a SOW's section → the draft section that
   must address it.
4. **No compliance verification** — nothing checks the final draft against the
   extracted requirements.

---

## 2. Build — three connected pieces

### A. Complete extraction + classification
- **Capture filename + mime** for every attachment (pull SAM resource metadata,
  not just the download URL).
- **Get ALL of them** (today's auto-load already loads all extracted docs — keep
  that; just enrich with type).
- **Classify each doc** by filename + first-page content into:
  `sow_pws` (Statement of Work / PWS / SOO), `pricing` (schedule/CLIN/B), `wage_det`
  (DBA/SCA wage determination), `qa` (questions & answers), `amendment`,
  `instructions` (Section L), `eval_factors` (Section M), `attachment_other`.
  Heuristic (filename + heading patterns) first; an LLM classifier for the
  ambiguous ones.
- Store the type on `pursuit_documents.doc_kind`.

### B. Route + disseminate (right file → right person)
- A **doc manifest** view in Proposal Assist: every attachment, its type, size,
  "download" — so the user sees the full set and can hand the **SOW.docx to subs**
  (we built SOW extract; extend to "download the pricing schedule", "the wage
  determination", etc. as their own files).
- **Section alignment:** map the solicitation's requirement sections (from L/M +
  the SOW) to the draft sections that must address them — so each draft section
  shows "this answers SOW 3.2, L.4". Drives the compliance matrix.

### C. Compliance referee (3rd-party independent evaluation)
- **Pipeline:** extract requirements (the compliance matrix we have) → user
  drafts (fine-tuned voice + RAG) → **run the final against an INDEPENDENT LLM**
  (a different provider/model than the drafter — e.g. drafter = our fine-tuned
  gpt-4o-mini, referee = Claude or a fresh GPT-4 instance) that checks: is every
  "shall/must/required" addressed? page limits met? format compliant?
- **Output:** a compliance report — ✅ met / ⚠️ partial / ❌ missing per
  requirement, with the gap called out. "At minimum it's compliant" — the
  guarantee.
- **Why independent:** the model that wrote it is biased toward thinking it's
  done; a separate model with ONLY the requirements + the draft is an honest
  referee. This is differentiated — no competitor does built-in compliance QA.

---

## 3. Scope / phasing

- **v1:** filename/type capture + classification + the doc manifest (see all
  docs, download the right one) + extend per-type extraction (SOW already done →
  add pricing schedule, wage det).
- **v2:** section alignment (SOW/L/M → draft sections) feeding the matrix.
- **v3:** the compliance referee (independent LLM pass on the final draft).
- **Out:** changing the fetcher's core download path (works); the fine-tune
  (separate track).

---

## 4. Risks

- **SAM metadata:** the filename/type may need a second SAM API call per resource
  (the cache stores only URLs). Verify the resource endpoint returns names; if
  not, infer type from the downloaded file's content + extension.
- **Classification accuracy:** filename heuristics fail on generic names
  ("Attachment 1.pdf"); fall back to content-based + an LLM classifier; let the
  user re-tag.
- **Referee cost/latency:** an independent LLM pass on a full proposal is a big
  prompt — chunk by requirement, or run on the compliance-critical sections.
- **Referee independence:** must be a genuinely different model/provider, or it's
  theater. Drafter ≠ referee.

---

## 5. Success criteria

- Open a 10-attachment combined synopsis → see ALL 10 docs, each typed, each
  downloadable; hand the SOW + pricing schedule to subs in two clicks.
- Each draft section shows which SOW/L/M requirements it addresses.
- The final draft runs through an independent LLM → a compliance report that
  flags every unmet "shall", so the user ships something at-minimum compliant.

---

## 6. Decision log
| Date | Decision | By |
|---|---|---|
| 2026-06-06 | Real SAM data confirms: 73% full-proposal, attachments avg 4/max 17, 30% have 5+. Build complete extraction + per-doc CLASSIFICATION + routing, section alignment, and an INDEPENDENT 3rd-party-LLM compliance referee (drafter ≠ referee). Model strategy confirmed: 2 fine-tunes (LOI + technical) + RAG for OTA/IDIQ/BPA/vehicle long tail (each <1%, can't sustain a model). | Eric |
