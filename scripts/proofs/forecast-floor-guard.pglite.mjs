/**
 * Executes the REAL migration SQL (20260924_saved_search_forecast_watermark.sql) in an in-process Postgres
 * (PGlite) and proves the agency_forecasts floor guard. Never touches any real database.
 *
 *   mkdir -p /tmp/pgl && cd /tmp/pgl && npm i @electric-sql/pglite
 *   NODE_PATH=/tmp/pgl/node_modules node scripts/proofs/forecast-floor-guard.pglite.mjs
 *
 * Exit 1 on any failed expectation.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(process.env.NODE_PATH ? join(process.env.NODE_PATH, 'x') : import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(here, '../../supabase/migrations/20260924_saved_search_forecast_watermark.sql'), 'utf8');

const db = new PGlite();
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
async function tryInsert(sql, setup = '') {
  try {
    await db.exec(`BEGIN; ${setup} ${sql}; COMMIT;`);
    return { ok: true };
  } catch (e) {
    await db.exec('ROLLBACK').catch(() => {});
    return { ok: false, error: String(e.message || e) };
  }
}
const hdr = (w) => `SELECT set_config('request.headers', '{"x-forecast-writer":"${w}"}', true);`;

// Minimal pre-existing schema the migration expects (the production columns it touches).
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
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
check('migration applies twice (idempotent)', true);

const cols = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='saved_searches' AND column_name LIKE 'forecast_%' ORDER BY 1`);
check('saved_searches gains forecast_gap_since / forecast_pending / forecast_seen_through', cols.rows.map((r) => r.column_name).join(',') === 'forecast_gap_since,forecast_pending,forecast_seen_through');
const snap = await db.query(`SELECT saved_search_forecast_snapshot() AS s, now() AS n`);
const lag = (new Date(snap.rows[0].n) - new Date(snap.rows[0].s)) / 1000;
check('snapshot function = now() - 5 minutes', Math.abs(lag - 300) < 1, `${lag}s`);

// 1 · no floor row → any writer may create rows (they are not alertable: fail-closed floor)
check('no floor: undeclared writer may insert', (await tryInsert(`INSERT INTO agency_forecasts (source_agency, external_id) VALUES ('NASA','N-1')`)).ok);

// Active floor for DHS
await db.exec(`INSERT INTO forecast_publisher_alert_floor (source_agency, state, alertable_after, reason, set_by) VALUES ('DHS','active', now(), 'seed','proof')`);
await db.exec(`INSERT INTO agency_forecasts (source_agency, external_id, title, created_at) VALUES ('DHS','F1','old', '2026-01-01T00:00:00Z')`).catch(() => {});
const seeded = await db.query(`SELECT count(*)::int AS c FROM agency_forecasts WHERE external_id='F1'`);
check('an undeclared insert of a NEW row is refused while the floor is active (setup row refused too)', seeded.rows[0].c === 0);
await db.exec(`BEGIN; SET LOCAL app.forecast_writer = 'daily_sync'; INSERT INTO agency_forecasts (source_agency, external_id, title, created_at) VALUES ('DHS','F1','old','2026-01-01T00:00:00Z'); COMMIT;`);

// 2 · undeclared writer (a historical import / script / psql) creating a NEW row → refused, with guidance
const r2 = await tryInsert(`INSERT INTO agency_forecasts (source_agency, external_id) VALUES ('DHS','F2')`);
check('active floor: undeclared writer creating a new row is REFUSED', !r2.ok && /refusing to create DHS\/F2/.test(r2.error), r2.error.slice(0, 90));
// 3 · a writer declaring 'backfill' while the floor is ACTIVE → refused (it must suspend first)
const r3 = await tryInsert(`INSERT INTO agency_forecasts (source_agency, external_id) VALUES ('DHS','F3')`, hdr('backfill'));
check('active floor: a "backfill" writer that did not suspend is REFUSED', !r3.ok);
// 4 · the declared DAILY SYNC (PostgREST header) → allowed
check('active floor: daily_sync (x-forecast-writer header) may create a new row', (await tryInsert(`INSERT INTO agency_forecasts (source_agency, external_id) VALUES ('DHS','F4')`, hdr('daily_sync'))).ok);
// 5 · undeclared UPSERT that only UPDATES an existing row → allowed, created_at kept
const before = (await db.query(`SELECT created_at FROM agency_forecasts WHERE external_id='F1'`)).rows[0].created_at;
const r5 = await tryInsert(`INSERT INTO agency_forecasts (source_agency, external_id, title) VALUES ('DHS','F1','republished') ON CONFLICT (source_agency, external_id) DO UPDATE SET title = EXCLUDED.title, last_synced_at = now()`);
const after = (await db.query(`SELECT created_at, title FROM agency_forecasts WHERE external_id='F1'`)).rows[0];
check('active floor: an upsert that only UPDATES an existing row is allowed and keeps created_at', r5.ok && +after.created_at === +before && after.title === 'republished');
// 6 · publisher SUSPENDED → a bulk historical load may create rows
await db.exec(`UPDATE forecast_publisher_alert_floor SET state='suspended' WHERE source_agency='DHS'`);
const bulk = await tryInsert(`INSERT INTO agency_forecasts (source_agency, external_id) SELECT 'DHS', 'H-' || g FROM generate_series(1, 2519) g`);
const nb = (await db.query(`SELECT count(*)::int AS c FROM agency_forecasts WHERE external_id LIKE 'H-%'`)).rows[0].c;
check('suspended: a 2,519-row historical load is allowed', bulk.ok && nb === 2519);
// 7 · re-activated → undeclared new rows refused again
await db.exec(`UPDATE forecast_publisher_alert_floor SET state='active', alertable_after = now() WHERE source_agency='DHS'`);
check('re-activated: undeclared new row refused again', !(await tryInsert(`INSERT INTO agency_forecasts (source_agency, external_id) VALUES ('DHS','F9')`)).ok);
// 8 · floor state constraint
const bad = await tryInsert(`INSERT INTO forecast_publisher_alert_floor (source_agency, state, reason, set_by) VALUES ('DOE','active','x','y')`);
check('an ACTIVE floor must carry alertable_after (CHECK)', !bad.ok);

console.log(`\n${failed ? `${failed} FAILED` : 'all passed'}`);
process.exit(failed ? 1 : 0);
