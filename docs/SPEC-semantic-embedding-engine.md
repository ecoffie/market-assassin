# SPEC — Semantic Embedding Engine + Recompete SOW Match

**For:** Codex (or any implementing agent). Self-contained — every number measured
against live data June 2026.
**Repo:** `/Users/ericcoffie/Market Assasin/market-assassin` (Next.js 16 App Router,
Supabase Postgres, TypeScript).

---

## 1. The goal (two features, one engine)

1. **Recompete 1:1 SOW match** — On an expiring federal contract, surface the
   **likely incumbent's Statement of Work** (recovered from an old solicitation),
   matched by MEANING, with a confidence score. *"Here's the actual scope the
   incumbent is performing — 6-18 months before the recompete re-posts."* This is
   the BD-moat feature.
2. **Semantic "find work like mine"** — User describes their capability; surface
   opportunities whose MEANING matches even when titled with names you'd never
   search (a "building envelope" contract that's secretly cybersecurity). (Phase 2,
   optional this round.)

Both need the same thing: **embeddings over the SOW corpus + cosine search.**

---

## 2. What already exists (DO NOT rebuild)

- **The SOW corpus is BUILT.** Table `sam_opportunities` has these columns
  (populated tonight by `/api/cron/sow-catalog` + `scripts/sow-catalog-drain.ts`):
  - `has_sow_doc BOOLEAN` — true if a real scope doc was found in attachments
  - `sow_doc_type TEXT` — `sow | pws | soo | combined | specs`
  - `sow_text TEXT` — the extracted scope text (6K–16K chars, null bytes stripped)
  - `sow_filename TEXT`, `sow_checked_at TIMESTAMPTZ`
  - **7,009 rows where `has_sow_doc = true`** (catalog COMPLETE as of June 2026):
    4,711 active + 2,298 recompete/expired. **6,901 have `sow_text`** (embeddable).
    By type: SOW 3,055 · PWS 1,573 · Specs 1,408 · Combined 869 · SOO 104.
- **Detection lib:** `src/lib/sam/sow-detect.ts` (`scanAttachmentsForSow`,
  `classifyByFilename`). Reuse, don't touch.
- **Profile engine:** `src/lib/market/profile-from-text.ts`
  (`buildProfileFromText`) — turns a capability statement into industry + NAICS +
  keywords. Reuse for the user side of "find work like mine."
- **LLM helper:** `src/lib/llm/call-llm.ts` — `callLLM({job:'reasoning'})` →
  gpt-4o-mini. `OPENAI_API_KEY` is set in `.env.local`.
- **Expiring Contracts UI:** `src/components/app/panels/RecompetesPanel.tsx`
  (interface `ExpiringContract` has `piid`, recipient, expiration). Fed by
  USASpending; each row carries a **PIID** (e.g. `W91ZLK24P0041`).
- **Award detail lib:** `src/lib/usaspending/award-detail.ts` (`resolvePiidToId`)
  + `src/lib/usaspending/find-predecessor.ts`.

---

## 3. THE CRITICAL CONSTRAINT (measured — do not ignore)

**An expiring contract CANNOT be joined to its SOW by any ID. Measured: 0% exact
match** across 30 contracts.
- Expiring contract is keyed by **PIID** (`W91ZLK24P0041`, assigned at AWARD).
- A recovered SOW is keyed by **solicitation_number** (`36C24126Q0443`, assigned at
  SOLICITATION, years earlier).
- SAM/USASpending store NO crosswalk between them.

**Therefore the link MUST be semantic (by meaning), pre-filtered by agency + NAICS.**
This is the whole reason the engine exists. (99% of recovered SOWs have a
`solicitation_number`, but it never matches a PIID — confirmed.)

---

## 4. Architecture decision: in-app cosine (NOT pgvector)

**pgvector is NOT installed** on this Supabase (the existing `mindy_rag_chunks`
table is full-text/tsvector only — verified). Enabling it needs a dashboard toggle.

**Use in-app cosine instead — it's the RIGHT tool here, not a compromise:**
- The recompete match ALWAYS pre-filters SOWs to the expiring contract's
  **agency + 3-digit NAICS** → ~50–300 candidate SOWs, never the full 12K.
- Cosine over a few hundred 1536-float vectors in Node is **instant**.
- No extension dependency, fully shippable now.
- pgvector becomes a later optimization ONLY if full-corpus "find work like mine"
  (scan all 12K per query) is added.

**Cost:** OpenAI `text-embedding-3-small`, 1536-dim. Measured **$0.00000016 per
SOW** → embedding the entire 6,901-SOW corpus costs **~$0.0011 total.** Negligible.

---

## 5. Build plan

### Phase A — Schema (hand-run migration; no in-app DDL on this DB)
Add to `sam_opportunities`:
```sql
ALTER TABLE sam_opportunities
  ADD COLUMN IF NOT EXISTS sow_embedding   JSONB,        -- 1536-float array as JSON
  ADD COLUMN IF NOT EXISTS sow_embedded_at TIMESTAMPTZ;  -- backfill cursor
CREATE INDEX IF NOT EXISTS idx_sam_sow_embed_todo
  ON sam_opportunities (sow_embedded_at NULLS FIRST)
  WHERE has_sow_doc = true AND sow_text IS NOT NULL;
```
Author as `supabase/migrations/YYYYMMDD_sow_embeddings.sql`, `pbcopy`, user pastes +
runs in Supabase, confirms "Success. No rows returned", then verify columns exist.
(See the `/migrate` skill / Process Non-Negotiables.)

### Phase B — Shared embedding lib
`src/lib/market/embeddings.ts`:
- `embedText(text: string): Promise<number[]>` — POST to
  `https://api.openai.com/v1/embeddings`, model `text-embedding-3-small`, input =
  `text.slice(0, 8000)` (token cap). Returns the 1536-float array. Throttle/retry
  on 429.
- `cosineSimilarity(a: number[], b: number[]): number` — standard dot/magnitude.
- `topMatches(queryVec, candidates: {id, vec, ...}[], k): {id, score, ...}[]`.
Pure functions so the cron, the backfill script, AND the API route reuse them.

### Phase C — Backfill the corpus (local runner — NOT an HTTP loop)
`scripts/sow-embed-drain.ts` — mirror `scripts/sow-catalog-drain.ts`:
- Claim `has_sow_doc=true AND sow_text IS NOT NULL AND sow_embedded_at IS NULL`,
  PAGE=200, concurrency pool ~10.
- For each: `embedText(sow_text)` → store array in `sow_embedding`, stamp
  `sow_embedded_at`. Per-record `Promise.race` 30s timeout. Strip nothing (text
  already clean). Resumable.
- **Run locally** (`npx tsx scripts/sow-embed-drain.ts`): ~12K rows, embeddings are
  fast — expect minutes, not hours. DO NOT loop the HTTP route (throttles to
  ~50/min; local does 500+/min — learned the hard way #66).

### Phase D — Recompete match API
`GET /api/app/recompete-sow?piid=<PIID>&naics=<code>&agency=<name>&description=<text>`:
1. Embed the expiring contract's `description` (title + any USASpending desc) via
   `embedText`.
2. Pre-filter SOWs: `sam_opportunities` where `has_sow_doc=true`,
   `sow_embedding IS NOT NULL`, `naics_code LIKE <3-digit prefix>%`, and
   department/agency match (ilike first word). Pull `id, sow_text(truncated),
   sow_doc_type, sow_filename, title, department, naics_code, sow_embedding`.
   (Typically 50–300 rows.)
3. Cosine-rank the candidates; return top 1–3 with a **confidence score**
   (cosine → a 0–100% label; be honest — call it "likely match", not "the
   incumbent's SOW", below a threshold).
4. Each result: the SOW doc type, the source notice link, and a snippet / full
   `sow_text` for the drawer.
Ground every field in real data; no LLM-invented scope.

### Phase E — Wire into Expiring Contracts UI
`src/components/app/panels/RecompetesPanel.tsx`:
- On each expiring-contract row, add an on-demand **"📄 Find incumbent SOW"** button
  (lazy — calls Phase-D API only when clicked, like the existing IncumbentIntel
  pattern in #57).
- Render the top match in a drawer: confidence %, doc type badge, the scope text,
  and "view source notice" link. If best score < threshold, say "No confident SOW
  match found" (honest miss) rather than showing a weak one.
- Reuse the existing `AwardDetailDrawer` / `IncumbentIntel` component patterns.

### Phase F (optional this round) — "Find work like mine"
A route that embeds a user capability (`buildProfileFromText` text) and cosine-
matches the FULL active-SOW corpus. This one scans everything → if it's built,
consider pgvector then. Surface on ALL SAM as semantic results.

---

## 6. Honest scope / guardrails
- **Confidence threshold matters** — a wrong "incumbent SOW" is worse than none.
  Start conservative; label sub-threshold matches as "possible" or hide them.
- **Pre-filter is mandatory** — never cosine the full 12K per query; always
  agency+NAICS-slice first (keeps it instant + relevant).
- **Don't fabricate** — the SOW shown is a REAL recovered document; the *link* is a
  similarity inference, so label it as such.
- Follow the repo's Process Non-Negotiables: ground in real data, verify before
  done (curl the API for 200 + a real match), commit before deploy, hand-run the
  migration, append a marketing write-up to
  `docs/MARKETING-FEATURE-LITERATURE.md`.

## 7. Acceptance criteria
- [ ] Migration applied; `sow_embedding` populated for all `has_sow_doc=true` rows.
- [ ] `GET /api/app/recompete-sow?...` returns a ranked match with a confidence
      score in <2s for a real PIID.
- [ ] On a known recompete (e.g. a janitorial/IT-services expiring contract), the
      top match is a plausibly-correct SOW of the same work at the same agency
      (spot-check 5).
- [ ] UI button on Expiring Contracts opens the SOW drawer; honest "no match" when
      below threshold.
- [ ] Marketing literature updated; committed + deployed + verified 200.

## 8. Key files (quick map)
| Purpose | Path |
|---|---|
| SOW corpus + new embed columns | `sam_opportunities` (table) |
| Detection (reuse) | `src/lib/sam/sow-detect.ts` |
| Catalog backfill (mirror for embeds) | `scripts/sow-catalog-drain.ts` |
| Profile-from-text (reuse, user side) | `src/lib/market/profile-from-text.ts` |
| LLM/OpenAI helper | `src/lib/llm/call-llm.ts` |
| Expiring Contracts UI | `src/components/app/panels/RecompetesPanel.tsx` |
| Incumbent-intel pattern (reuse) | `src/components/app/awards/IncumbentIntel.tsx` |
| Award detail / PIID resolve | `src/lib/usaspending/award-detail.ts` |
| The why (background) | `docs/PRD-semantic-hidden-work-discovery.md` |
