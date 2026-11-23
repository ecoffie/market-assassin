# Runbook — Living GAO Institute source (`institute_gao`)

**Dataset:** `strategic_intelligence`  
**Instance:** `institute_gao`  
**Discovery:** https://www.gao.gov/rss/reports.xml  
**Cron:** `/api/cron/institute-gao-sync` (`20 12 * * *`)

## What this source is

GAO RSS → `institute_sources` → optional derived pain point in `agency_pain_points_db`
with an `intelligence_changes` history row. Customer surfaces read via
`src/lib/strategic-intel/sourced-pain-points.ts` (sourced-first, legacy fallback).

## Five clocks (never conflate)

| Clock | Advances when |
|---|---|
| `last_poll` | Every real RSS check attempt |
| `last_successful_check` | Feed read succeeded and parsed documents |
| `last_verified_ingest` | Full reconciliation completed (no partial/fail) |
| `last_data_advance` | Held Institute rows or derived pain points actually changed |
| `last_source_advance` | Newest GAO **publication** date in the feed (never Mindy time) |

`upstream_population` is **NULL** — RSS is a recent-window feed, not an exact corpus.
`held_population` = `count(*)` of `institute_sources` where `source_type='gao_report'`.

## Alerts (ops_alert_state deduped)

- RSS unreachable / poll failure
- Source watermark advances but held did not insert
- Verified ingest incomplete / pipeline failure
- Agency resolution rate degraded (>15pp drop)

## Cron outcome (`cron_job_runs`)

One decision (`src/lib/institute/gao-run-outcome.ts`) drives `last_verified_ingest`, the
self-reported outcome, the response `success`/`status` and the HTTP status. Any incomplete
run (budget cut, ingest failure, held-id lookup failure, reconcile failure, blocked
derivation, oversight.gov lane down) is `partial` / HTTP 503, never `success`, and
`cron_job_runs.error` carries the reason: `category=N [first message | second message]; ...`.
The same reason is appended to the "Verified ingest incomplete" alert body.

## Agency resolution

Unresolved stays unresolved. MULTI_AGENCY candidates are preserved in `raw` — never
coerced to one department. Phrase map: `src/lib/institute/document-agency.ts`.

## Do NOT

- Merge legacy GovInfo `GAOREPORTS` / `agency_intelligence` into these clocks
- Delete `agency-pain-points.json`
- Start Federal Register or CRS from this runbook without an explicit task
- Walk oversight.gov past the first page whose source ids are all already held, or past 8 pages, or past 200 new Institute rows. That is the whole backfill guard.
- Delete or rewrite `agency_pain_points_db` rows, the 278 legacy `(Source: GAO)` strings, the replacement candidates, or `gao_high_risk`
- Present AI `build-pain-points` output as SOURCE_FACT

## Verify

```bash
# Instance clocks
npm run db -- data_source_instances --eq source_key=institute_gao

# Living pain points (GAO and Inspector General)
npm run db -- agency_pain_points_db --eq source=gao --limit 20
npm run db -- agency_pain_points_db --eq source=ig_report --limit 20
npm run db -- institute_sources --eq source_type=ig_report --limit 20

# Cron
curl -s "https://getmindy.ai/api/cron/institute-gao-sync?password=$ADMIN_PASSWORD&mode=preview"
```
