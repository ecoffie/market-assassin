# Plan — Ingest 500+ Coaching/Assessment Calls into Mindy's RAG

**Branch:** `feat/rag-coaching-calls-ingest` (created off `main`, clean)
**Goal:** Add Eric's proprietary 1-on-1 + group GovCon calls to the RAG corpus as a new
`doc_type = 'coaching_call'`, so Mindy can pull from real coaching conversations no
competitor has. Reuse the existing pipeline (`mindy_rag_documents` + `mindy_rag_chunks` +
`get_rag_chunks()` RPC). NO new infra, NO new UI — just a new ingest script + one RPC
ranking line + an audit pass.

---

## What already exists (don't rebuild)
- Schema: `mindy_rag_documents`, `mindy_rag_chunks` (FTS `tsvector` generated col).
- Retrieval: `get_rag_chunks(q, doc_types_filter, limit_n)` RPC, ranked by
  `ts_rank_cd * doc_type_boost`; `retrieveRagContext()` in `src/lib/rag/retrieve.ts`.
- Ingest convention (template = `scripts/ingest-fort-belvoir-bid.js`):
  `.env.local` parse → idempotent delete-by-`source_path` → 500-word/50-overlap
  chunker → insert doc (status `extracted`) → insert chunks (denormalized doc fields).
- Deployed bridge `/api/admin/rag-library?action=upsert-rag-docs` (25-doc batches,
  password-gated) — used when local Supabase keys are stale. Pattern in
  `scripts/ingest-proposal-template-corpus.js`.

## Sources identified (the "500+")
1. **Fireflies folder** (Drive `parentId 1N4ud8ar-nDHo-mNRU3FPRI7DS_ArPTm3`, owner
   `hello@govconedu.com`): one `.docx` per call, named
   `<Name>- GCG Discovery Call-transcript-<ISO>.docx`. **100 in first page,
   `nextPageToken` present → hundreds total.** The bulk of the corpus.
2. **"Assessment Call Transcripts"** Google Doc (466 KB, id
   `1rR0BL2Aq0apYZsA07ggg6AqxfuI7mVuWK0kolWXCW04`): many older 1-on-1 assessment
   calls concatenated, segmented by `# Member Name` headers, speaker-tagged
   (`Eric Coffie:` / member). Split into one doc per member.
3. Per-member standalone Google Docs (e.g. "Leslie Faircloth") + `GOVCON GIANTS/
   Tuesday Calls` group-coaching recordings (secondary; include if time permits).

**Fetch reality:** these live in Drive cloud and are NOT reliably synced to the local
Drive Desktop mount (Fireflies folder is API-only; Tuesday Calls not pinned). So the
ingest script fetches via the **Drive API**, not the filesystem mount.

## Exclusions (must filter out — not teaching content)
Title-based skip for internal ops: `Weekly Eric Team Meeting`, `Marketing Team
Meeting`, `Interview with Candidate`, `... Team Meeting`, and any non-member internal
sync. These would pollute Mindy with internal chatter. Skip, or mark
`has_pii=true` + `doc_type='meta_doc'` so they're excluded from retrieval.

---

## Implementation steps

### 1. Migration — register the new doc_type ranking
`supabase/migrations/2026____rag_coaching_call_doctype.sql`
- Add `WHEN 'coaching_call' THEN 2.0::real` to the `CASE c.doc_type` boost in
  `get_rag_chunks()` (CREATE OR REPLACE the whole function — coaching calls are
  high-value proprietary content, rank alongside cap_statement/past_performance).
- `NOTIFY pgrst, 'reload schema';`
- (No table change needed — `doc_type` is free-text TEXT.)

### 2. Drive export helper
`scripts/lib/drive-export.js` (small, reusable)
- Auth via existing Google creds in `.env.local` (the project already talks to Drive;
  reuse the service-account / OAuth token already configured for podcast + proposal
  ingest). If no programmatic Drive token exists, fall back to the **MCP-export-to-disk**
  pre-step: a one-time dump of the Fireflies folder + assessment doc to
  `tasks/cache/calls/` as `.txt`, then ingest reads from there. (Decide at build time
  based on what creds `.env.local` actually has — check first.)
- Functions: `listFolder(folderId)` (paginated, follows `nextPageToken`),
  `exportDocText(fileId)` (Google Doc → text), `exportDocxText(fileId)` (download +
  extract via `mammoth`, already a dep used elsewhere).

### 3. Main ingest script
`scripts/ingest-coaching-calls.js` (modeled on fort-belvoir + proposal-corpus)
- Flags: `--apply` (default dry-run), `--source=fireflies|assessment-doc|all`,
  `--limit=N`, `--endpoint=https://getmindy.ai` (use bridge if local keys stale).
- **Fireflies path:** list folder → for each `.docx`:
  - skip via exclusion filter (internal meetings),
  - parse member name + call type + date from filename,
  - extract text, clean Fireflies boilerplate (speaker labels kept, "powered by
    Fireflies" footer stripped),
  - build `source_path = 'gdrive:fireflies/<fileId>'` (idempotency key),
  - `doc_type='coaching_call'`, `top_level_folder='Coaching Calls'`,
    `title='<Name> — <CallType> (<date>)'`, `usage_rights='eric_owned'`,
    `topic_tags=['coaching-call','discovery-call', ...heuristic NAICS/topic]`,
    `one_line_summary` (first ~25 words or a 1-line heuristic).
- **Assessment-doc path:** export the big doc once → split on `^# (.+)$` member
  headers → one doc per member, `source_path='gdrive:assessment-doc/<member-slug>'`.
- Chunk (500/50) → insert doc + chunks exactly like fort-belvoir. Idempotent
  delete-by-`source_path` first.
- Progress logging to `tasks/logs/rag-coaching-calls-<ts>.log` (mirror existing logs).

### 4. Run — staged
1. `node scripts/ingest-coaching-calls.js --source=fireflies --limit=5`  ← dry-run, eyeball
2. `... --source=fireflies --limit=5 --apply`  ← 5 real, verify in DB
3. `... --source=assessment-doc --apply`  ← split + load the big doc
4. `... --source=fireflies --apply`  ← full Fireflies sweep (paginate all)

### 5. QA gate (per CLAUDE.md — no deploy without QA)
Test criteria defined upfront:
- [ ] Corpus count: `mindy_rag_documents WHERE doc_type='coaching_call'` ≥ 300
      (proves we actually got the bulk, accounting for excluded internal meetings).
- [ ] No internal-ops docs leaked: 0 rows where title matches the exclusion list.
- [ ] Chunks present: every coaching_call doc has ≥1 chunk.
- [ ] Retrieval works: `test-rag-retrieve.js` extended with 3 coaching queries
      (e.g. "how do I respond to a sources sought", "I'm a painter just getting
      started", "subcontracting with primes") returns `coaching_call` chunks ranked
      at/near top.
- [ ] Spot-check 3 returned chunks are real coaching dialogue, not boilerplate.
- [ ] No raw PII surfaced unintentionally (user chose "ingest fully, no restriction",
      so this is a sanity check, not a blocker — confirm no payment/SSN-type data).
- Document pass/fail in the run log + commit message.

### 6. Docs
- Update `market-assassin` `CLAUDE.md` "Recent Work" with the new source + counts.
- Update `docs/marketing/RAG-WHITEPAPER.md` corpus table (add Coaching Calls row).
- Memory: update `[[project_mindy_seo_rolling_status]]` neighborhood or add a
  `project_mindy_rag_corpus` memory noting coaching_call ingestion + counts.

---

## Open decisions resolved
- **Scope:** BOTH Fireflies + assessment doc (+ Tuesday/group if time). ✔ (user)
- **doc_type:** single `coaching_call`, boosted 2.0. ✔ (user)
- **Privacy:** ingest fully, no restriction; PII step is a sanity check only. ✔ (user)

## Risk / unknown to resolve at build time (step 2)
**Does `.env.local` have a programmatic Drive token** (service account / OAuth refresh)
that the existing podcast/proposal scripts use? If yes → script self-serves via Drive
API. If no → add a one-time MCP-export-to-disk pre-step (I dump the files to
`tasks/cache/calls/`, the script ingests from disk). Either way the ingest logic is
identical; only the fetch source differs. This is the first thing I'll verify on build.
