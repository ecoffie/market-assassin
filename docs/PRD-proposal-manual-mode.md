# PRD: Proposal Assist — Manual Drive (Perplexity-style proposal LLM)

> Today's Proposal Assist is "Auto" — one click drafts the whole response.
> Add **Manual Drive (Sport Mode)**: upload your project files, type what you
> want, and a proposal-scoped LLM reads everything + helps you write it — the
> way people are used to working with LLMs on proposals. Gives the user autonomy
> over the outcome.

**Status:** **v1 SHIPPED 2026-06-05; UPGRADED 2026-06-07.** Toggle + proposal
chat + Verify-on-SAM link, all live. 2026-06-07: chat now REUSES the extracted
docs + cached compliance matrix (pass `pipeline_id`), relevance-selects from the
full solicitation (was first-8K-only → generic answers), provider fallback
(Groq→Claude→OpenAI, no more 429 deaths), and is positioned as the BID-AWARE
assistant (knows THIS solicitation — vs a blank-slate ChatGPT). Notes +
collaboration = v2 (not done).
**Trigger:** Eric: "Proposal Assist should have a Perplexity-style function —
upload files, it reads them, you type what you want, like Mindy Chat but for the
proposal. Auto vs Manual drive. I like to see everything happening. Notes /
who's-doing-what / draft versions = v2.0 since we ship June 19."

---

## 1. The concept — Automatic vs Manual drive

| Mode | What | Who it's for |
|---|---|---|
| **Auto** (today) | One button "Draft my response" → Mindy drafts the whole thing | Most users; fast, hands-off |
| **Manual / Sport** (NEW) | Upload your files → chat with a proposal-scoped LLM → you direct what gets written, section by section | Users who want control + to "see everything happening" |

A **toggle** in Proposal Assist switches between them. Auto stays the default
(the one-one-one simplification we just shipped). Manual is opt-in.

The "Vault" = your **prepopulated files** (company profile + any uploaded RFP).
Manual mode lets you **add more files** and navigate/extract exactly what you
want — autonomy over the result.

---

## 2. What already exists (build on it, don't rebuild)

- **File upload + extraction:** `/api/app/proposal/upload` ingests RFP/attachments
  and extracts text (already powering Auto).
- **Vault context:** Proposal Assist already pulls the user's Vault (past perf,
  capabilities, key personnel) into drafts.
- **The LLM engine:** **Mindy Chat** (`/api/app/chat`) is a streaming RAG LLM
  with sessions, system prompt, context window, SSE token streaming, and source
  citations. **This is the engine to reuse** — scoped to the proposal's docs +
  the user's Vault instead of the global knowledge base.
- **Draft generators:** `/api/app/proposal/draft`, `draft-all` already produce
  sections from context — the chat can call/feed these.

So Manual mode ≈ Mindy Chat, but its retrieval context = (uploaded proposal
files + Vault) and its prompts are proposal-writing-tuned.

---

## 3. v1 scope (SHIP BY JUNE 19)

### A. The Auto ↔ Manual toggle
- A clear toggle in Proposal Assist ("Auto" / "Manual · Sport Mode"). Auto =
  the existing flow unchanged. Manual reveals the chat workspace.

### B. Manual mode = proposal-scoped chat workspace
- **Upload files:** reuse the existing upload; show what's loaded (RFP +
  attachments + Vault docs) as the active context, visibly.
- **Chat box** (like Mindy Chat): user types — e.g. "draft the technical
  approach using our NAVSEA past performance", "what does the RFP require for
  past performance?", "tighten section 3 to 2 pages". The LLM answers / drafts,
  grounded ONLY in the uploaded files + Vault (not the global KB).
- **Streamed responses** (reuse the SSE engine) so the user "sees everything
  happening" — exactly what Eric wants.
- **Grounded + cited:** answers cite which uploaded doc / Vault item they used.
- **Pull a result into the draft:** a "use this" action that lands the LLM's
  output into the proposal draft/section.

### C. Reuse, don't fork
- New route `/api/app/proposal/chat` = a thin wrapper on the chat engine with
  proposal-scoped context (files + Vault) + a proposal-writer system prompt.
- New UI = a chat panel inside Proposal Assist's Manual mode (mirror
  MindyChatPanel).

**v1 = both modes work, basic. That's it. Ship it.**

---

## 4. v2.0 (explicitly NOT June 19 — Eric)

- **Notes:** a per-proposal notes area ("is there a place we take notes?").
- **Compliance-matrix collaboration:** who's doing what + where it stands
  (assignee + status per requirement) — the legacy tracking Eric referenced.
- **Draft version history:** v1.0 / v2.0 / v3.0 of sections, diff/restore.
- **Multi-user / teaming** on a single proposal (ties into Team Access).

---

## 5. Risks / gotchas

- **Context size:** big RFPs + attachments + Vault can exceed the model window.
  Chunk + retrieve (the chat engine already does RAG) rather than stuffing
  everything; surface "drafting from these N sources."
- **Scope discipline (June 19):** resist pulling v2 items in. The toggle + a
  working proposal-scoped chat that can draft into the response = done.
- **Don't break Auto:** Manual is additive; the one-one-one Auto flow stays
  exactly as shipped (default).
- **Grounding:** Manual mode must ground in the user's OWN files (not the global
  KB) — a proposal must not cite random training content.

---

## 6. Success criteria (v1)

- A user can toggle to Manual, upload project files, and have a streaming chat
  that reads them + the Vault and helps write the proposal.
- The user can pull a chat-generated section into the actual draft.
- Auto mode is unchanged and still default.
- Shipped by June 19.

---

## 7. Decision log
| Date | Decision | By |
|---|---|---|
| 2026-06-05 | Add Manual/Sport mode = Perplexity-style proposal chat (upload + type + LLM), reusing the Mindy Chat engine scoped to the proposal's files + Vault. Auto↔Manual toggle, Auto stays default. v1 = both modes basic by June 19; notes + collab tracking + draft versions = v2.0. | Eric |
