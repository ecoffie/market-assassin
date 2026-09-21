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

## Agency resolution

Unresolved stays unresolved. MULTI_AGENCY candidates are preserved in `raw` — never
coerced to one department. Phrase map: `src/lib/institute/document-agency.ts`.

## Do NOT

- Merge legacy GovInfo `GAOREPORTS` / `agency_intelligence` into these clocks
- Delete `agency-pain-points.json`
- Start IG / Federal Register / CRS from this runbook without an explicit task
- Present AI `build-pain-points` output as SOURCE_FACT

## Verify

```bash
# Instance clocks
npm run db -- data_source_instances --eq source_key=institute_gao

# Living pain points
npm run db -- agency_pain_points_db --eq source=gao --limit 20

# Cron
curl -s "https://getmindy.ai/api/cron/institute-gao-sync?password=$ADMIN_PASSWORD&mode=preview"
```
