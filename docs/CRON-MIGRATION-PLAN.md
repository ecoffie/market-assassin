# Cron Migration Plan — vercel.json 100 → ~50

**Status:** Diagnosed 2026-06-19. Plan only — no migration executed yet.
**Goal:** Get off the Vercel 100-cron hard cap (currently at exactly 100 — the next
deploy that adds a native cron fails the whole deploy, per CLAUDE.md rule #5).
**Target:** ~50 native crons, the rest on the dispatcher (`cron_jobs` rows).

---

## Why we're at 100: batch-window duplication

76 of the 100 crons are just **8 jobs** registered 5–21× each to fire repeatedly
across a time window (the legacy pattern from before the resumable-batch design).
The dispatcher replaces this: ONE `cron_jobs` row, the job returns `remaining`/
`templatesRemaining`, and the dispatcher re-fires it on the next tick until drained.

| Route | Native crons | Category |
|-------|-------------:|----------|
| daily-alerts | 21 | SEND (Phase 2) |
| weekly-alerts | 10 | SEND (Phase 2) |
| send-briefings-fast | 10 | SEND (Phase 2) |
| send-weekly-fast | 10 | SEND (Phase 2) |
| send-pursuit-fast | 10 | SEND (Phase 2) |
| precompute-briefings | 5 | PRECOMPUTE (Phase 1) |
| precompute-weekly-briefings | 5 | PRECOMPUTE (Phase 1) |
| precompute-pursuit-briefs | 5 | PRECOMPUTE (Phase 1) |
| ~16 single/low-count utility + watchdog + sync routes | ~24 | MAINTENANCE (Phase 1) |
| dispatch (stays native) | 2 | — |

- SEND pipeline: **61 crons / 5 jobs**
- Precompute: **15 crons / 3 jobs**
- Other maintenance/utility: **24 crons**

All 8 big jobs already emit resumability signals (`remaining`, `templatesRemaining`,
`catchup`, `BATCH_SIZE`) — confirmed 2026-06-19 — so collapsing their windows is safe.

---

## Phase 1 — Safe (do now, before demo): 100 → ~63

Migrate everything EXCEPT the live email-send pipeline. Zero risk to email delivery.

**Move to dispatcher (`cron_jobs` rows):**
- precompute-briefings, precompute-weekly-briefings, precompute-pursuit-briefs
  (15 crons → 3 rows). These run nightly windows; collapse each to one daily row at
  the window start — the job already skips already-built templates + returns
  `templatesRemaining`, and the dispatcher re-fires until drained.
- Maintenance/utility (24 crons → ~9 rows): sync-sam-opportunities, snapshot-multisite,
  backfill-sam-descriptions, backfill-sam-attachments, briefing-watchdog,
  sam-sync-watchdog, manage-briefing-rollout, bootcamp-rollout, check-briefing-health,
  check-fms-health, check-provider-health, check-alert-throughput, refresh-contracts,
  sync-usaspending-awards, extract-sam-events, weekly-digest.

**Net:** ~37 native crons removed → **~63 remain**. Real headroom; unblocks deploys.

**How (per job), following rule #5 + #6:**
1. INSERT a `cron_jobs` row (route + cron_expr, minute **:00 or :05 only** — see
   gotcha below). Service-role INSERT is fine programmatically.
2. Remove that route's entries from `vercel.json`.
3. Deploy. Verify the job's `last_run_at` populates on the next matching tick.

---

## Phase 2 — After June 27: ~63 → ~50 (the send pipeline)

The 61 send-pipeline crons are windows that fire every 10–15 min (e.g. daily-alerts:
:00/:15/:30/:45 from 05:00–10:00 UTC). To collapse these to dispatcher rows, the
**dispatcher must tick more often than hourly** — today it ticks `0 * * * *` (hourly)
+ `5 0 * * *` (daily). A send window needs ~every-15-min coverage.

**Required first:** add a sub-hour dispatcher tick, e.g. `*/15 * * * *` (or `*/10`).
That's ONE native cron that enables collapsing all 61 send crons into ~5 dispatcher
rows (one per send job, each re-fired every 15 min across its window until the batch
drains — exactly what the windows do today, but driven by `remaining`).

**Net after Phase 2:** 61 send crons → ~5 rows + 1 new dispatcher tick →
**~63 − 56 ≈ ~50 native crons.** Target hit.

**Why after the demo:** this touches live email delivery (daily/weekly/pursuit alerts
+ sends). The dispatcher's hourly-only cadence today can't drive a 15-min send window,
so it needs the tick change + careful verification that every user still gets exactly
one send per cycle (the windows exist for timezone coverage + dedup). Not worth the
risk before June 27.

---

## Gotchas (learned the hard way — 2026-06-18/19)

1. **Dispatcher fires on EXACT minute match.** It ticks only at minute :00 (hourly)
   and :05 (daily). A `cron_jobs` row with minute :50 (or any non-:00/:05 minute)
   NEVER fires. snapshot-metrics was dead for days this way. Use minute :00 (or :05).
   Memory: `dispatcher_is_hourly`.
2. **Vercel skips hourly ticks occasionally.** A daily job pinned to one hour can be
   silently skipped for days. FIXED 2026-06-19 with `isMissed()` catch-up in the
   dispatcher — daily/weekly jobs now run on the next tick if their hour was skipped.
   This makes Phase-1 daily rows safe.
3. **Long jobs "timeout" in the dispatcher log but still complete.** The dispatcher
   aborts its fetch at 55s (`fireJob`, maxDuration 60), but the invoked function keeps
   running to its own maxDuration. sync-stripe-cache logs "timeout" at 55s yet finishes
   in ~2 min (cache verified fresh daily). For migrated long jobs, expect the same
   log; verify by the job's OUTPUT (data freshness), not the dispatcher status.
   *(Optional polish: have fireJob treat a long-job abort as "fired async" not
   "timeout" so the log isn't misleading.)*
4. **Resumable jobs need a soft time budget + `remaining`.** All 8 big jobs already
   have this. Any new migration target must too, or it can't span a window.

---

## Quick reference: execution checklist (Phase 1)

- [ ] Script: INSERT cron_jobs rows for the ~12 Phase-1 jobs (minute :00, sensible hours)
- [ ] Verify each row's cron_expr minute is :00 (dispatcher-reachable)
- [ ] Remove the corresponding entries from vercel.json (~37 lines)
- [ ] `npm run predeploy` (the gate) + deploy
- [ ] Watch `cron_job_runs` for 24–48h: every migrated job shows a success run
- [ ] Confirm native cron count: `grep -c '"path"' vercel.json` → ~63

*Owner: Eric / next session. Cap-relief is Phase 1; the ~50 target needs Phase 2.*
