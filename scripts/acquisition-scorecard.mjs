/**
 * READ-ONLY seven-day acquisition scorecard.
 *
 * Run from a checkout, no app server and no extra runner:
 *   node scripts/acquisition-scorecard.mjs --json
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY
 * from the environment or from .env.local in the current directory. Every
 * database call is HTTP GET against PostgREST (/rest/v1). No insert, update,
 * delete, upsert, or RPC.
 *
 * Without those two values it prints unknown for every count and exits 2.
 * Unknown is not zero.
 */
import { existsSync, readFileSync } from 'node:fs';

const DAY = 24 * 60 * 60 * 1000;

/** Last 7 UTC calendar days ending today, inclusive of today. */
export function acquisitionWindow(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end.getTime() - 7 * DAY);
  return { start: start.toISOString(), end: end.toISOString(), days: 7 };
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** @param {number[]} hours */
export function latencySummary(hours) {
  if (!hours.length) return { medianHours: null, p90Hours: null, sample: 0 };
  const sorted = [...hours].sort((a, b) => a - b);
  return {
    medianHours: Math.round(percentile(sorted, 50) * 10) / 10,
    p90Hours: Math.round(percentile(sorted, 90) * 10) / 10,
    sample: sorted.length,
  };
}

/** Fill missing keys from .env.local. Never overrides a value already in the environment. */
export function applyEnvFile(text, env = process.env) {
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (env[k] == null || env[k] === '') env[k] = v;
  }
  return env;
}

function loadCredentials() {
  if (existsSync('.env.local')) applyEnvFile(readFileSync('.env.local', 'utf8'));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return { url: url.replace(/\/$/, ''), key };
}

const SOURCES = [
  {
    key: 'sam_opportunities',
    tile: 'SAM.gov opportunities',
    table: 'sam_opportunities',
    id: 'notice_id',
    created: 'created_at',
    touched: 'synced_at',
    material: 'last_modified',
    published: 'posted_date',
    customer: 'find_opportunities and lookup_solicitation read sam_opportunities by notice_id',
  },
  {
    key: 'usaspending_awards_mirror',
    tile: 'USASpending awards mirror (legacy, Supabase)',
    table: 'usaspending_awards',
    id: 'award_id',
    created: null,
    touched: 'synced_at',
    material: null,
    published: 'start_date',
    customer: 'get_contractor_award_history name-search reads usaspending_awards',
  },
  {
    key: 'sba_goaling',
    tile: 'SBA goaling (static FY snapshot)',
    table: 'sba_goaling',
    id: 'id',
    created: null,
    touched: null,
    material: null,
    published: null,
    customer: 'get_sba_goaling_share reads sba_goaling',
    note: 'Annual scorecard snapshot. No daily collector.',
  },
  {
    key: 'agency_forecasts',
    tile: 'Agency procurement forecasts',
    table: 'agency_forecasts',
    id: 'external_id',
    created: 'created_at',
    touched: 'last_synced_at',
    material: 'updated_at',
    published: null,
    customer: 'get_agency_forecasts and the forecasts panel read agency_forecasts',
  },
  {
    key: 'dibbs_rfqs',
    tile: 'DLA small-buy RFQs (DIBBS)',
    table: 'dibbs_rfqs',
    id: 'id',
    created: 'created_at',
    touched: 'synced_at',
    material: null,
    published: null,
    customer: '/api/app/dibbs reads dibbs_rfqs. Collection stays disabled; a touch is not a new RFQ.',
  },
  {
    key: 'dod_sbir_topics',
    tile: 'DoD SBIR/STTR topics',
    table: 'dod_sbir_topics',
    id: 'topic_number',
    created: 'created_at',
    touched: 'synced_at',
    material: null,
    published: 'open_date',
    customer: 'search_sbir source=dod reads dod_sbir_topics by topic_number',
  },
  {
    key: 'sam_entities',
    tile: 'SAM entity registrations',
    table: 'sam_entities',
    id: 'uei',
    created: null,
    touched: 'synced_at',
    material: null,
    published: null,
    customer: 'lookup_sam_entity reads sam_entities by uei before any live SAM call',
  },
];

function unknown(reason) {
  return { value: null, status: 'unknown', reason };
}

function measured(value) {
  return { value, status: 'measured', reason: null };
}

/** GET only. Refuses every other method. */
async function restGet(base, key, path, { count = false } = {}) {
  if (!path.startsWith('/rest/v1/')) throw new Error('refusing a non-read path');
  const res = await fetch(`${base}${path}`, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(count ? { Prefer: 'count=exact', Range: '0-0' } : {}),
    },
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!res.ok) {
    const msg = body && typeof body === 'object' ? (body.message || body.error || res.status) : res.status;
    return { ok: false, error: String(msg), rows: [], count: null };
  }
  let n = null;
  if (count) {
    const range = res.headers.get('content-range') || '';
    const m = /\/(\d+)$/.exec(range);
    n = m ? Number(m[1]) : null;
  }
  return { ok: true, error: null, rows: Array.isArray(body) ? body : [], count: n };
}

function q(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.set(k, String(v));
  return u.toString();
}

async function countRows(base, key, table, filters) {
  const path = `/rest/v1/${table}?${q({ select: '*', ...filters })}`;
  const res = await restGet(base, key, path, { count: true });
  if (!res.ok) return unknown(res.error);
  if (res.count == null) return unknown('count header missing');
  return measured(res.count);
}

async function newest(base, key, table, column) {
  const path = `/rest/v1/${table}?${q({ select: column, [column]: 'not.is.null', order: `${column}.desc`, limit: '1' })}`;
  const res = await restGet(base, key, path);
  if (!res.ok) return unknown(res.error);
  const v = res.rows[0]?.[column];
  if (v == null) return unknown(`no non-null ${column}`);
  return measured(String(v));
}

async function rowsInWindow(base, key, table, select, filters) {
  const path = `/rest/v1/${table}?${q({ select, limit: '2000', ...filters })}`;
  return restGet(base, key, path);
}

async function measureSource(base, key, source, window) {
  const held = await countRows(base, key, source.table, {});
  // URLSearchParams cannot hold two values for the same key. Use an and() group.
  const inRange = (column, start, end, extra) => {
    const parts = [`${column}.gte.${start}`, `${column}.lt.${end}`];
    if (extra) parts.push(extra);
    return { and: `(${parts.join(',')})` };
  };

  const freshNew = source.created
    ? await countRows(base, key, source.table, inRange(source.created, window.start, window.end))
    : unknown(`no created column on ${source.table}`);
  const retouched = source.created && source.touched
    ? await countRows(base, key, source.table, inRange(source.touched, window.start, window.end, `${source.created}.lt.${window.start}`))
    : unknown(source.touched ? `no created column; a ${source.touched} count would mix new rows with re-touches` : `no touch column on ${source.table}`);
  const material = source.material && source.created
    ? await countRows(base, key, source.table, inRange(source.material, window.start, window.end, `${source.created}.lt.${window.start}`))
    : unknown(source.material ? `no created column; cannot separate new rows from ${source.material}` : `${source.table} has no source field distinct from the write clock`);
  const lastCreated = source.created ? await newest(base, key, source.table, source.created) : unknown('no created column');
  const lastTouched = source.touched ? await newest(base, key, source.table, source.touched) : unknown('no touch column');

  let latency = unknown(`no created+published pair on ${source.table}`);
  if (source.created && source.published) {
    const got = await rowsInWindow(base, key, source.table, `${source.created},${source.published}`, inRange(source.created, window.start, window.end));
    if (!got.ok) latency = unknown(got.error);
    else {
      const hours = [];
      for (const row of got.rows) {
        const landed = Date.parse(row[source.created]);
        const published = Date.parse(row[source.published]);
        if (!Number.isFinite(landed) || !Number.isFinite(published)) continue;
        hours.push((landed - published) / 3600_000);
      }
      const capped = got.rows.length >= 2000;
      latency = {
        value: latencySummary(hours),
        status: capped ? 'unknown' : 'measured',
        reason: capped ? 'read cap of 2000 rows hit; median/p90 would be a slice, not the population' : (hours.length ? null : 'no rows in the window had both timestamps'),
      };
    }
  }

  let customerReachable = unknown(source.created ? 'not checked' : `no created column on ${source.table}; cannot pick a new id`);
  if (source.created) {
    const sample = await rowsInWindow(base, key, source.table, source.id, { ...inRange(source.created, window.start, window.end), limit: '1' });
    if (!sample.ok) customerReachable = unknown(sample.error);
    else if (!sample.rows[0] || sample.rows[0][source.id] == null) {
      customerReachable = { value: null, status: 'measured', reason: 'no new id in the window to spot-check', customer: source.customer };
    } else {
      const id = sample.rows[0][source.id];
      const again = await restGet(base, key, `/rest/v1/${source.table}?${q({ select: source.id, [source.id]: `eq.${id}`, limit: '1' })}`);
      if (!again.ok) customerReachable = unknown(again.error);
      else {
        const found = again.rows.length === 1;
        customerReachable = {
          value: found,
          status: 'measured',
          reason: found
            ? `id ${id} is readable by GET ${source.table}?${source.id}=eq.${id}. ${source.customer}`
            : `id ${id} was not readable on a second GET`,
          customer: source.customer,
        };
      }
    }
  }

  return {
    key: source.key,
    tile: source.tile,
    table: source.table,
    note: source.note ?? null,
    held,
    newInWindow: freshNew,
    retouchedInWindow: retouched,
    materialClockInWindow: material,
    lastCreated,
    lastTouched,
    latency,
    customerReachable,
  };
}

async function main() {
  const window = acquisitionWindow(new Date());
  const json = process.argv.includes('--json');
  const { url, key } = loadCredentials();
  if (!url || !key) {
    const body = {
      label: 'READ-ONLY acquisition scorecard',
      measured: false,
      queries: 'GET /rest/v1 only',
      window,
      reason: 'missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY in the environment or .env.local',
      sources: SOURCES.map((s) => ({
        key: s.key,
        tile: s.tile,
        newInWindow: unknown('credentials not in this environment'),
        materialClockInWindow: unknown('credentials not in this environment'),
        customer: s.customer,
      })),
    };
    console.log(json ? JSON.stringify(body, null, 2) : [
      'READ-ONLY acquisition scorecard — NOT MEASURED',
      `window ${window.start} .. ${window.end}`,
      body.reason,
      'Every count below is unknown. None of them are zero.',
      ...body.sources.map((s) => `- ${s.tile}: unknown (${s.customer})`),
    ].join('\n'));
    process.exit(2);
  }

  const sources = [];
  for (const source of SOURCES) {
    sources.push(await measureSource(url, key, source, window));
  }
  const dibbs = await restGet(url, key, `/rest/v1/cron_jobs?${q({ select: 'job_name,enabled,cron_expr', job_name: 'eq.sync-dibbs', limit: '1' })}`);
  const report = {
    label: 'READ-ONLY acquisition scorecard',
    measured: true,
    queries: 'GET /rest/v1 only',
    window,
    dibbsCron: dibbs.ok ? measured(dibbs.rows[0] ?? null) : unknown(dibbs.error),
    sources,
  };
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('acquisition-scorecard.mjs')) main();
