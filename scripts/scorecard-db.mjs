/**
 * Read-only scorecard database session.
 *
 * The workflow never stores a database password. It receives a short-lived
 * scorecard_reader URL from the credential route and passes it only as env.
 * This module refuses any URL that is not the Supabase pooler, TLS verify-full,
 * and the scorecard_reader login. It never prints the URL or the password.
 */
import pg from 'pg';

export const READER_ROLE = 'scorecard_reader';
export const ROTATE_FN = 'public.scorecard_rotate_reader_password(text,text,text,text,text,text)';

export const ALLOWED_COLUMNS = {
  data_source_instances: ['source_key', 'name', 'dataset_key', 'source_state', 'watch_cadence_days', 'last_poll', 'last_successful_check', 'last_verified_ingest', 'last_data_advance'],
  cron_jobs: ['job_name', 'enabled'],
  cron_job_runs: ['job_name', 'started_at', 'finished_at', 'status', 'http_status'],
  sam_opportunities: ['created_at', 'last_modified'],
  agency_forecasts: ['created_at', 'title', 'source_agency', 'source_url'],
  agency_pain_points_db: ['id', 'agency', 'pain_point', 'source', 'source_url', 'institute_source_ids', 'confidence', 'status', 'last_evidence_at', 'created_at'],
  institute_sources: ['id', 'source_type', 'document_number', 'source_url', 'publication_date', 'title', 'canonical_agency', 'discovered_at'],
};

const OPS = { eq: '=', gte: '>=', lt: '<', gt: '>', lte: '<=' };

export function parseScorecardDatabaseUrl(raw) {
  if (!raw || !String(raw).trim()) return { ok: false, reason: 'credential is missing' };
  let url;
  try { url = new URL(String(raw).trim()); } catch { return { ok: false, reason: 'credential is rejected' }; }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return { ok: false, reason: 'credential is rejected' };
  }
  const user = decodeURIComponent(url.username || '');
  if (!user.startsWith('scorecard_reader') || /postgres|service|admin|authenticator|supabase_admin/i.test(user)) {
    return { ok: false, reason: 'role is not scorecard_reader' };
  }
  if (!/\.pooler\.supabase\.com$/i.test(url.hostname)) {
    return { ok: false, reason: 'credential is rejected' };
  }
  if (url.port !== '6543') return { ok: false, reason: 'credential is rejected' };
  if (url.searchParams.get('sslmode') !== 'verify-full') {
    return { ok: false, reason: 'credential is rejected' };
  }
  if (!url.password) return { ok: false, reason: 'credential is rejected' };
  return { ok: true, hostname: url.hostname, connectionString: url.toString() };
}

function column(table, name) {
  const allowed = ALLOWED_COLUMNS[table];
  if (!allowed || !allowed.includes(name)) {
    const err = new Error('column refused');
    err.code = 'SCORECARD_COLUMN';
    throw err;
  }
  return `"${name}"`;
}

function pushValue(values, value) {
  values.push(value);
  return `$${values.length}`;
}

function predicate(table, text, values) {
  for (const op of Object.keys(OPS)) {
    const marker = `.${op}.`;
    const at = text.indexOf(marker);
    if (at > 0) {
      const name = text.slice(0, at);
      const value = text.slice(at + marker.length);
      return `${column(table, name)} ${OPS[op]} ${pushValue(values, value)}`;
    }
  }
  const err = new Error('predicate refused');
  err.code = 'SCORECARD_COLUMN';
  throw err;
}

/** Translate the scorecard's existing filter objects into a parameterized read. */
export function compileRead(table, filters, { count = false } = {}) {
  if (!ALLOWED_COLUMNS[table]) {
    const err = new Error('table refused');
    err.code = 'SCORECARD_COLUMN';
    throw err;
  }
  const values = [];
  const where = [];
  let order = '';
  let limit = '';
  const selected = [];
  for (const [key, raw] of Object.entries(filters || {})) {
    if (raw == null || raw === '') continue;
    if (key === 'select') {
      for (const name of String(raw).split(',')) {
        if (!name) continue;
        selected.push(column(table, name.trim()));
      }
      continue;
    }
    if (key === 'order') {
      const [name, dir] = String(raw).split('.');
      if (dir !== 'asc' && dir !== 'desc') throw Object.assign(new Error('order refused'), { code: 'SCORECARD_COLUMN' });
      order = ` ORDER BY ${column(table, name)} ${dir}`;
      continue;
    }
    if (key === 'limit') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 1000) throw Object.assign(new Error('limit refused'), { code: 'SCORECARD_COLUMN' });
      limit = ` LIMIT ${n}`;
      continue;
    }
    if (key === 'and') {
      const inner = String(raw).trim().replace(/^\(/, '').replace(/\)$/, '');
      for (const part of inner.split(',')) {
        if (part) where.push(predicate(table, part, values));
      }
      continue;
    }
    const text = String(raw);
    if (text.startsWith('eq.')) {
      where.push(`${column(table, key)} = ${pushValue(values, text.slice(3))}`);
      continue;
    }
    if (text.startsWith('in.(') && text.endsWith(')')) {
      const items = text.slice(4, -1).split(',').filter(Boolean);
      if (!items.length) {
        where.push('false');
        continue;
      }
      const refs = items.map((item) => pushValue(values, item));
      where.push(`${column(table, key)} IN (${refs.join(', ')})`);
      continue;
    }
    throw Object.assign(new Error('filter refused'), { code: 'SCORECARD_COLUMN' });
  }
  if (!selected.length) throw Object.assign(new Error('select refused'), { code: 'SCORECARD_COLUMN' });
  const from = `public."${table}"`;
  const sqlWhere = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const text = count
    ? `SELECT count(*)::int AS n FROM ${from}${sqlWhere}`
    : `SELECT ${selected.join(', ')} FROM ${from}${sqlWhere}${order}${limit}`;
  return { text, values };
}

export function classifySession(row) {
  if (!row || row.current_user !== READER_ROLE) return { ok: false, reason: 'role is not scorecard_reader' };
  if (row.rolsuper === true) return { ok: false, reason: 'role is a superuser' };
  if (row.rolbypassrls === true) return { ok: false, reason: 'role has BYPASSRLS' };
  if (row.rolcreaterole === true) return { ok: false, reason: 'role has CREATEROLE' };
  if (row.default_transaction_read_only !== 'on' || row.transaction_read_only !== 'on') {
    return { ok: false, reason: 'session is not read-only' };
  }
  const limit = Number(row.rolconnlimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 4) return { ok: false, reason: 'connection limit is not restricted' };
  if (Number(row.memberships) > 0) return { ok: false, reason: 'role can set role' };
  if (row.raw_select === true) return { ok: false, reason: 'role can read institute_sources.raw' };
  if (row.rotate_execute === true) return { ok: false, reason: 'role can rotate credentials' };
  const writes = Array.isArray(row.writes) ? row.writes : [];
  for (const item of writes) {
    if (item.insert || item.update || item.delete || item.truncate) {
      return { ok: false, reason: 'role has a write privilege' };
    }
  }
  if (!row.statement_timeout || row.statement_timeout === '0') return { ok: false, reason: 'statement timeout is not set' };
  return { ok: true, reason: 'read-only session' };
}

export const SESSION_SQL = `
SELECT
  current_user AS current_user,
  r.rolsuper,
  r.rolbypassrls,
  r.rolcreaterole,
  r.rolconnlimit,
  current_setting('default_transaction_read_only') AS default_transaction_read_only,
  current_setting('transaction_read_only') AS transaction_read_only,
  current_setting('statement_timeout') AS statement_timeout,
  (SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = current_user) AS memberships,
  has_column_privilege(current_user, 'public.institute_sources', 'raw', 'SELECT') AS raw_select,
  COALESCE((
    SELECT has_function_privilege(current_user, p.oid, 'EXECUTE')
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'scorecard_rotate_reader_password'
    LIMIT 1
  ), false) AS rotate_execute
FROM pg_roles r
WHERE r.rolname = current_user
`;

export const WRITE_SQL = `
SELECT c.relname AS table_name,
       has_table_privilege(current_user, c.oid, 'INSERT') AS insert,
       has_table_privilege(current_user, c.oid, 'UPDATE') AS update,
       has_table_privilege(current_user, c.oid, 'DELETE') AS delete,
       has_table_privilege(current_user, c.oid, 'TRUNCATE') AS truncate
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname = ANY ($1::text[])
`;

export async function assertReadOnlySession(client) {
  const session = await client.query(SESSION_SQL);
  const writes = await client.query(WRITE_SQL, [Object.keys(ALLOWED_COLUMNS)]);
  const row = session.rows[0] || {};
  return classifySession({ ...row, writes: writes.rows });
}

export function createPgReader(client) {
  const state = { refusal: null };
  const fail = (err) => {
    const code = err?.code || '';
    if (code === '28P01' || code === '28000' || code === '42501' || code === 'SCORECARD_COLUMN') {
      state.refusal = code === 'SCORECARD_COLUMN' ? 'credential is rejected' : 'credential is rejected';
    }
    return { ok: false, error: 'the read failed', rows: [], count: null };
  };
  return {
    get refusal() { return state.refusal; },
    async count(table, filters) {
      try {
        const compiled = compileRead(table, filters, { count: true });
        const res = await client.query(compiled.text, compiled.values);
        const n = res.rows[0]?.n;
        if (typeof n !== 'number') return { ok: false, error: 'count header missing', rows: [], count: null };
        return { ok: true, error: null, rows: [], count: n };
      } catch (err) {
        return fail(err);
      }
    },
    async rows(table, filters) {
      try {
        const compiled = compileRead(table, filters, { count: false });
        const res = await client.query(compiled.text, compiled.values);
        return { ok: true, error: null, rows: res.rows, count: null };
      } catch (err) {
        return fail(err);
      }
    },
  };
}

export async function connectScorecard(connectionString) {
  const parsed = parseScorecardDatabaseUrl(connectionString);
  if (!parsed.ok) return parsed;
  const client = new pg.Client({
    connectionString: parsed.connectionString,
    ssl: { rejectUnauthorized: true, servername: parsed.hostname },
    application_name: 'acquisition-scorecard',
  });
  try {
    await client.connect();
  } catch {
    return { ok: false, reason: 'credential is rejected' };
  }
  try {
    const gate = await assertReadOnlySession(client);
    if (!gate.ok) {
      await client.end().catch(() => {});
      return { ok: false, reason: gate.reason };
    }
    return { ok: true, client, reason: gate.reason };
  } catch {
    await client.end().catch(() => {});
    return { ok: false, reason: 'credential is rejected' };
  }
}
