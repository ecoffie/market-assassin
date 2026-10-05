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
  error: 'unexpected_schedule_error=1,recipient_suppressed=3', detail: 'last failed run 2026-10-04T11:00Z (error)',
};
const EPA: WatchdogObservation = {
  key: 'failing:epa-source-watch', kind: 'failing', jobName: 'epa-source-watch', status: 'timeout',
  error: 'This operation was aborted', detail: 'last failed run 2026-10-04T14:50Z (timeout)',
};

/**
 * Supabase provisioning, reproduced: the three API roles exist, and NEW public tables get default
 * privileges for all of them (that is Supabase's real default — why the migration must REVOKE).
 * service_role is BYPASSRLS in Supabase; here it is NOT, so its policy is what grants it access.
 */
async function provision(pg: PGlite) {
  await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;`);
}

beforeAll(async () => {
  await provision(db);
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

describe('ops_incidents migration: rerun safety and access', () => {
  it('re-applies cleanly on a populated table and preserves rows', async () => {
    const pg = new PGlite();
    await provision(pg);
    await pg.exec(MIGRATION);
    await pg.query(`INSERT INTO public.ops_incidents (incident_key, source, kind) VALUES ('failing:x', 'dispatcher-watchdog', 'failing')`);
    await pg.exec(MIGRATION);
    await pg.exec(MIGRATION);
    const r = await pg.query<{ n: number }>('SELECT count(*)::int AS n FROM public.ops_incidents');
    expect(r.rows[0].n).toBe(1);
    const pol = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'ops_incidents'`);
    expect(pol.rows[0].n).toBe(1);
    const rls = await pg.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'ops_incidents'`);
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('anon and authenticated cannot read or write; service_role can (via its policy)', async () => {
    const pg = new PGlite();
    await provision(pg);
    await pg.exec(MIGRATION);
    await pg.query(`INSERT INTO public.ops_incidents (incident_key, source, kind) VALUES ('failing:x', 'dispatcher-watchdog', 'failing')`);
    const as = async (role: string, sql: string) => {
      await pg.exec(`SET ROLE ${role}`);
      try { return { ok: true as const, rows: (await pg.query(sql)).rows }; }
      catch (e) { return { ok: false as const, error: (e as Error).message }; }
      finally { await pg.exec('RESET ROLE'); }
    };
    for (const role of ['anon', 'authenticated']) {
      const read = await as(role, 'SELECT * FROM public.ops_incidents');
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.error).toMatch(/permission denied/);
      const write = await as(role, `INSERT INTO public.ops_incidents (incident_key, source, kind) VALUES ('k-${role}', 's', 'failing')`);
      expect(write.ok).toBe(false);
    }
    // Defence in depth: even if a future GRANT re-opens the table, RLS (no anon policy) hides every row.
    await pg.exec('GRANT SELECT ON public.ops_incidents TO anon');
    const leaked = await as('anon', 'SELECT * FROM public.ops_incidents');
    expect(leaked.ok && leaked.rows.length).toBe(0);
    // service_role works through its policy.
    await pg.exec('GRANT ALL ON public.ops_incidents TO service_role');
    const svc = await as('service_role', 'SELECT incident_key FROM public.ops_incidents');
    expect(svc.ok && svc.rows).toEqual([{ incident_key: 'failing:x' }]);
  });
});
