# Plan — Phase 2: Transcribe the GovCon Giants video library into Mindy's RAG

**Status:** Scoped 2026-06-28 (after Phase 1 docs landed: 22 Vault/Courses teaching
docs ingested). NOT started. This is a **budgeted project**, not a quick win.
**Trigger:** Eric confirmed the course platform does **NOT** have transcripts, so the
"cheap, pull-the-captions" path is off the table — the video teaching must be
**transcribed** (Whisper).

---

## TL;DR
The bulk of the GovCon Giants moat (the entire bootcamp / course / webinar library,
~700–1,000+ recordings) lives in **video**, with **no existing transcripts**. To get
it into Mindy's RAG we must: get the video bytes → extract audio → transcribe with
Whisper → chunk → ingest (reusing the Phase-1 FTS pipeline). Rough cost **~$200–400
in Whisper** + a real download/transcode pipeline + bandwidth. **Phase it** (highest-
value course first), prove the pipeline on a small pilot, then scale.

---

## The two blockers (both must be solved)

### 1. Getting the video bytes (access)
The recordings are large `.mp4` files (observed **240 MB and 467 MB** each; 1–3 hr
sessions) under **My Drive › GOVCON EDU › Courses**, deeply nested
(`<course/bootcamp> › Section/Day › *.mp4 + *.key`). Plus the FHC course-platform
copies (Teachable, per the syllabus).
- The **claude.ai Drive integration CANNOT download these** — it pulls content into
  the chat context; a 467 MB file is impossible that way.
- **`gcloud` is not installed** on Eric's machine (confirmed Phase 1).
- → Need a **Drive REST access token** to download bytes server-side. Options:
  - **OAuth Playground** (`developers.google.com/oauthplayground`, scope
    `drive.readonly`) — no install, ~2 min, token lasts ~1 h. Best low-friction path.
  - Install `gcloud` (`brew install --cask google-cloud-sdk`) for a renewable token.
  - If the canonical videos are on the **course platform** (Teachable/Wistia/Vimeo),
    that host's API/download may be a better source than the Drive `.mp4` copies —
    **decide the canonical source first** (see Step 0).

### 2. No transcripts → must run Whisper
- OpenAI **Whisper-1** is already wired (`OPENAI_API_KEY` present;
  `src/app/api/app/voice/transcribe/route.ts`) but that route is built for **short
  clips** (25 MB / 120 s cap). Long recordings need **direct Whisper API calls with
  audio chunking** (Whisper hard-caps uploads at **25 MB** ≈ ~30 min of compressed
  audio, so a 2 hr session = ~4 chunks).

---

## Pipeline design (reuse Phase 1 where possible)

```
for each video:
  1. DOWNLOAD  mp4  (Drive REST: GET /files/<id>?alt=media, with ACCESS_TOKEN
                     + X-Goog-Drive-Resource-Keys for 0B… folders)  → /tmp
  2. EXTRACT   audio: ffmpeg -i in.mp4 -vn -ac 1 -ar 16000 -b:a 32k out.mp3
               (mono 16 kHz keeps chunks small + is plenty for speech)
  3. SPLIT     into <25 MB / ~20-min segments (ffmpeg -f segment) if needed
  4. TRANSCRIBE each segment → Whisper-1 (response_format=text, the federal-jargon
               prompt from voice/transcribe), concatenate in order
  5. INGEST    one mindy_rag_documents row (full transcript) + 500/50 chunks,
               via scripts/ingest-vault-docs.js --from-cache (write <id>.txt/.json
               to disk → direct Supabase insert). doc_type per source (below).
  idempotent by source_path = 'gdrive-video:<fileId>'; resumable (skip if exists).
```

**Reuse:** the Phase-1 `--from-cache` ingest path (chunking, idempotency, per-doc
`docType`, FTS — **no embeddings needed**); the same `.env.local` (sanitize the
`vercel env pull` trailing `\n`); the same Drive resource-key handling.
**New code:** a `scripts/transcribe-videos.mjs` that does download → ffmpeg → split →
Whisper → write cache `.txt/.json`. Needs `ffmpeg` installed locally.

### doc_type / ranking
Add boosts in `get_rag_chunks()` (one CREATE OR REPLACE migration, like
`20260628_rag_vault_doctype.sql`):
- `course_video` → 1.3 (course lessons — the Academy/Accelerator)
- `bootcamp_replay` → 1.3 (Proposal / Business-Readiness / Surge bootcamps)
- `webinar_replay` → 1.3 (webinar/Q&A recordings)
(Precedent: 743 `podcast_interview` docs already in the corpus via the same idea.)

---

## Cost & scale (estimate)
Whisper = **$0.006 / audio-minute**. Source counts from the V2 flagship backlog item:
| Bucket | ~Lessons | ~Avg min | ~Minutes | ~Whisper $ |
|---|---|---|---|---|
| Federal Contract Academy (Essentials/Comp/Mastery + Overview) | ~515 | 15 | 7,700 | ~$46 |
| Bootcamp replays (coaching 2018–24 + recent bootcamps) | ~200 | 60 | 12,000 | ~$72 |
| First Partner Challenge + Blueprint-to-Consulting | ~60 | 45 | 2,700 | ~$16 |
| Webinars / Q&A / roadmap | ~150 | 60 | 9,000 | ~$54 |
| **Total** | **~925** | | **~31,400** | **~$190** |
Plus a buffer for re-runs → **~$200–400 all-in Whisper.** Non-trivial but not huge.
The bigger costs are **engineering time** (the pipeline) + **bandwidth/disk**
(downloading hundreds of GB of `.mp4`) + **wall-clock** (transcription is slow —
batch it).

---

## Phasing (do NOT big-bang)
- **Step 0 — Decide the canonical video source** (Drive `.mp4` vs Teachable/Wistia/
  Vimeo platform). Pick whichever gives the cleanest bulk download. Get the access
  token for it.
- **Pilot (prove + measure):** the **Proposal Bootcamp** recordings (~5 sessions) —
  highest value for Proposal Assist, small enough to validate download→ffmpeg→Whisper→
  ingest end to end and get a real per-hour cost/time number.
- **Phase 2a — Federal Contract Academy** (the structured curriculum; maps 1:1 to the
  10-week syllabus already ingested as a doc).
- **Phase 2b — Bootcamp replays** (Proposal / Business-Readiness / Surge / coaching).
- **Phase 2c — Webinars / Q&A / First Partner Challenge.**
- Each phase: resumable, logs what it skipped, re-runnable.

## Risks / gotchas
- **Download access** is the real gate — solve Step 0 + token first.
- **25 MB Whisper cap** → must split long audio (handled in pipeline).
- **Speaker noise / multi-speaker** (Q&A, coaching calls) → Whisper handles it but
  quality varies; the federal-jargon prompt helps.
- **`has_pii` on coaching/Q&A** (real student names/businesses) → tag + filter from
  retrieval like the Knowledge Base repo does (same rule as Phase 1 curation).
- **Idempotent + resumable** is mandatory (long job, tokens expire, re-runs happen).
- **Don't transcribe what's already covered** — some bootcamp slides were already
  ingested as docs (Phase 1); the video adds the spoken teaching, which is additive.

## Success criteria
- A `scripts/transcribe-videos.mjs` that, given a Drive folder + token, drains all
  videos → transcripts → RAG, resumably.
- Pilot proves real cost/time per hour of video.
- Retrieval: a query like "how do I price a federal bid / Davis-Bacon" returns the
  matching course-video transcript chunk at/near top.
- Corpus grows from the Phase-1 doc slice toward the full ~925-lesson library.

## Open decisions for Eric (when this starts)
1. Canonical video source — Drive `.mp4` or the course platform? (drives the download
   approach)
2. Access token method — OAuth Playground (quick) vs install gcloud (renewable)?
3. Budget sign-off — ~$200–400 Whisper + the engineering/bandwidth; phase order ok?
