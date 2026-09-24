/**
 * Executes the REAL migration SQL (20260924_saved_search_forecast_watermark.sql) in an in-process Postgres (PGlite,
 * pinned devDependency) and proves the database half of the backfill-safety contract. Never touches a real database.
 * Runs in CI (`npm run test:unit`) and in the pre-push gate — it is not an optional script.
 *
 * WHO CAN DECLARE `daily_sync` (the privileged boundary this file pins):
 *   · The declaration is a session setting / request header, so ANY session can *say* it. The trigger honours it only
 *     when current_user is service_role or postgres (the owner). Any other role that declares it is refused.
 *   · Production grants on agency_forecasts (measured 2026-09-24): postgres (owner) + service_role only; anon and
 *     authenticated hold no grants at all, so they cannot write the table regardless of this guard.
 *   · BYPASS BOUNDARY — this is a safety interlock, not a security boundary against privileged operators:
 *     service_role (the app key, BYPASSRLS) can declare daily_sync or suspend a floor; the owner can
 *     ALTER TABLE … DISABLE TRIGGER; a superuser (supabase_admin) can do anything. What the database guarantees is that
 *     every floor change by any of them is written to forecast_publisher_alert_floor_log with the database user.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(join(process.cwd(), 'supabase/migrations/20260924_saved_search_forecast_watermark.sql'), 'utf8');
const db = new PGlite();

async function tryExec(sql: string, setup = ''): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await db.exec(`BEGIN; ${setup} ${sql}; COMMIT;`);
    return { ok: true };
  } catch (e) {
    await db.exec('ROLLBACK').catch(() => {});
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}
const hdr = (w: string) => `SELECT set_config('request.headers', '{"x-forecast-writer":"${w}"}', true);`;
const one = async <T>(sql: string) => (await db.query<T>(sql)).rows[0];

beforeAll(async () => {
  // The production columns the migration touches, plus Supabase's roles (created here, in-process only).
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE intruder;  -- service_role is BYPASSRLS in production (measured)
    CREATE TABLE saved_searches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), filters jsonb);
    CREATE TABLE agency_forecasts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_agency text NOT NULL, external_id text NOT NULL, title text,
      created_at timestamptz NOT NULL DEFAULT now(), last_synced_at timestamptz,
      UNIQUE (source_agency, external_id)
    );
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // idempotent
  // Give service_role and a hypothetical non-privileged writer the SAME table grants, so the only difference the
  // trigger can see is the role. (In production `intruder`'s peers — anon/authenticated — have no grants at all.)
  await db.exec(`
    GRANT SELECT, INSERT, UPDATE ON agency_forecasts TO service_role, intruder;
    GRANT SELECT ON forecast_publisher_alert_floor TO service_role, intruder;
    GRANT SELECT, INSERT, UPDATE ON forecast_publisher_alert_floor, forecast_publisher_alert_floor_log, forecast_refused_loads TO service_role;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
  `);
}, 60_000);

describe('migration shape', () => {
  it('adds the saved_searches columns, incl. the send-claim lease', async () => {
    const r = await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name='saved_searches' AND column_name LIKE 'forecast_%' ORDER BY 1`);
    expect(r.rows.map((x) => x.column_name)).toEqual(['forecast_alert_claim_until', 'forecast_gap_since', 'forecast_pending', 'forecast_seen_through']);
  });
  it('snapshot function = DB now() − 5 minutes', async () => {
    const r = await one<{ s: string; n: string }>(`SELECT saved_search_forecast_snapshot() AS s, now() AS n`);
    expect(Math.abs((+new Date(r.n) - +new Date(r.s)) / 1000 - 300)).toBeLessThan(1);
  });
  it('anon/authenticated hold NO privileges on the floor, its log, or the refused-load quarantine', async () => {
    const r = await db.query<{ grantee: string; table_name: string }>(`SELECT grantee, table_name FROM information_schema.role_table_grants
      WHERE table_name IN ('forecast_publisher_alert_floor','forecast_publisher_alert_floor_log','forecast_refused_loads') AND grantee IN ('anon','authenticated')`);
    expect(r.rows).toEqual([]);
  });
  it('an ACTIVE floor must carry alertable_after (CHECK)', async () => {
    expect((await tryExec(`INSERT INTO forecast_publisher_alert_floor (source_agency, state, reason, set_by) VALUES ('DOE','active','x','y')`)).ok).toBe(false);
  });
});

describe('agency_forecasts_floor_guard — who may CREATE rows while a floor is active', () => {
  beforeAll(async () => {
    expect((await tryExec(`INSERT INTO agency_forecasts (source_agency, external_id) VALUES ('NASA','N-1')`)).ok).toBe(true); // no floor → allowed
    await db.exec(`INSERT INTO forecast_publisher_alert_floor (source_agency, state, alertable_after, reason, set_by) VALUES ('DHS','active', now(), 'seed','proof')`);
    await db.exec(`BEGIN; SET LOCAL app.forecast_writer = 'daily_sync'; INSERT INTO agency_forecasts (source_agency, external_id, title, created_at) VALUES ('DHS','F1','old','2026-01-01T00:00:00Z'); COMMIT;`);
  });

  it('undeclared writer (import script / psql) creating a new row → REFUSED with guidance', async () => {
    const r = await tryExec(`INSERT INTO agency_forecasts (source_agency, external_id) VALUES ('DHS','F2')`);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/refusing to create DHS\/F2/);
  });
  it('a "backfill" writer that did not suspend → REFUSED', async () => {
    expect((await tryExec(`INSERT INTO agency_forecasts (source_agency, external_id) VALUES ('DHS','F3')`, hdr('backfill'))).ok).toBe(false);
  });
  it('service_role declaring daily_sync via the PostgREST header → allowed', async () => {
    expect((await tryExec(`INSERT INTO agency_forecasts (source_agency, external_id) VALUES ('DHS','F4')`, `SET LOCAL ROLE service_role; ${hdr('daily_sync')}`)).ok).toBe(true);
  });
  it('a NON-privileged role declaring daily_sync (header OR session setting) → REFUSED, even with table grants', async () => {
    const a = await tryExec(`INSERT INTO agency_forecasts (source_agency, external_id) VALUES ('DHS','F5')`, `SET LOCAL ROLE intruder; ${hdr('daily_sync')}`);
    expect(a.ok).toBe(false);
    expect(!a.ok && a.error).toMatch(/writer=daily_sync, role=intruder/);
    const b = await tryExec(`INSERT INTO agency_forecasts (source_agency, external_id) VALUES ('DHS','F6')`, `SET LOCAL ROLE intruder; SET LOCAL app.forecast_writer = 'daily_sync';`);
    expect(b.ok).toBe(false);
  });
  it('RLS cannot blind the guard: a role that cannot SELECT the floor still hits it (it used to read "no floor" → fail open)', async () => {
    await db.exec(`CREATE ROLE blind; GRANT SELECT, INSERT ON agency_forecasts TO blind;`);
    const r = await tryExec(`INSERT INTO agency_forecasts (source_agency, external_id) VALUES ('DHS','F7')`, 'SET LOCAL ROLE blind;');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/refusing to create DHS\/F7 .*writer=undeclared, role=blind/);
  });
  it('an upsert that only UPDATES an existing row is allowed for anyone with grants, and keeps created_at', async () => {
    const before = await one<{ created_at: Date }>(`SELECT created_at FROM agency_forecasts WHERE external_id='F1'`);
    const r = await tryExec(`INSERT INTO agency_forecasts (source_agency, external_id, title) VALUES ('DHS','F1','republished') ON CONFLICT (source_agency, external_id) DO UPDATE SET title = EXCLUDED.title, last_synced_at = now()`, 'SET LOCAL ROLE intruder;');
    const after = await one<{ created_at: Date; title: string }>(`SELECT created_at, title FROM agency_forecasts WHERE external_id='F1'`);
    expect(r.ok).toBe(true);
    expect(+after.created_at).toBe(+before.created_at);
    expect(after.title).toBe('republished');
  });
  it('suspended → a 2,519-row historical load is allowed; re-activated → refused again', async () => {
    await db.exec(`UPDATE forecast_publisher_alert_floor SET state='suspended', reason='backfill', set_by='proof' WHERE source_agency='DHS'`);
    expect((await tryExec(`INSERT INTO agency_forecasts (source_agency, external_id) SELECT 'DHS', 'H-' || g FROM generate_series(1, 2519) g`)).ok).toBe(true);
    expect((await one<{ c: number }>(`SELECT count(*)::int AS c FROM agency_forecasts WHERE external_id LIKE 'H-%'`)).c).toBe(2519);
    await db.exec(`UPDATE forecast_publisher_alert_floor SET state='active', alertable_after = now(), reason='activate', set_by='proof' WHERE source_agency='DHS'`);
    expect((await tryExec(`INSERT INTO agency_forecasts (source_agency, external_id) VALUES ('DHS','F9')`)).ok).toBe(false);
  });
});

describe('floor audit — every change is logged BY THE DATABASE, whatever path made it', () => {
  it('a raw UPDATE by service_role (no app code involved) is logged with the database user', async () => {
    const n0 = (await one<{ c: number }>(`SELECT count(*)::int AS c FROM forecast_publisher_alert_floor_log`)).c;
    await db.exec(`BEGIN; SET LOCAL ROLE service_role; UPDATE forecast_publisher_alert_floor SET state='suspended', reason='raw sql', set_by='someone' WHERE source_agency='DHS'; COMMIT;`);
    const last = await one<{ prev_state: string; new_state: string; reason: string; db_user: string; c: number }>(
      `SELECT prev_state, new_state, reason, db_user, (SELECT count(*)::int FROM forecast_publisher_alert_floor_log) AS c FROM forecast_publisher_alert_floor_log ORDER BY id DESC LIMIT 1`);
    expect(last).toMatchObject({ prev_state: 'active', new_state: 'suspended', reason: 'raw sql', db_user: 'service_role', c: n0 + 1 });
  });
  it('a DELETE is logged too', async () => {
    await db.exec(`INSERT INTO forecast_publisher_alert_floor (source_agency, state, reason, set_by) VALUES ('SSA','suspended','x','y')`);
    await db.exec(`DELETE FROM forecast_publisher_alert_floor WHERE source_agency='SSA'`);
    expect(await one(`SELECT new_state, reason FROM forecast_publisher_alert_floor_log ORDER BY id DESC LIMIT 1`)).toEqual({ new_state: 'deleted', reason: 'row deleted' });
  });
});

describe('forecast_refused_loads — the breaker quarantine', () => {
  it('service_role can store a full refused payload for replay', async () => {
    const r = await tryExec(`INSERT INTO forecast_refused_loads (source_agency, reason, new_row_count, rows) VALUES ('HHS','breaker',600,'[{"external_id":"HHS-1"}]'::jsonb)`, 'SET LOCAL ROLE service_role;');
    expect(r.ok).toBe(true);
    expect(await one(`SELECT source_agency, new_row_count, jsonb_array_length(rows) AS n, resolved_at FROM forecast_refused_loads`)).toEqual({ source_agency: 'HHS', new_row_count: 600, n: 1, resolved_at: null });
  });
});
