/**
 * READ-ONLY seven-day acquisition scorecard.
 *
 * Counts genuinely new rows (created in the window) separately from rows that
 * were only re-touched (synced_at / last_seen_at). A "material change" is
 * counted only when the table has a source field that is not our write clock
 * (SAM last_modified, forecast updated_at). Otherwise the cell is unknown.
 *
 * Does not insert, update, delete, or call a sync route.
 *
 *   node scripts/acquisition-scorecard.mjs
 *   node scripts/acquisition-scorecard.mjs --json
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (vercel env pull
 * .env.local). Without them the script prints unknown for every count and
 * exits 2. It does not invent zeros.
 */
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });

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

/**
 * @param {number[]} hours latency samples, already finite
 */
export function latencySummary(hours) {
  if (!hours.length) return { medianHours: null, p90Hours: null, sample: 0 };
  const sorted = [...hours].sort((a, b) => a - b);
  return {
    medianHours: Math.round(percentile(sorted, 50) * 10) / 10,
    p90Hours: Math.round(percentile(sorted, 90) * 10) / 10,
    sample: sorted.length,
  };
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
    note: 'Annual scorecard snapshot. No daily collector. New-in-7d is unknown unless a created_at exists.',
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
    customer: '/api/app/dibbs reads dibbs_rfqs. Collection is disabled; do not treat a touch as new.',
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

async function countWhere(sb, table, column, start, end) {
  let q = sb.from(table).select(column, { count: 'exact', head: true });
  if (column && start) q = q.gte(column, start);
  if (column && end) q = q.lt(column, end);
  const { count, error } = await q;
  if (error) return unknown(error.message);
  if (count == null) return unknown('count returned null');
  return { value: count, status: 'measured', reason: null };
}

async function newest(sb, table, column) {
  const { data, error } = await sb.from(table).select(column).not(column, 'is', null)
    .order(column, { ascending: false }).limit(1);
  if (error) return unknown(error.message);
  const v = data?.[0]?.[column];
  if (v == null) return unknown(`no non-null ${column}`);
  return { value: String(v), status: 'measured', reason: null };
}

async function latencyFor(sb, source, window) {
  if (!source.created || !source.published) {
    return unknown(`no created+published pair on ${source.table}`);
  }
  const { data, error } = await sb.from(source.table)
    .select(`${source.created},${source.published}`)
    .gte(source.created, window.start)
    .lt(source.created, window.end)
    .limit(2000);
  if (error) return unknown(error.message);
  const hours = [];
  for (const row of data ?? []) {
    const landed = Date.parse(row[source.created]);
    const published = Date.parse(row[source.published]);
    if (!Number.isFinite(landed) || !Number.isFinite(published)) continue;
    hours.push((landed - published) / 3600_000);
  }
  const summary = latencySummary(hours);
  const capped = (data?.length ?? 0) >= 2000;
  return {
    value: summary,
    status: capped ? 'unknown' : 'measured',
    reason: capped
      ? 'read cap of 2000 rows hit; median/p90 would be a slice, not the population'
      : (hours.length ? null : 'no rows in the window had both timestamps'),
  };
}

async function spotCheck(sb, source, window) {
  if (!source.created) return unknown(`no created_at on ${source.table}; cannot pick a new id`);
  const { data, error } = await sb.from(source.table)
    .select(source.id)
    .gte(source.created, window.start)
    .lt(source.created, window.end)
    .limit(1);
  if (error) return unknown(error.message);
  const id = data?.[0]?.[source.id];
  if (id == null) return { value: null, status: 'measured', reason: 'no new id in the window to spot-check', customer: source.customer };
  const again = await sb.from(source.table).select(source.id).eq(source.id, id).limit(1);
  if (again.error) return unknown(again.error.message);
  const found = (again.data ?? []).length === 1;
  return {
    value: found,
    status: 'measured',
    reason: found
      ? `id ${id} is readable by selecting ${source.table}.${source.id}. ${source.customer}`
      : `id ${id} was not readable on a second select`,
    customer: source.customer,
  };
}

export async function measureSource(sb, source, window) {
  const [held, created, touched, material, lastCreated, lastTouched] = await Promise.all([
    countWhere(sb, source.table, source.id, null, null),
    source.created ? countWhere(sb, source.table, source.created, window.start, window.end) : Promise.resolve(unknown(`no created column on ${source.table}`)),
    source.touched ? countWhere(sb, source.table, source.touched, window.start, window.end) : Promise.resolve(unknown(`no touch column on ${source.table}`)),
    source.material
      ? countWhere(sb, source.table, source.material, window.start, window.end)
      : Promise.resolve(unknown(`${source.table} has no source field distinct from the write clock`)),
    source.created ? newest(sb, source.table, source.created) : Promise.resolve(unknown('no created column')),
    source.touched ? newest(sb, source.table, source.touched) : Promise.resolve(unknown('no touch column')),
  ]);
  const latency = await latencyFor(sb, source, window);
  const reach = await spotCheck(sb, source, window);
  return {
    key: source.key,
    tile: source.tile,
    table: source.table,
    note: source.note ?? null,
    held,
    newInWindow: created,
    retouchedInWindow: touched,
    materialClockInWindow: material,
    lastCreated,
    lastTouched,
    latency,
    customerReachable: reach,
  };
}

async function main() {
  const window = acquisitionWindow(new Date());
  const json = process.argv.includes('--json');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const body = {
      label: 'READ-ONLY acquisition scorecard',
      measured: false,
      window,
      reason: 'missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run: vercel env pull .env.local — then node scripts/acquisition-scorecard.mjs',
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

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const sources = [];
  for (const source of SOURCES) sources.push(await measureSource(sb, source, window));
  const { data: dibbsJob, error: dibbsErr } = await sb.from('cron_jobs')
    .select('job_name,enabled,cron_expr').eq('job_name', 'sync-dibbs').limit(1);
  const report = {
    label: 'READ-ONLY acquisition scorecard',
    measured: true,
    window,
    dibbsCron: dibbsErr ? unknown(dibbsErr.message) : { value: dibbsJob?.[0] ?? null, status: 'measured', reason: null },
    sources,
  };
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('acquisition-scorecard.mjs')) main();
