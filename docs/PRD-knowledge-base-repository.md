# PRD: Mindy Knowledge Base — Searchable Repository Page

> Mindy Chat answers well but accessing the SOURCE DOCUMENTS behind its answers
> "gets lost in translation." Build a dedicated, searchable repository page over
> the existing 1,364-doc knowledge base, so chat citations link to a real page
> and users can browse/search it directly — like a company knowledge base.

**Status:** Draft / scoping — 2026-06-05. Build later.
**Trigger:** Eric: "Mindy chat parses info great but getting to the documents
gets lost. Companies build a searchable repository that lists answers on a whole
new page. We have the Vault — reuse + expand it. (And the naming: vault.gov-
congiants.org, the in-app Vault, this — too many 'Vaults.')"

---

## 1. The problem + the 3-way "Vault" confusion

| Today's "Vault" | What it is | Keep? |
|---|---|---|
| `vault.govcongiants.org` | separate site: "Federal Contracting **Templates**" | separate; out of scope |
| In-app **Vault** (Settings) | the USER's company profile (past perf, capabilities, key personnel) | unchanged — stays "Vault" |
| This PRD | a searchable **knowledge base** over Mindy's 1,364 RAG docs | **NEW, distinct name** |

**Naming decision (Eric):** do NOT overload "Vault." The repository gets a
distinct name — proposed **"Knowledge Base"** (or "Library"/"Mindy Brain";
note `/app` already has a "My Library" = the user's own AI outputs, so this
needs a clearly different label, e.g. **"Knowledge Base"**).

**Core gap:** Mindy Chat does RAG over `mindy_rag_documents` and shows source
chips, but there's no browsable page where those source docs LIVE. A user who
wants the full document (a proposal template, a cap statement, a course module)
can't reliably get there — "lost in translation."

---

## 2. What already exists (reuse, don't rebuild)

- **The content:** `mindy_rag_documents` — **1,364 docs** with rich metadata:
  `title`, `full_text`, `one_line_summary`, `doc_type`, `topic_tags`,
  `related_naics`, `page_count`, `word_count`. doc_types include:
  proposal_template, cap_statement, past_performance, technical_volume,
  pricing_volume, sources_sought_loi, course_material, slide_deck,
  webinar_resource, estimating_example, podcast_interview, qa_dataset.
- **The viewer:** `/api/app/rag-doc?id=<document_id>` already returns full text.
- **The UI pattern:** `LibraryPanel.tsx` is a split-pane list+preview we already
  redesigned (tight rows, auto-preview) — mirror it.
- **Embeddings:** docs are embedded (`embedded_at`) → semantic search is possible
  via the existing RAG retrieval, not just keyword.

So this is mostly a **surfacing** job: a search/browse page over data + a viewer
that already exist.

---

## 3. The build

### A. A "Knowledge Base" page (sidebar → Research, or near My Library)
- **Search:** keyword + (stretch) semantic, over title/summary/full_text/tags.
- **Browse/filter:** by `doc_type` (Templates, Cap Statements, Past Performance,
  Training, …), `related_naics`, topic tags.
- **Layout:** mirror the redesigned Library split-pane — scannable rows
  (title · doc_type · summary) left, full-doc preview right (auto-preview top
  result, no dead pane).
- **Doc view:** render `full_text` from `/api/app/rag-doc`; download/copy where
  `usage_rights` allow.

### B. Chat → Knowledge Base deep links (fix "lost in translation")
- The chat source chips already carry `document_id`. Make each chip link to the
  Knowledge Base page **opened to that document** (`?doc=<id>`), so "show me the
  source" lands on the real page, not a dead end.

### C. API
- New `/api/app/knowledge-base` — search/filter/paginate `mindy_rag_documents`
  (respect `has_pii` / `usage_rights` — don't surface internal-only docs).
- Reuse `/api/app/rag-doc` for the full-text view.

---

## 4. Scope / non-goals

- **In:** the search page, the doc viewer wiring, chat-citation deep links,
  the search API. Distinct name (not "Vault").
- **Out:** migrating `vault.govcongiants.org` (separate codebase + domain move —
  a different project if wanted later); changing the in-app Vault (company
  profile); re-ingesting docs (they're already in `mindy_rag_documents`).
- **Access:** gate by tier as appropriate; honor `has_pii`/`usage_rights` so
  internal/host-personal docs never surface (the chat prompt already avoids
  naming the host — the repo must respect the same).

---

## 5. Risks

- **PII / rights:** some docs are internal (host material, PII). The page MUST
  filter on `has_pii`/`usage_rights` — a public repo can't leak internal docs.
- **Name collision:** "Library" already taken (user's AI outputs). Pick a clearly
  different name to avoid a 4th "Vault/Library" confusion.
- **Semantic vs keyword:** keyword is easy; semantic search reuses RAG infra but
  costs embeddings calls per query — start keyword, add semantic if needed.

---

## 6. Success criteria

- A chat answer's source chip → opens the Knowledge Base page to that exact doc.
- Users can search/browse all 1,364 docs by type/NAICS/keyword and read the full
  text — no "lost in translation."
- Zero internal/PII docs surfaced.
- Naming is unambiguous: Vault = company profile; Library = my AI outputs;
  Knowledge Base = Mindy's source docs.

---

## 7. Decision log
| Date | Decision | By |
|---|---|---|
| 2026-06-05 | Build a searchable repository page over mindy_rag_documents; give it a DISTINCT name (not "Vault"). Reuse the Library split-pane UI + rag-doc viewer. Don't migrate vault.govcongiants.org now. | Eric |
