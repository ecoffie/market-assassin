# Podcast Highlight Notes — Today's Intel Mindy Insight

Guest quotes on the **Today's Intel** hero card (`MindyInsightCard`), matched to the user's NAICS profile. Distinct from **email** Mindy Insights (#91 in daily-alerts cron).

**Status (June 4, 2026):** **LIVE** — `ENABLE_PODCAST_INSIGHTS=true`, `PODCAST_INSIGHTS_ROLLOUT_PERCENT=100` on Vercel Production.

---

## What users see

| Footer label | Mode | Source |
|--------------|------|--------|
| **today's market** | Pulse | Briefing AI or deterministic opp stats |
| **guest lesson** | Lesson | Podcast `key_lessons` from a matched guest |

One quote per day. Cached in `dashboard_insights` per `(user_email, insight_date)`.

---

## Pulse vs lesson logic

Implemented in `src/lib/dashboard/insight-pulse-lesson.ts` → `selectPulseOrLesson()`.

1. **Urgent opp** in today's briefing (deadline ≤ 14 days) → **pulse**
2. **Strong guest fit** (≥50% relevance, primary/sector match) → **lesson**
3. Two guest days in a row → **pulse** (variety)
4. Briefing exists, weak guest → **pulse**
5. Viable guest (≥36% fit) → **lesson**
6. Refresh (↻) → prefer the *other* source type when both exist

---

## Data pipeline

```
GovCon Podcast transcripts (mindy_rag_documents)
        ↓
scripts/extract-podcast-metadata.js  →  podcast_episode_metadata
        ↓  key_lessons[], naics_mentioned[], topics[], guest_name, …
src/lib/rag/podcast-naics-relevance.ts  →  industry-fit score 0–100
        ↓
/api/app/dashboard/insight  →  pulse vs lesson pick  →  dashboard_insights cache
```

~312+ guest episodes with extracted metadata as of June 2026.

---

## Feature flags (Vercel)

| Variable | Values | Notes |
|----------|--------|-------|
| `ENABLE_PODCAST_INSIGHTS` | `true` / unset | Master switch for **in-app card only** |
| `PODCAST_INSIGHTS_ROLLOUT_PERCENT` | `0`–`100` | `userBucket(email) < N` — stable per user |

**Do not confuse with email flags:**

| Variable | Status |
|----------|--------|
| `ENABLE_MINDY_INSIGHTS` | Keep **OFF** — daily-alerts per-opp RAG; crashed cron May 28–31 |
| `MINDY_INSIGHTS_ROLLOUT_PERCENT` | `0` |

---

## QA tools

| Tool | How |
|------|-----|
| **Admin UI** | `/admin/podcast-highlights` (admin password) |
| **Offline HTML** | `node scripts/export-podcast-highlights-review.js 236220` |
| **CLI** | `node scripts/test-podcast-insights.js 541512` |

Browse tab: sorted by **industry fit %** (not raw DB order). Toggle **Show tangential matches** to audit false positives (e.g. CMMC mixed into construction NAICS).

Preview tab: **ungated** vs **production lesson gate** side by side.

---

## Rollout history

| Date | `PODCAST_INSIGHTS_ROLLOUT_PERCENT` |
|------|-----------------------------------|
| 2026-06-04 | 5 → 100 (full production same day after QA) |

Recommended if re-introducing gradually: 5 → 25 → 100 over 2–3 weeks, watching support + `/admin/podcast-highlights` quality stats.

---

## Disable / rollback

```bash
ENABLE_PODCAST_INSIGHTS=false
# or
PODCAST_INSIGHTS_ROLLOUT_PERCENT=0
```

Redeploy. Users revert to briefing → deterministic → static fallback (pulse only).

---

## Improve extraction quality

```bash
cd market-assassin
node scripts/extract-podcast-metadata.js --force --limit=50
```

Re-run on thin episodes. Prompt lives in `scripts/extract-podcast-metadata.js` (`key_lessons` = 3–5 actionable sentences per guest).

Future: dedicated `highlight_quotes[]` column for ≤15-word card copy without truncation.
