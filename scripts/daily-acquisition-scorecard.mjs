/**
 * READ-ONLY daily acquisition scorecard.
 *
 *   node scripts/daily-acquisition-scorecard.mjs --out-dir /tmp/scorecard
 *
 * Same credentials and the same GET-only PostgREST client as
 * scripts/acquisition-scorecard.mjs. No insert, update, delete, upsert, or RPC.
 *
 * New records are rows whose created_at or first_seen (or, where that column
 * is the insert-only acquisition clock, discovered_at) falls in the window.
 * A cron_job_runs success, a synced_at touch, and an unchanged upsert are not
 * new. A failed read is unknown, never zero.
 *
 * Last nonempty ingest and the stalled flag come from data_source_instances
 * (last_verified_ingest / last_data_advance, source_state, watch_cadence_days).
 * last_poll is not an ingest.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { applyEnvFile, q, restGet } from './acquisition-scorecard.mjs';

const HOUR = 60 * 60 * 1000;
export const EXAMPLE_CAP = 5;
export const INSTANCE_CAP = 1000;
export const SCORECARD_BEGIN = '=== SCORECARD BEGIN ===';
export const SCORECARD_END = '=== SCORECARD END ===';
/** Server text never reaches a public log. A failed read stays unknown. */
export const READ_FAILED = 'the read failed';

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi;
const CONN = /\b(?:postgres|postgresql|mysql|mongodb|redis):\/\/\S+/gi;
const KEY_ASSIGN = /\b(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|secret|password|sig|signature|service[_-]?role(?:[_-]?key)?)\s*[=:]\s*\S+/gi;
const AWS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
const STRIPE_KEY = /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+\b/g;

function isInternalHost(host) {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localdomain')) return true;
  if (h.endsWith('.supabase.co') || h.endsWith('.supabase.in') || h.endsWith('.supabase.net')) return true;
  if (h === '0.0.0.0' || h === '::1') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  return false;
}

/** A public http(s) link, or null. Query strings and userinfo are dropped. */
export function publicLink(value) {
  if (value == null || String(value).trim() === '') return null;
  let url;
  try { url = new URL(String(value).trim()); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (isInternalHost(url.hostname)) return null;
  if (/token|apikey|api_key|secret|password|signature|eyJ/i.test(`${url.username}${url.password}${url.pathname}`)) return null;
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** Redact emails, keys, connection strings, and non-public URLs inside free text. */
export function scrubPublicText(value) {
  if (value == null) return value;
  let s = String(value);
  s = s.replace(/https?:\/\/[^\s)]+/gi, (raw) => {
    const trimmed = raw.replace(/[),.;]+$/g, '');
    const tail = raw.slice(trimmed.length);
    const link = publicLink(trimmed);
    return (link ?? '[redacted]') + tail;
  });
  s = s.replace(EMAIL, '[redacted]');
  s = s.replace(BEARER, '[redacted]');
  s = s.replace(JWT, '[redacted]');
  s = s.replace(CONN, '[redacted]');
  s = s.replace(KEY_ASSIGN, '[redacted]');
  s = s.replace(AWS_KEY, '[redacted]');
  s = s.replace(STRIPE_KEY, '[redacted]');
  s = s.replace(/\b[a-z0-9-]+\.supabase\.(?:co|in|net)\b/gi, '[redacted]');
  return s;
}

function publishString(value) {
  const text = String(value);
  if (/^\s*https?:\/\//i.test(text)) return publicLink(text.trim()) ?? '';
  return scrubPublicText(text);
}

/** Walk a report and publish every string. Failed-read server bodies are not copied in. */
export function toPublicReport(value) {
  if (value == null) return value;
  if (typeof value === 'string') return publishString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => toPublicReport(item));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = toPublicReport(v);
    return out;
  }
  return null;
}

export function publicMarkdown(report) {
  return scrubPublicText(renderMarkdown(toPublicReport(report)));
}

export function publicJson(report) {
  return scrubPublicText(JSON.stringify(toPublicReport(report), null, 2));
}

/** Rolling windows ending at `now`. 24h is not "today so far". */
export function dailyWindows(now = new Date()) {
  const endMs = now.getTime();
  const end = new Date(endMs).toISOString();
  return {
    h24: { start: new Date(endMs - 24 * HOUR).toISOString(), end, hours: 24 },
    d7: { start: new Date(endMs - 7 * 24 * HOUR).toISOString(), end, hours: 168 },
  };
}

function fact(value, status, reason, column = null) {
  return { value, status, reason: reason ?? null, column };
}

export function unknown(reason, column = null) {
  return fact(null, 'unknown', reason, column);
}

export function measured(value, reason = null, column = null) {
  return fact(value, 'measured', reason, column);
}

/**
 * Two missed cadence cycles, plus an hour, before a nonempty ingest is stalled.
 * Same bound as timestampState in src/lib/data-core/inventory-model.ts.
 */
export function ingestIsPastCadence(asOf, cadenceDays, now) {
  const days = Number(cadenceDays);
  if (!asOf || !Number.isFinite(days) || days <= 0) return null;
  const ageH = (now.getTime() - Date.parse(asOf)) / HOUR;
  if (!Number.isFinite(ageH)) return null;
  const cadenceHours = days * 24;
  return { stale: ageH > cadenceHours * 2 + 1, ageH, cadenceHours };
}

export function lastNonemptyIngest(row) {
  if (!row) return unknown('no data_source_instances row');
  const verified = row.last_verified_ingest || null;
  const advance = row.last_data_advance || null;
  if (verified) return measured(String(verified), null, 'last_verified_ingest');
  if (advance) return measured(String(advance), null, 'last_data_advance');
  return measured(
    null,
    'neither last_verified_ingest nor last_data_advance is set. last_poll and a cron success are not an ingest.',
  );
}

/**
 * @param {object|null} row data_source_instances row, or null when the row is missing
 * @param {{ now: Date, producerEnabled: true|false|null|'unreadable' }} opts
 *   null = no cron is bound, clocks decide. 'unreadable' = the enabled flag
 *   could not be read, so a "not stalled" answer is refused.
 */
export function classifyStalled(row, { now, producerEnabled = null } = {}) {
  if (!row) return unknown('no data_source_instances row');
  if (row.source_state === 'content_stale') return measured(true, 'source_state=content_stale');
  if (row.source_state === 'unreachable') return measured(true, 'source_state=unreachable');
  if (producerEnabled === false) {
    return measured(true, 'producer cron is disabled. A past ingest does not make this feed current.');
  }

  const clock = lastNonemptyIngest(row);
  if (clock.status !== 'measured' || clock.value == null) {
    return unknown('no last_verified_ingest and no last_data_advance. last_poll is not an ingest, and source_state=current without that clock is not proof the feed is moving.');
  }
  const age = ingestIsPastCadence(clock.value, row.watch_cadence_days, now);
  if (!age) {
    return unknown('watch_cadence_days is missing or the nonempty ingest is not a timestamp, so age cannot be judged');
  }
  if (age.stale) {
    return measured(true, `last nonempty ingest is ${Math.floor(age.ageH)}h old; cadence is ${age.cadenceHours}h (stalled after two cycles plus an hour)`);
  }
  if (row.source_state !== 'current' && row.source_state !== 'upstream_quiet') {
    return unknown(`source_state=${row.source_state ?? 'null'} is not a known stall signal`);
  }
  if (producerEnabled === 'unreadable') {
    return unknown('cron_jobs.enabled could not be read, so a disabled collector cannot be ruled out');
  }
  const quiet = row.source_state === 'upstream_quiet' ? ' Upstream had nothing new.' : '';
  return measured(false, `nonempty ingest is inside cadence.${quiet}`);
}

/**
 * Instance source_key → the only column story this scorecard will count.
 * Anything else stays unknown. A guessed created_at would count the wrong clock.
 */
export const SOURCE_BINDINGS = {
  sam_opportunities_sam_gov: {
    table: 'sam_opportunities',
    newColumn: 'created_at',
    newNote: 'sam_opportunities.created_at is the insert default and is omitted from the SAM upsert, so a re-sync does not reset it.',
    materialColumn: 'last_modified',
    materialNote: 'last_modified is SAM lastModifiedDate. synced_at is a row touch and is not counted.',
  },
  dibbs_dla_flat_files: {
    table: 'dibbs_rfqs',
    newColumn: null,
    newNote: 'dibbs_rfqs has scraped_at and synced_at and no created_at or first_seen. A row touch is not a new RFQ.',
    materialColumn: null,
    materialNote: 'no publisher change column. synced_at moves on upsert.',
    cronJob: 'sync-dibbs',
  },
  grants_gov_api: {
    table: 'grants_cache',
    newColumn: null,
    newNote: 'grants_cache has scraped_at and synced_at and no created_at or first_seen.',
    materialColumn: null,
    materialNote: 'no publisher change column on grants_cache.',
    cronJob: 'sync-grants',
  },
  institute_gao: {
    table: 'institute_sources',
    filters: { source_type: 'eq.gao_report' },
    newColumn: 'discovered_at',
    newNote: 'institute_sources has no created_at or first_seen. discovered_at defaults on insert and is not written on update, so it is the acquisition clock for gao_report rows only.',
    materialColumn: null,
    materialNote: 'updated_at also moves when agency resolution is rewritten, so it is not counted as a source change.',
    cronJob: 'institute-gao-sync',
  },
};

export const CORPORA = [
  {
    key: 'pain_points',
    tile: 'Source-backed pain points',
    table: 'agency_pain_points_db',
    newColumn: 'created_at',
    newNote: 'agency_pain_points_db.created_at is the insert default. Importers omit it on upsert, and the GAO deriver inserts. first_seen is set only by the deriver and is null on imported rows, so it is not the population clock.',
    materialColumn: null,
    materialNote: 'updated_at is a BEFORE UPDATE trigger. There is no publisher change column.',
    example: { title: 'pain_point', agency: 'agency', link: 'source_url' },
    cronJob: 'institute-gao-sync',
  },
  {
    key: 'forecasts',
    tile: 'Agency procurement forecasts',
    table: 'agency_forecasts',
    newColumn: 'created_at',
    newNote: 'agency_forecasts.created_at is the insert default. Daily upserts do not send created_at, so a republish keeps the original row and is not a new forecast.',
    materialColumn: null,
    materialNote: 'updated_at and last_synced_at are Mindy write clocks. An unchanged upsert can move them. No publisher change column is counted.',
    example: { title: 'title', agency: 'source_agency', link: 'source_url' },
    rollupDataset: 'forecast_intelligence',
    cronJob: 'sync-forecasts',
  },
  {
    key: 'events',
    tile: 'Event Radar',
    table: 'sam_events',
    newColumn: null,
    newNote: 'sam_events has no created_at or first_seen. extracted_at is stamped on every re-read, so counting it would treat a re-read as a new event.',
    materialColumn: null,
    materialNote: 'extracted_at moves on every write, including an unchanged re-read. That is not a source change count.',
    example: null,
    cronJob: 'extract-sam-events',
  },
];

/** Latest run only. Never folded into a count. */
export const RUN_JOBS = [
  'sync-sam-opportunities-delta',
  'sync-dibbs',
  'sync-grants',
  'sync-forecasts',
  'extract-sam-events',
  'institute-gao-sync',
  'sync-dod-sbir',
];

const INSTANCE_COLUMNS = [
  'source_key', 'name', 'dataset_key', 'source_state', 'watch_cadence_days',
  'last_poll', 'last_successful_check', 'last_verified_ingest', 'last_data_advance',
].join(',');

function unboundSpec(row) {
  if (row.dataset_key === 'forecast_intelligence') {
    return {
      newColumn: null,
      newNote: 'new forecast rows are counted once on the forecasts corpus by agency_forecasts.created_at. This instance has no verified source_agency filter, so its rows are not counted again here.',
      materialColumn: null,
      materialNote: 'no publisher change column is bound to this forecast instance.',
    };
  }
  return {
    newColumn: null,
    newNote: `no created_at or first_seen binding for ${row.source_key}. A guessed column would count the wrong clock.`,
    materialColumn: null,
    materialNote: `no source change column is bound for ${row.source_key}.`,
  };
}

async function countWhere(io, spec, column, start, end, extra) {
  const parts = [`${column}.gte.${start}`, `${column}.lt.${end}`];
  if (extra) parts.push(extra);
  const res = await io.count(spec.table, { ...(spec.filters || {}), and: `(${parts.join(',')})` });
  if (!res || res.ok !== true || typeof res.count !== 'number' || !Number.isFinite(res.count)) {
    return unknown(READ_FAILED, column);
  }
  return measured(res.count, null, column);
}

async function measureCounts(io, spec, windows) {
  const blank = (note) => ({
    newUnique24h: unknown(note),
    newUnique7d: unknown(note),
  });
  let fresh;
  if (!spec.table || !spec.newColumn) fresh = blank(spec.newNote || 'no created_at or first_seen');
  else {
    fresh = {
      newUnique24h: await countWhere(io, spec, spec.newColumn, windows.h24.start, windows.h24.end),
      newUnique7d: await countWhere(io, spec, spec.newColumn, windows.d7.start, windows.d7.end),
    };
  }

  const material = async (start, end) => {
    if (!spec.materialColumn) return unknown(spec.materialNote || 'no source change column');
    if (!spec.newColumn) {
      return unknown(`no created_at or first_seen, so a ${spec.materialColumn} count would mix new rows with updates`);
    }
    return countWhere(io, spec, spec.materialColumn, start, end, `${spec.newColumn}.lt.${start}`);
  };

  return {
    ...fresh,
    materiallyUpdated24h: await material(windows.h24.start, windows.h24.end),
    materiallyUpdated7d: await material(windows.d7.start, windows.d7.end),
  };
}

function resolveProducer(cronJob, enabledByJob) {
  if (!cronJob) {
    return {
      mode: null,
      fact: unknown('no single producer cron is bound; stalled is judged from the instance clocks'),
    };
  }
  if (!enabledByJob || enabledByJob.error) {
    return {
      mode: 'unreadable',
      fact: unknown(READ_FAILED),
    };
  }
  if (!Object.prototype.hasOwnProperty.call(enabledByJob.map, cronJob)) {
    return { mode: null, fact: unknown(`cron_jobs has no row for ${cronJob}`) };
  }
  const raw = enabledByJob.map[cronJob];
  if (raw === true || raw === 'true') return { mode: true, fact: measured(true) };
  if (raw === false || raw === 'false') return { mode: false, fact: measured(false) };
  return { mode: 'unreadable', fact: unknown(`cron_jobs.enabled for ${cronJob} was not a boolean`) };
}

export function rollupClock(instanceRead, datasetKey, now, producerEnabled) {
  if (!instanceRead.ok) {
    return { lastNonemptyIngest: unknown(READ_FAILED), stalled: unknown(READ_FAILED) };
  }
  const mine = instanceRead.rows.filter((row) => row.dataset_key === datasetKey);
  if (!mine.length) {
    const reason = `no data_source_instances row with dataset_key=${datasetKey}`;
    return { lastNonemptyIngest: unknown(reason), stalled: unknown(reason) };
  }
  let best = null;
  let bestColumn = null;
  for (const row of mine) {
    const clock = lastNonemptyIngest(row);
    if (clock.status !== 'measured' || clock.value == null) continue;
    if (!best || Date.parse(clock.value) > Date.parse(best)) {
      best = clock.value;
      bestColumn = clock.column;
    }
  }
  const newest = best
    ? measured(best, 'newest nonempty clock among instances of this dataset', bestColumn)
    : measured(null, 'instances were read and none has last_verified_ingest or last_data_advance');

  const flags = mine.map((row) => classifyStalled(row, { now, producerEnabled }));
  const stalledTrue = flags.find((f) => f.status === 'measured' && f.value === true);
  if (stalledTrue) return { lastNonemptyIngest: newest, stalled: stalledTrue };
  const stalledUnknown = flags.find((f) => f.status !== 'measured');
  if (stalledUnknown) return { lastNonemptyIngest: newest, stalled: stalledUnknown };
  return { lastNonemptyIngest: newest, stalled: measured(false, 'every instance of this dataset is inside cadence') };
}

function clocksForCorpus(corpus, instanceRead, now, producer) {
  if (producer.mode === false) {
    return {
      lastNonemptyIngest: instanceRead.ok && corpus.rollupDataset
        ? rollupClock(instanceRead, corpus.rollupDataset, now, producer.mode).lastNonemptyIngest
        : unknown('no data_source_instances clock is bound to this table. A cron success is not an ingest.'),
      stalled: measured(true, 'producer cron is disabled. A past ingest does not make this feed current.'),
    };
  }
  if (corpus.rollupDataset) return rollupClock(instanceRead, corpus.rollupDataset, now, producer.mode);
  return {
    lastNonemptyIngest: unknown('no data_source_instances row is bound to this table. A cron success is not an ingest.'),
    stalled: producer.mode === 'unreadable'
      ? unknown(producer.fact.reason)
      : unknown('no data_source_instances row is bound to this table, so cadence cannot be judged. A successful cron run is not evidence the feed is moving.'),
  };
}

async function measureExamples(io, corpus, window) {
  if (!corpus.example || !corpus.newColumn || !corpus.table) {
    return unknown(corpus.newNote || 'no created_at or first_seen, so an example list would be the latest re-read');
  }
  const cols = [corpus.example.title, corpus.example.agency, corpus.example.link, corpus.newColumn];
  const res = await io.rows(corpus.table, {
    select: cols.join(','),
    order: `${corpus.newColumn}.desc`,
    limit: String(EXAMPLE_CAP),
    ...(corpus.filters || {}),
    and: `(${corpus.newColumn}.gte.${window.start},${corpus.newColumn}.lt.${window.end})`,
  });
  if (!res || res.ok !== true || !Array.isArray(res.rows)) {
    return unknown(READ_FAILED);
  }
  const value = res.rows.slice(0, EXAMPLE_CAP).map((row) => ({
    title: row[corpus.example.title] ?? null,
    agency: row[corpus.example.agency] ?? null,
    link: publicLink(row[corpus.example.link]) ?? null,
    seenAt: row[corpus.newColumn] ?? null,
  }));
  return measured(value, value.length ? null : 'no new rows in the 7d window');
}

async function latestRun(io, job) {
  const res = await io.rows('cron_job_runs', {
    select: 'job_name,started_at,finished_at,status,http_status',
    job_name: `eq.${job}`,
    order: 'started_at.desc',
    limit: '1',
  });
  if (!res || res.ok !== true || !Array.isArray(res.rows)) {
    return { job, latest: unknown(READ_FAILED) };
  }
  const row = res.rows[0];
  if (!row) {
    return {
      job,
      latest: measured(null, 'no cron_job_runs row. That is not zero new records.'),
    };
  }
  return {
    job,
    latest: measured(
      {
        startedAt: row.started_at ?? null,
        finishedAt: row.finished_at ?? null,
        status: row.status ?? null,
        httpStatus: row.http_status ?? null,
      },
      'a cron_job_runs row is not a count of new records and not a nonempty ingest',
    ),
  };
}

function jobsToRead(bindings, corpora) {
  const names = new Set();
  for (const spec of Object.values(bindings)) if (spec.cronJob) names.add(spec.cronJob);
  for (const corpus of corpora) if (corpus.cronJob) names.add(corpus.cronJob);
  return [...names].sort();
}

export async function buildDailyScorecard(io, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  const windows = dailyWindows(now);
  const bindings = opts.bindings ?? SOURCE_BINDINGS;
  const corpora = opts.corpora ?? CORPORA;
  const jobs = opts.jobs ?? RUN_JOBS;

  const instanceRead = await io.rows('data_source_instances', {
    select: INSTANCE_COLUMNS,
    order: 'source_key.asc',
    limit: String(INSTANCE_CAP),
  });
  const rows = instanceRead && instanceRead.ok && Array.isArray(instanceRead.rows) ? instanceRead.rows : [];
  const capped = instanceRead && instanceRead.ok === true && rows.length >= INSTANCE_CAP;
  const instanceList = !instanceRead || instanceRead.ok !== true
    ? { ...unknown(READ_FAILED), capped: false, readOk: false }
    : capped
      ? { ...unknown('read cap of 1000 data_source_instances rows hit; the source list is a slice, not the population'), capped: true, readOk: true }
      : { ...measured(rows.length), capped: false, readOk: true };

  const jobNames = jobsToRead(bindings, corpora);
  let enabledByJob = { map: {}, error: null };
  if (jobNames.length) {
    const enabled = await io.rows('cron_jobs', {
      select: 'job_name,enabled',
      job_name: `in.(${jobNames.join(',')})`,
      limit: '100',
    });
    if (!enabled || enabled.ok !== true || !Array.isArray(enabled.rows)) {
      enabledByJob = { map: {}, error: READ_FAILED };
    } else {
      const map = {};
      for (const row of enabled.rows) if (row && row.job_name) map[row.job_name] = row.enabled;
      enabledByJob = { map, error: null };
    }
  }

  const sources = [];
  if (instanceList.readOk) {
    for (const row of rows) {
      const spec = bindings[row.source_key] || unboundSpec(row);
      const producer = resolveProducer(spec.cronJob, enabledByJob);
      const counts = await measureCounts(io, spec, windows);
      sources.push({
        sourceKey: row.source_key ?? null,
        name: row.name ?? null,
        datasetKey: row.dataset_key ?? null,
        table: spec.table ?? null,
        ...counts,
        lastNonemptyIngest: lastNonemptyIngest(row),
        stalled: classifyStalled(row, { now, producerEnabled: producer.mode }),
        producerEnabled: producer.fact,
      });
    }
  }

  const corpusReports = [];
  const examples = {};
  for (const corpus of corpora) {
    const producer = resolveProducer(corpus.cronJob, enabledByJob);
    const counts = await measureCounts(io, corpus, windows);
    const clocks = clocksForCorpus(corpus, { ok: instanceList.readOk, error: instanceList.reason, rows }, now, producer);
    corpusReports.push({
      key: corpus.key,
      tile: corpus.tile,
      table: corpus.table,
      ...counts,
      ...clocks,
      producerEnabled: producer.fact,
    });
    examples[corpus.key] = await measureExamples(io, corpus, windows.d7);
  }

  const runHistory = [];
  for (const job of jobs) runHistory.push(await latestRun(io, job));

  return {
    label: 'Daily acquisition scorecard',
    measured: true,
    queries: 'GET /rest/v1 only',
    generatedAt: now.toISOString(),
    windows,
    counting: 'New records are rows whose created_at, first_seen, or insert-only discovered_at falls in the window. A cron_job_runs success, a synced_at touch, and an unchanged upsert are not new.',
    instanceList,
    sources,
    corpora: corpusReports,
    examples,
    runHistory,
  };
}

function clip(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '(no title)';
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function showCount(f) {
  if (!f || f.status !== 'measured') return `unknown — ${f?.reason ?? 'not read'}`;
  if (f.value == null) return `none — ${f.reason ?? 'not recorded'}`;
  return `${f.value}${f.column ? ` (${f.column})` : ''}`;
}

function showStalled(f) {
  if (!f || f.status !== 'measured') return `unknown — ${f?.reason ?? 'not read'}`;
  if (f.value === true) return `yes — ${f.reason ?? ''}`.trim();
  if (f.value === false) return `no — ${f.reason ?? ''}`.trim();
  return `none — ${f.reason ?? 'not recorded'}`;
}

function showWhen(f) {
  if (!f || f.status !== 'measured') return `unknown — ${f?.reason ?? 'not read'}`;
  if (f.value == null) return `none — ${f.reason ?? 'not recorded'}`;
  return `${f.value}${f.column ? ` (${f.column})` : ''}`;
}

export function renderMarkdown(report) {
  const lines = [
    '# Daily acquisition scorecard',
    '',
    `Generated ${report.generatedAt}.`,
    '',
    report.measured
      ? `24h ${report.windows.h24.start} → ${report.windows.h24.end}. 7d ${report.windows.d7.start} → ${report.windows.d7.end}.`
      : `Not measured. ${report.reason}`,
    '',
    'Reads are GET /rest/v1 only. A failed read is unknown, not zero. Cron successes are under run history and are not counts.',
    '',
  ];
  if (!report.measured) {
    lines.push('Every count below is unknown. None of them are zero.');
    return `${lines.join('\n')}\n`;
  }

  lines.push('## Sources', '');
  if (!report.sources.length) {
    lines.push(`No instance rows. ${report.instanceList?.reason ?? ''}`.trim(), '');
  }
  for (const source of report.sources) {
    lines.push(`### ${source.sourceKey} — ${source.name ?? source.datasetKey ?? ''}`, '');
    lines.push(`- new unique 24h: ${showCount(source.newUnique24h)}`);
    lines.push(`- new unique 7d: ${showCount(source.newUnique7d)}`);
    lines.push(`- materially updated 24h: ${showCount(source.materiallyUpdated24h)}`);
    lines.push(`- materially updated 7d: ${showCount(source.materiallyUpdated7d)}`);
    lines.push(`- last nonempty ingest: ${showWhen(source.lastNonemptyIngest)}`);
    lines.push(`- stalled: ${showStalled(source.stalled)}`);
    lines.push('');
  }

  lines.push('## Corpora', '');
  for (const corpus of report.corpora) {
    lines.push(`### ${corpus.tile}`, '');
    lines.push(`- new unique 24h: ${showCount(corpus.newUnique24h)}`);
    lines.push(`- new unique 7d: ${showCount(corpus.newUnique7d)}`);
    lines.push(`- materially updated 24h: ${showCount(corpus.materiallyUpdated24h)}`);
    lines.push(`- materially updated 7d: ${showCount(corpus.materiallyUpdated7d)}`);
    lines.push(`- last nonempty ingest: ${showWhen(corpus.lastNonemptyIngest)}`);
    lines.push(`- stalled: ${showStalled(corpus.stalled)}`);
    lines.push('');
  }

  lines.push('## Examples (new in the 7d window, at most 5)', '');
  for (const [key, ex] of Object.entries(report.examples)) {
    lines.push(`### ${key}`, '');
    if (!ex || ex.status !== 'measured' || !Array.isArray(ex.value)) {
      lines.push(`unknown — ${ex?.reason ?? 'not read'}`, '');
      continue;
    }
    if (!ex.value.length) {
      lines.push('none in the 7d window', '');
      continue;
    }
    for (const row of ex.value.slice(0, EXAMPLE_CAP)) {
      lines.push(`- ${row.agency || 'agency unknown'} — ${clip(row.title)} — ${row.link || 'no source link'}`);
    }
    lines.push('');
  }

  lines.push('## Run history', '');
  lines.push('Latest cron_job_runs row per job. A success is not new records and not a nonempty ingest.', '');
  for (const run of report.runHistory) {
    const latest = run.latest;
    if (!latest || latest.status !== 'measured') {
      lines.push(`- ${run.job}: unknown — ${latest?.reason ?? 'not read'}`);
    } else if (latest.value == null) {
      lines.push(`- ${run.job}: no run row — ${latest.reason}`);
    } else {
      lines.push(`- ${run.job}: ${latest.value.status ?? 'unknown status'} at ${latest.value.startedAt ?? 'unknown time'} (http ${latest.value.httpStatus ?? 'unknown'})`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function createPostgrestReader(base, key) {
  return {
    async count(table, filters) {
      const path = `/rest/v1/${table}?${q({ ...filters, select: '*' })}`;
      const res = await restGet(base, key, path, { count: true });
      if (!res.ok) return { ok: false, error: res.error, rows: [], count: null };
      if (typeof res.count !== 'number') return { ok: false, error: 'count header missing', rows: [], count: null };
      return { ok: true, error: null, rows: [], count: res.count };
    },
    async rows(table, filters) {
      const path = `/rest/v1/${table}?${q(filters)}`;
      const res = await restGet(base, key, path);
      if (!res.ok) return { ok: false, error: res.error, rows: [], count: null };
      return { ok: true, error: null, rows: res.rows, count: null };
    },
  };
}

function loadCredentials() {
  if (existsSync('.env.local')) applyEnvFile(readFileSync('.env.local', 'utf8'));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return { url: url.replace(/\/$/, ''), key };
}

function unmeasured(now, reason) {
  const windows = dailyWindows(now);
  const field = () => unknown(reason);
  return {
    label: 'Daily acquisition scorecard',
    measured: false,
    queries: 'GET /rest/v1 only',
    generatedAt: now.toISOString(),
    windows,
    reason,
    counting: 'New records are rows whose created_at, first_seen, or insert-only discovered_at falls in the window. A cron_job_runs success, a synced_at touch, and an unchanged upsert are not new.',
    instanceList: { ...unknown(reason), capped: false, readOk: false },
    sources: [],
    corpora: CORPORA.map((c) => ({
      key: c.key,
      tile: c.tile,
      table: c.table,
      newUnique24h: field(),
      newUnique7d: field(),
      materiallyUpdated24h: field(),
      materiallyUpdated7d: field(),
      lastNonemptyIngest: field(),
      stalled: field(),
    })),
    examples: Object.fromEntries(CORPORA.map((c) => [c.key, field()])),
    runHistory: RUN_JOBS.map((job) => ({ job, latest: field() })),
  };
}

function writeReport(report, outDir) {
  const markdown = publicMarkdown(report);
  const json = publicJson(report);
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'acquisition-scorecard.json'), json);
    writeFileSync(join(outDir, 'acquisition-scorecard.md'), markdown);
  }
  console.log(SCORECARD_BEGIN);
  console.log(markdown);
  console.log(SCORECARD_END);
}

async function main() {
  const now = new Date();
  const outFlag = process.argv.indexOf('--out-dir');
  const outDir = outFlag >= 0 ? process.argv[outFlag + 1] : '';
  if (outFlag >= 0 && !outDir) {
    console.error('--out-dir needs a directory');
    process.exit(2);
  }
  const { url, key } = loadCredentials();
  if (!url || !key) {
    const report = unmeasured(now, 'credentials are not available in this environment');
    writeReport(report, outDir);
    process.exit(2);
  }
  let report;
  try {
    report = await buildDailyScorecard(createPostgrestReader(url, key), { now });
  } catch (err) {
    report = unmeasured(now, READ_FAILED);
    writeReport(report, outDir);
    process.exit(1);
  }
  writeReport(report, outDir);
  if (report.instanceList.readOk === false) process.exit(1);
}

if (process.argv[1] && basename(process.argv[1]) === 'daily-acquisition-scorecard.mjs') main();
