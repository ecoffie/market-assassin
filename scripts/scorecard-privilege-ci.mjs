/**
 * Applies the unapplied scorecard migration to a local Postgres and checks
 * the effective privileges. Refuses a Supabase or pooler host so this cannot
 * run against production.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { assertReadOnlySession } from './scorecard-db.mjs';

const url = process.env.SCORECARD_CI_DATABASE_URL || '';
if (!url || /supabase|pooler/i.test(url)) {
  console.error('scorecard privilege ci: refusing this database host');
  process.exit(2);
}

const STUBS = `
CREATE TABLE IF NOT EXISTS public.data_source_instances (
  source_key text PRIMARY KEY,
  name text,
  dataset_key text,
  source_state text,
  watch_cadence_days integer,
  last_poll timestamptz,
  last_successful_check timestamptz,
  last_verified_ingest timestamptz,
  last_data_advance timestamptz
);
ALTER TABLE public.data_source_instances ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.institute_sources (
  id uuid PRIMARY KEY,
  source_type text,
  document_number text,
  source_url text,
  publication_date date,
  title text,
  canonical_agency text,
  discovered_at timestamptz,
  raw jsonb
);
ALTER TABLE public.institute_sources ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.cron_jobs (job_name text PRIMARY KEY, enabled boolean, route text);
CREATE TABLE IF NOT EXISTS public.cron_job_runs (
  job_name text, started_at timestamptz, finished_at timestamptz, status text, http_status integer, error text
);
CREATE TABLE IF NOT EXISTS public.sam_opportunities (created_at timestamptz, last_modified timestamptz, synced_at timestamptz);
CREATE TABLE IF NOT EXISTS public.agency_forecasts (
  created_at timestamptz, title text, source_agency text, source_url text, updated_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.agency_pain_points_db (
  id uuid PRIMARY KEY,
  agency text,
  pain_point text,
  source text,
  source_url text,
  institute_source_ids uuid[],
  confidence text,
  status text,
  last_evidence_at timestamptz,
  created_at timestamptz
);
`;

function appliedSql() {
  const sql = readFileSync(new URL('../supabase/migrations/20261119_scorecard_reader.sql', import.meta.url), 'utf8');
  return sql.split('-- ROLLBACK —')[0];
}

async function connect(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

async function canLogin(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

async function expect42501(client, sql) {
  await client.query('BEGIN');
  await client.query('SET TRANSACTION READ WRITE');
  let code = 'ok';
  try {
    await client.query(sql);
  } catch (err) {
    code = err.code;
  }
  await client.query('ROLLBACK');
  if (code !== '42501') {
    console.error(`scorecard privilege ci: expected 42501 and got ${code}`);
    process.exit(1);
  }
}

async function main() {
  const admin = await connect(url);
  await admin.query(STUBS);
  await admin.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
    END $$;
  `);
  await admin.query(appliedSql());
  await admin.query(`
    INSERT INTO public.data_source_instances (source_key, name, dataset_key, source_state, watch_cadence_days)
    VALUES ('ci-source', 'CI', 'ci', 'current', 1)
    ON CONFLICT (source_key) DO NOTHING
  `);
  await admin.query(`
    INSERT INTO public.institute_sources (id, source_type, title, raw)
    VALUES
      ('11111111-1111-4111-8111-111111111111', 'gao_report', 'public title',
       '{"acquisition":{"resolution_status":"PRIVATE_RECOMMENDATION_SENTINEL","recommendation":"PRIVATE_RECOMMENDATION_SENTINEL"}}'::jsonb),
      ('22222222-2222-4222-8222-222222222222', 'gao_report', 'open title',
       '{"acquisition":{"resolution_status":"open","recommendation":"PRIVATE_RECOMMENDATION_SENTINEL"}}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `);

  const first = await admin.query(
    `SELECT password, expires_at FROM public.scorecard_rotate_reader_password($1,$2,$3,$4,$5,$6)`,
    ['ci-jti-1', 'ci-run-1', 'ci', 'schedule', 'ecoffie/market-assassin', 'ecoffie/market-assassin/.github/workflows/daily-acquisition-scorecard.yml@refs/heads/main'],
  );
  const password = first.rows[0].password;
  const expires = new Date(first.rows[0].expires_at).getTime() - Date.now();
  if (expires < 20 * 60 * 1000 || expires > 35 * 60 * 1000) {
    console.error('scorecard privilege ci: expiry was not about 30 minutes');
    process.exit(1);
  }
  const base = new URL(url);
  const readerUrl = (pw) => {
    const next = new URL(url);
    next.username = 'scorecard_reader';
    next.password = pw;
    next.hostname = base.hostname;
    return next.toString();
  };

  const reader = await connect(readerUrl(password));
  const gate = await assertReadOnlySession(reader);
  if (!gate.ok) {
    console.error(`scorecard privilege ci: ${gate.reason}`);
    process.exit(1);
  }
  const seen = await reader.query('SELECT count(*)::int AS n FROM public.data_source_instances');
  const sources = await reader.query('SELECT count(*)::int AS n FROM public.institute_sources');
  if (seen.rows[0].n !== 1 || sources.rows[0].n !== 2) {
    console.error('scorecard privilege ci: RLS hid a row the reader must count');
    process.exit(1);
  }
  for (const sql of [
    'SELECT raw FROM public.institute_sources',
    'SELECT route FROM public.cron_jobs',
    'SELECT error FROM public.cron_job_runs',
  ]) {
    let code = 'ok';
    try {
      await reader.query(sql);
    } catch (err) {
      code = err.code;
    }
    if (code !== '42501') {
      console.error(`scorecard privilege ci: denied column returned ${code}`);
      process.exit(1);
    }
  }
  const flags = await reader.query(
    `SELECT * FROM public.scorecard_institute_resolution($1::uuid[])`,
    [['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']],
  );
  const dumped = JSON.stringify(flags.rows);
  if (dumped.includes('PRIVATE_RECOMMENDATION_SENTINEL')) {
    console.error('scorecard privilege ci: resolution output contained raw text');
    process.exit(1);
  }
  const odd = flags.rows.find((row) => row.id === '11111111-1111-4111-8111-111111111111');
  const open = flags.rows.find((row) => row.id === '22222222-2222-4222-8222-222222222222');
  const columns = Object.keys(flags.rows[0] || {}).sort().join(',');
  if (columns !== 'discovered_at,id,resolution_flag,resolution_status') {
    console.error('scorecard privilege ci: resolution returned unexpected columns');
    process.exit(1);
  }
  if (odd?.resolution_status !== 'unknown' || odd?.resolution_flag !== 'unknown') {
    console.error('scorecard privilege ci: a non-open status was not unknown');
    process.exit(1);
  }
  if (open?.resolution_status !== 'open' || open?.resolution_flag !== 'confirmed_unresolved') {
    console.error('scorecard privilege ci: an open status was not mapped');
    process.exit(1);
  }
  const grants = await admin.query(`
    SELECT r.rolname,
           has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_execute
    FROM pg_roles r
    JOIN pg_proc p ON p.proname = 'scorecard_institute_resolution'
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
    WHERE r.rolname IN ('scorecard_reader', 'anon', 'authenticated', 'scorecard_rotator')
  `);
  const byRole = Object.fromEntries(grants.rows.map((row) => [row.rolname, row.can_execute]));
  if (byRole.scorecard_reader !== true || byRole.anon !== false || byRole.authenticated !== false || byRole.scorecard_rotator !== false) {
    console.error('scorecard privilege ci: resolution execute grants were wrong');
    process.exit(1);
  }
  await reader.query('SET default_transaction_read_only = off');
  for (const sql of [
    `INSERT INTO public.cron_jobs (job_name, enabled) VALUES ('x', true)`,
    `UPDATE public.cron_jobs SET enabled = false WHERE job_name = 'x'`,
    `DELETE FROM public.cron_jobs WHERE job_name = 'x'`,
    `TRUNCATE public.cron_jobs`,
  ]) {
    await expect42501(reader, sql);
  }
  let setRoleDenied = false;
  try {
    await reader.query('SET ROLE postgres');
  } catch {
    setRoleDenied = true;
  }
  if (!setRoleDenied) {
    console.error('scorecard privilege ci: SET ROLE was allowed');
    process.exit(1);
  }
  await reader.end();

  const second = await admin.query(
    `SELECT password FROM public.scorecard_rotate_reader_password($1,$2,$3,$4,$5,$6)`,
    ['ci-jti-2', 'ci-run-2', 'ci', 'workflow_dispatch', 'ecoffie/market-assassin', 'ecoffie/market-assassin/.github/workflows/daily-acquisition-scorecard.yml@refs/heads/main'],
  );
  if (await canLogin(readerUrl(password))) {
    console.error('scorecard privilege ci: old password still worked after rotation');
    process.exit(1);
  }
  const rotated = await connect(readerUrl(second.rows[0].password));
  await rotated.query('SELECT 1');
  await rotated.end();

  let replayed = false;
  try {
    await admin.query(
      `SELECT password FROM public.scorecard_rotate_reader_password($1,$2,$3,$4,$5,$6)`,
      ['ci-jti-2', 'ci-run-3', 'ci', 'schedule', 'ecoffie/market-assassin', 'ecoffie/market-assassin/.github/workflows/daily-acquisition-scorecard.yml@refs/heads/main'],
    );
  } catch (err) {
    replayed = /replay/.test(err.message);
  }
  if (!replayed) {
    console.error('scorecard privilege ci: a replayed jti was accepted');
    process.exit(1);
  }

  await admin.query(`ALTER ROLE scorecard_rotator PASSWORD 'ci-rotator-not-production'`);
  const rotatorUrl = new URL(url);
  rotatorUrl.username = 'scorecard_rotator';
  rotatorUrl.password = 'ci-rotator-not-production';
  const rotator = await connect(rotatorUrl.toString());
  const rotatorRole = await admin.query(`
    SELECT rolsuper, rolbypassrls, rolcreaterole
    FROM pg_roles WHERE rolname = 'scorecard_rotator'
  `);
  const shape = rotatorRole.rows[0];
  if (!shape || shape.rolsuper || shape.rolbypassrls || shape.rolcreaterole) {
    console.error('scorecard privilege ci: rotator is not a narrow login');
    process.exit(1);
  }
  let rotatorReadDenied = false;
  try {
    await rotator.query('SELECT count(*) FROM public.institute_sources');
  } catch (err) {
    rotatorReadDenied = err.code === '42501';
  }
  if (!rotatorReadDenied) {
    console.error('scorecard privilege ci: rotator could read institute_sources');
    process.exit(1);
  }
  await expect42501(rotator, `INSERT INTO public.cron_jobs (job_name, enabled) VALUES ('rotator', true)`);
  await expect42501(rotator, `SELECT id FROM public.scorecard_institute_resolution(NULL::uuid[])`);
  const spun = await rotator.query(
    `SELECT password, expires_at FROM public.scorecard_rotate_reader_password($1,$2,$3,$4,$5,$6)`,
    ['ci-jti-3', 'ci-run-4', 'ci', 'schedule', 'ecoffie/market-assassin', 'ecoffie/market-assassin/.github/workflows/daily-acquisition-scorecard.yml@refs/heads/main'],
  );
  const currentPassword = spun.rows[0]?.password;
  if (!spun.rows[0]?.expires_at || !currentPassword) {
    console.error('scorecard privilege ci: rotator could not rotate');
    process.exit(1);
  }
  await rotator.end();
  const beforeExpiry = await connect(readerUrl(currentPassword));
  await beforeExpiry.query('SELECT 1');
  await beforeExpiry.end();

  await admin.query(`ALTER ROLE scorecard_reader VALID UNTIL '2000-01-01'`);
  if (await canLogin(readerUrl(currentPassword))) {
    console.error('scorecard privilege ci: an expired login still worked');
    process.exit(1);
  }
  await admin.end();
  console.log('scorecard privilege ci: read-only grants, rotation, replay, and expiry passed');
}

main().catch((err) => {
  const text = String(err.message || err.code || 'failed').replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]');
  console.error(`scorecard privilege ci: ${text.slice(0, 240)}`);
  process.exit(1);
});
