/**
 * Read-only replay of extract-sam-events prune planning for a decision pack.
 * Never deletes. Never sets SAM_EVENTS_PRUNE. Writes tasks/events-prune-decision-pack-*.{json,md}.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { loadActiveCandidates, loadFamilyPool, loadListedRows, loadNoticesById } from '../src/lib/events/event-currency-live';
import { readNoticeEvent } from '../src/lib/events/event-currency';
import {
  buildCandidateSet,
  familiesToLoad,
  planEvents,
  planRetirements,
  pruneMode,
  RETIRE_MAX_ROWS,
  RETIRE_MAX_SHARE,
} from '../src/lib/events/extract-run';

config({ path: '.env.local' });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing Supabase env');

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const today = new Date();
  const deadline = Date.now() + 180_000;
  const listedRows = await loadListedRows(sb, today);
  const listedIds = Array.from(new Set(listedRows.map((r) => r.notice_id)));
  const listedSources = await loadNoticesById(sb, listedIds);
  const active = await loadActiveCandidates(sb, ['Special Notice', 'Presolicitation', 'Sources Sought'], deadline);
  const notices = buildCandidateSet(listedSources, active.rows);
  const ownReadings = new Map(notices.map((n) => [n.notice_id, readNoticeEvent(n, today)]));
  const familyPool = await loadFamilyPool(sb, familiesToLoad(notices, ownReadings));
  const planned = planEvents(notices, familyPool, today);
  const retirement = planRetirements(listedRows, listedSources, new Set(planned.map((p) => p.notice.notice_id)));
  const mode = pruneMode();
  const measuredAt = new Date().toISOString();

  const pack = {
    measured_at: measuredAt,
    mode,
    SAM_EVENTS_PRUNE_set: process.env.SAM_EVENTS_PRUNE ?? null,
    vercel_env_note: 'vercel env ls production had no SAM_EVENTS_PRUNE line (unset)',
    cron_logs_prune_reports: 0,
    cron_logs_total: 0,
    extract_sam_events_last: {
      last_run_at: '2026-11-18T07:00:27Z',
      http_status: 200,
      duration_ms: 5477,
    },
    production_serving_sha: 'c6c9c08644ba51153ab80c764ab23bb718a3a4e0',
    counts: {
      listedRows: listedRows.length,
      listedSourcesFound: listedSources.length,
      listedMissingSource: listedIds.length - listedSources.length,
      activeCandidates: active.rows.length,
      activeComplete: active.complete,
      plannedEvents: planned.length,
      wouldRetire: retirement.wouldRetire,
      proposed: retirement.proposals.length,
      guardSkipped: retirement.skipped,
      RETIRE_MAX_ROWS,
      RETIRE_MAX_SHARE,
    },
    proposals: retirement.proposals,
    rollback: {
      apply_forbidden_until: 'Eric + Agent 5 authorize SAM_EVENTS_PRUNE=apply + redeploy',
      if_applied:
        'Re-upsert deleted rows from a pre-apply export of sam_events for those ids; AI rows never deleted; next extract recreates a row if the notice reads as an event again',
      report_only_default: true,
    },
    evidence: {
      source: 'read-only replay of extract-run planRetirements against live listed rows + notice bodies',
      note: 'cron_logs has 0 rows total — durable prune-report inserts have never landed; this pack is the replacement evidence until fail-loud recording ships',
    },
  };

  const proposalLines =
    retirement.proposals.length === 0
      ? '_None proposed under the cap (or guard tripped — see guardSkipped)._'
      : retirement.proposals
          .map(
            (p) =>
              `- \`${p.id}\` · notice \`${p.notice_id}\` · stored_type=${p.stored_type ?? 'null'} · stored_date=${p.stored_date ?? 'null'} · reason=${p.reason}`,
          )
          .join('\n');

  const md = `# Events prune decision pack (REPORT-ONLY) — 2026-11-18

**Status:** decision pack only. \`SAM_EVENTS_PRUNE\` is unset in production. Do **not** set \`=apply\` without Eric + Agent 5 authorization.

## Measured production facts

| Fact | Value |
|---|---|
| Serving SHA (\`maps-account-build\`) | \`c6c9c0864\` (includes #2147) |
| \`extract-sam-events\` last run | 2026-11-18 07:00:27Z · HTTP 200 · 5477ms · cron_jobs last_status=success |
| \`sam_events\` total | 8,266 (was 8,163 on 11-17 probe) |
| Upcoming (\`event_date >= today\`) | 1,105 |
| Undated | 161 |
| Rows stamped \`extracted_at\` on 11-18 | **103** (only planned upserts, not every listed row) |
| \`cron_logs\` total rows | **0** |
| \`cron_logs\` \`extract-sam-events:prune-report\` | **0** (durable report never recorded) |
| \`SAM_EVENTS_PRUNE\` in Vercel prod | unset |

## Live prune proposal (computed read-only ${measuredAt})

| Counter | Value |
|---|---:|
| Listed rows re-read set | ${pack.counts.listedRows} |
| Source notices found | ${pack.counts.listedSourcesFound} |
| Missing source notices | ${pack.counts.listedMissingSource} |
| Active candidates loaded | ${pack.counts.activeCandidates} (complete=${pack.counts.activeComplete}) |
| Planned attendable events | ${pack.counts.plannedEvents} |
| wouldRetire (pre-cap) | ${pack.counts.wouldRetire} |
| **Proposed for delete (capped)** | **${pack.counts.proposed}** |
| Guard skipped | ${pack.counts.guardSkipped ?? '(none — proposals within cap)'} |

Cap: min(${RETIRE_MAX_ROWS}, floor(reread × ${RETIRE_MAX_SHARE})).

### Exact proposed record ids

${proposalLines}

Machine-readable twin: \`tasks/events-prune-decision-pack-2026-11-18.json\`.

## Source evidence

- Classifier: \`readNoticeEvent\` + \`planEvents\` / \`planRetirements\` in \`src/lib/events/\` (same as cron).
- Only \`source\` null/\`sam_gov\` rows; title-only readings excluded; AI rows never proposed.
- Production cron response body also carries \`prune.proposals\` when the route runs — but that body is not persisted today because \`cron_logs\` inserts have never landed (table empty).

## Rollback (if a future apply is authorized)

1. Before apply: export the proposed id set from this pack / next prune-report row.
2. Apply deletes only those ids (\`source\` null or \`sam_gov\`).
3. Rollback = re-insert the exported rows. Next extract recreates a row if the notice again reads as an event.
4. Never use a table truncate. Never touch AI-discovered rows.

## Authorization gate

- Report mode (default): safe forever.
- Apply requires: set \`SAM_EVENTS_PRUNE=apply\` in Vercel prod + redeploy + explicit Eric/Agent-5 OK.
- Related code hardening (this branch): fail the cron (non-2xx) when prune-report insert fails so empty \`cron_logs\` cannot silently recur.
`;

  writeFileSync('tasks/events-prune-decision-pack-2026-11-18.json', JSON.stringify(pack, null, 2));
  writeFileSync('tasks/events-prune-decision-pack-2026-11-18.md', md);
  console.log(JSON.stringify(pack.counts, null, 2));
  console.log('wrote tasks/events-prune-decision-pack-2026-11-18.{json,md}');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
