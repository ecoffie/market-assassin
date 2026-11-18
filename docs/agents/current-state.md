# Current state: priority order, in-flight work, pending tasks

> Moved verbatim from the root `CLAUDE.md` on 2026-11-17 (instruction cleanup). Nothing was removed; wording changed only where marked **[Release control 2026-11-17]**. Root `CLAUDE.md` rule 15 overrides anything here.

## 🎯 Current priority order — READ BEFORE PICKING UP WORK

**Set by Eric, 2026-08-23. This is the ONE place the roadmap lives** — permanent docs
deliberately don't restate it, because a stale hierarchy is exactly the confidently-wrong
instruction that misdirects a fresh session.

> **SBDC + SAME speaking campaign → government follow-ups from Navy/NAPEX → product work
> validated by those conversations → operational integrity debt**

⚠️ **Navy and NAPEX are FINISHED.** They no longer govern the roadmap; what remains from them
is FOLLOW-UP, not preparation. Any instruction still treating a Navy/APEX demo as an upcoming
deadline is stale — ignore it and fix it.

**The near-term objective is to turn Mindy's intellectual property into SPEAKING AUTHORITY.**
For SBDC and SAME, the Institute, the Observatory, Market Research, Supplier Discovery,
Competition Health and the accumulated evidence are no longer just product features — they are
**the substance behind Eric's talks**.

**So the test for new build work is: does this support the campaign, or does it create another
internal surface?** Prefer the former. Default to NO on analytics cleanup and new internal
dashboards unless something is **materially broken**.

- **Measurement integrity is DONE as a project** — it is now a permanent engineering constraint
  (see below), not a workstream. 10/10 claim routes verified. Do not reopen it for tidiness.
- The 10 operational risks and the remaining 118 findings are **ranked by consequence and wait**
  behind the campaign. Exception: something users actually experience (e.g. `daily-alerts`
  delivery) is reliability work, not cleanup.

---

## In-flight work

Lives verbatim at the end of the root `CLAUDE.md` (the SessionStart hook `~/.claude/hooks/inflight-context.sh` extracts it from there).

### Data Core reliability handoff (2026-11-18)

Open, not merged, not deployed. Reviewer and release are outside this session.

| PR | Head to review | What it changes |
|---|---|---|
| [#2168](https://github.com/ecoffie/market-assassin/pull/2168) | `445186168` | DoD SBIR: non-2xx unless a parsed empty list or a real write. `search_sbir` `_meta.dod_cache` is `unverified_empty` when the cache holds nothing. Builds on #2167's `decideDodSbirExecuteOutcome` by requiring list evidence for a zero. |
| [#2169](https://github.com/ecoffie/market-assassin/pull/2169) | `ef210a1d8` | DIBBS/grants clocks: attempt vs nonempty ingest. `/api/app/dibbs` returns `freshness.warning`. Disabled collector cannot stay CURRENT. |
| [#2170](https://github.com/ecoffie/market-assassin/pull/2170) | `6098237b3` | Ask Mindy solicitation status. Restores #1557 (active + no deadline stays open). Unarchived is not "open for responses" for non-respondable notice types. |
| [#2171](https://github.com/ecoffie/market-assassin/pull/2171) | `8a57e7702` | Locks #2165 GAO merge refusal and events prune-report 500. No retire, no adopt, no prune. |
| [#2172](https://github.com/ecoffie/market-assassin/pull/2172) | `8f670de67` (code) | Grants partial ingest is non-2xx. Zero fetch stays an error, not a verified empty. The branch head is the handoff commit on top of that code. |

Dashboard tiles (forecasts, SAM registrations, SBIR, research funding, collector warnings, DIBBS Current while disabled) are a separate agent. For SBIR tiles use `_meta.dod_cache` and the sync `status` field, and do not render an empty cache as "no opportunities". For DIBBS tiles use `freshness` from `/api/app/dibbs` and `honestInstanceState` with the collector disabled; do not use `MAX(synced_at)` as current. Do not set `SAM_EVENTS_PRUNE=apply`. Do not apply `20261118_park_false_green_freshness.sql` without Eric.

## 🔔 Pending Tasks

### Batch Enroll Bootcamp Attendees (April 12-19, 2026)

**Status:** Daily alerts confirmed working at scale. **Eligible audience = 1,540** as
of Jul 11, 2026 (`alerts_enabled=true` AND `alert_frequency IN (daily,weekdays,weekends)`;
alerts_enabled total 1,669) — free-daily is the permanent model. **Jul 11 cap fix (PR
#113, `d34ddd8a`):** the eligibility query silently returned only the first 1,000 PostgREST
rows → ~540 subscribers never processed; now paginated via `.range()` across the dispatcher
window (confirmed live — `processed` climbs past 1,000, sends 931–1,044/day). Capacity:
`DAILY_ALERT_BATCH_SIZE=250` × ~21 dispatcher runs = ~5,250/day; 1,540 drains in ~7 runs
(bump batch toward ~500 only when eligible nears ~3,000). 8,803 bootcamp attendees already
invited (last batch May 21). Remaining enroll batches can proceed.

**Action:** Enroll 8,804 bootcamp attendees from `data/bootcamp-attendees-to-enroll.txt`

```bash
# Run this after verifying alerts are working
cat data/bootcamp-attendees-to-enroll.txt | while read email; do
  curl -s -X POST "https://getmindy.ai/api/alerts/save-profile" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$email\", \"naicsCodes\": [\"541512\", \"541611\", \"541330\"], \"businessType\": \"\", \"source\": \"free-signup\"}"
done
```

**Source:** All GHL contacts with any "bootcamp" tag (contract-vehicles-bootcamp, jan31-bootcamp, feb-proposal-bootcamp, etc.)

---

## JTED 2026 Presentation & Guide

**Event:** AEC Industry Day at MacDill AFB — April 1, 2026

### Presentation
- **File:** `presentations/JTED-2026-Revised.html` (98 slides)
- **PowerPoint:** `presentations/JTED-2026-Compressed.pptx` (8MB, image-based)
- **Export script:** `node presentations/export-slides-compressed.js`
- **Status:** Complete with QR code

### Companion Guide (Complete)
- **Intel Pack PDF:** `presentations/JTED-2026-Intel-Pack.pdf`
- **Slides PDF:** `presentations/JTED-2026-Slides.pdf`
- **Landing page:** `govcongiants.com/jted-2026` (deployed)
- **GHL tag:** `jted-2026-landing`

### Key Files
| File | Purpose |
|------|---------|
| `presentations/JTED-2026-Revised.html` | 98-slide HTML source |
| `presentations/JTED-2026-Compressed.pptx` | PowerPoint (8MB) |
| `presentations/JTED-2026-Intel-Pack.pdf` | Companion guide |
| `presentations/export-slides-compressed.js` | JPEG export + PPTX |

---
