/**
 * Real-Postgres proof (PGlite) for the watchdog incident claim protocol.
 *
 * Applies the ACTUAL migration (twice — idempotent) and drives runWatchdogIncidents through a
 * store that issues the same atomic statements the Supabase store maps to:
 *   INSERT ... ON CONFLICT (incident_key) DO NOTHING RETURNING
 *   UPDATE ... WHERE incident_key = $1 AND version = $2
 * Two overlapping watchdog passes must produce exactly ONE Slack message.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runWatchdogIncidents, type IncidentRow, type IncidentStore, type WatchdogObservation } from './watchdog-incidents';

const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20261005_ops_incidents.sql'), 'utf8');
const db = new PGlite();
const JSON_COLS = new Set(['processing_counts', 'notified_counts', 'suppression_counts']);

function pgStore(pg: PGlite): IncidentStore {
  const vals = (row: Record<string, unknown>, cols: string[]) =>
    cols.map((c) => (JSON_COLS.has(c) ? JSON.stringify(row[c] ?? {}) : row[c] ?? null));
  return {
    async list(source) {
      const r = await pg.query<IncidentRow>('SELECT * FROM public.ops_incidents WHERE source = $1', [source]);
      return r.rows.map((x) => ({
        ...x,
        opened_at: new Date(x.opened_at).toISOString(),
        last_seen_at: new Date(x.last_seen_at).toISOString(),
        resolved_at: x.resolved_at ? new Date(x.resolved_at).toISOString() : null,
        last_notified_at: x.last_notified_at ? new Date(x.last_notified_at).toISOString() : null,
      }));
    },
    async insertIfAbsent(row) {
      const cols = Object.keys(row).filter((c) => c !== 'updated_at');
      const r = await pg.query(
        `INSERT INTO public.ops_incidents (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
         ON CONFLICT (incident_key) DO NOTHING RETURNING incident_key`,
        vals(row as Record<string, unknown>, cols),
      );
      return r.rows.length === 1;
    },
    async compareAndSet(key, v, patch) {
      const cols = Object.keys(patch).filter((c) => c !== 'updated_at');
      const r = await pg.query(
        `UPDATE public.ops_incidents SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now()
         WHERE incident_key = $${cols.length + 1} AND version = $${cols.length + 2}`,
        [...vals(patch as Record<string, unknown>, cols), key, v],
      );
      return (r.affectedRows ?? 0) === 1;
    },
  };
}

const SAVED_SEARCH: WatchdogObservation = {
  key: 'failing:saved-search-alerts', kind: 'failing', jobName: 'saved-search-alerts', status: 'error',
  error: 'unexpected_schedule_error=1,email_send_rejected=3', detail: 'last failed run 2026-10-04T11:00Z (error)',
};
const EPA: WatchdogObservation = {
  key: 'failing:epa-source-watch', kind: 'failing', jobName: 'epa-source-watch', status: 'timeout',
  error: 'This operation was aborted', detail: 'last failed run 2026-10-04T14:50Z (timeout)',
};

beforeAll(async () => {
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // idempotent re-apply
});

describe('ops_incidents claim protocol on real Postgres', () => {
  it('overlapping passes → exactly one message; repeat → silent; recovery → one message', async () => {
    const store = pgStore(db);
    const sent: { subject: string; text: string }[] = [];
    const send = async (m: { subject: string; text: string }) => { sent.push(m); return { ok: true }; };
    const run = (obs: WatchdogObservation[], iso: string) =>
      runWatchdogIncidents({ store, source: 'dispatcher-watchdog', observations: obs, now: new Date(iso), send });

    const [a, b, c] = await Promise.all([
      run([SAVED_SEARCH, EPA], '2026-10-05T06:00:00Z'),
      run([SAVED_SEARCH, EPA], '2026-10-05T06:00:00Z'),
      run([SAVED_SEARCH, EPA], '2026-10-05T06:00:01Z'),
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Cron watchdog: 2 opened');
    expect(a.lostRaces.length + b.lostRaces.length + c.lostRaces.length).toBe(4);

    await run([SAVED_SEARCH, EPA], '2026-10-05T09:00:00Z');
    expect(sent).toHaveLength(1);

    await run([SAVED_SEARCH], '2026-10-05T10:00:00Z');
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toContain('✅ RECOVERED epa-source-watch');

    const rows = await db.query<{ incident_key: string; status: string; observations: number; notify_pending: string | null }>(
      'SELECT incident_key, status, observations, notify_pending FROM public.ops_incidents ORDER BY incident_key',
    );
    expect(rows.rows).toEqual([
      { incident_key: 'failing:epa-source-watch', status: 'resolved', observations: 2, notify_pending: null },
      { incident_key: 'failing:saved-search-alerts', status: 'open', observations: 3, notify_pending: null },
    ]);
  });
});
