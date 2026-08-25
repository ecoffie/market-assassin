import { kv } from '@vercel/kv';
import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { bqQuery } from './bigquery/client';
import { DATA_VERSION } from './bigquery/cache';
import { sendOpsAlert } from './ops-alert';
import { readAllPages } from './paged-read';

/**
 * Durable awards refresh.
 *
 * DURABILITY IS NOT FRESHNESS. The serving table cannot lapse the way a 90-day
 * Redis TTL did, but a table that never updates still goes stale — and worse,
 * stales CONFIDENTLY: every page keeps rendering index,follow with a stale
 * "as of" date and no error anywhere. That is the same class of failure as the
 * false zero this whole incident was about, just slower.
 *
 * ── THE ORDER MATTERS ────────────────────────────────────────────────────────
 *  1. lock              — one run at a time, with expiry so a crash cannot wedge it
 *  2. read upstream     — what is the newest action_date in BigQuery?
 *  3. FRESHNESS GATE    — if upstream has nothing newer than live, DO NOT REBUILD
 *  4. build staging     — bounded by maximumBytesBilled
 *  5. validate          — counts, checksums, cohorts, ordering, single version
 *  6. plausibility      — refuse to promote an implausible delta
 *  7. promote atomically
 *  8. retain prior      — lifecycle='retired' for rollback
 *  9. read-back         — prove production reads the new generation
 * 10. release + telemetry (finally)
 *
 * Step 3 is the one that saves money: a daily freshness check is nearly free,
 * while a rebuild costs ~$0.11 and rewrites 23k rows. Rebuilding identical data
 * because the clock advanced is waste; NOT rebuilding when upstream moved is the
 * failure. The gate distinguishes them.
 */

// ── ceilings ────────────────────────────────────────────────────────────────
export const MAX_BYTES_BILLED = 20 * 1024 ** 3; // 20 GB, matches the initial build
export const PAGE_SIZE = 50;
export const MAX_PAGES = 3;
export const ELIGIBLE_LIMIT = 12000;
const MAX_ROWS_PER_RECIPIENT = PAGE_SIZE * MAX_PAGES;

/**
 * Upstream ingest is weekly. Data continuous through 2026-08-11 then stopping dead
 * is a missed cycle, not a tail-off — so >10 days means the INGEST is broken, which
 * is a different problem from this cron and must be reported as such.
 */
export const UPSTREAM_STALE_DAYS = 10;

/** A build that moves counts more than this is implausible; refuse to promote. */
export const TOLERANCE = {
  recipientsPct: 10, // ±10% of live recipient count
  pagesPct: 10,
  minRecipients: 5000, // a build smaller than this is broken, not shrunk
};

const LOCK_KEY = `awards-refresh:lock:${DATA_VERSION}`;
const LOCK_TTL_SECONDS = 45 * 60; // > the ~4 min run, < a stuck-forever wedge

export type RefreshOutcome =
  | 'success'
  | 'noop-upstream-not-newer'
  | 'skipped-locked'
  | 'failed-validation'
  | 'failed-promotion'
  | 'failed-readback'
  | 'failed-build';

export interface RefreshTelemetry {
  outcome: RefreshOutcome;
  durationMs: number;
  bytesBilled: number | null;
  upstreamSourceAsOf: string | null;
  liveSourceAsOf: string | null;
  upstreamAgeDays: number | null;
  recipients: number | null;
  pages: number | null;
  rows: number | null;
  detail?: string;
}

function db(): SupabaseClient {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new Error('Supabase env missing');
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Step 1. NX lock with expiry — a crashed run self-heals instead of wedging forever. */
export async function acquireLock(token: string): Promise<boolean> {
  const res = await kv.set(LOCK_KEY, token, { nx: true, ex: LOCK_TTL_SECONDS });
  return res === 'OK';
}

/** Release only OUR lock — never stomp a lock a later run legitimately acquired. */
export async function releaseLock(token: string): Promise<void> {
  try {
    const held = await kv.get<string>(LOCK_KEY);
    if (held === token) await kv.del(LOCK_KEY);
  } catch {
    /* the TTL is the backstop */
  }
}

/** Step 2. Newest action_date upstream. Cheap: one aggregate, no payload. */
export async function readUpstreamSourceAsOf(): Promise<{ date: string | null; ageDays: number | null }> {
  const rows = await bqQuery<{ max_date: { value: string } | string | null; age_days: number }>({
    query: `
      SELECT MAX(action_date) AS max_date,
             DATE_DIFF(CURRENT_DATE(), MAX(action_date), DAY) AS age_days
      FROM \`market-assasin.usaspending.awards\``,
    maximumBytesBilled: String(2 * 1024 ** 3),
    bulkJob: 'awards-refresh-freshness-probe',
  });
  const r = rows[0];
  if (!r) return { date: null, ageDays: null };
  const d = typeof r.max_date === 'object' && r.max_date ? r.max_date.value : (r.max_date as string | null);
  return { date: d, ageDays: Number(r.age_days ?? 0) };
}

/**
 * The upstream extent the CURRENT live generation captured.
 *
 * ⚠️ `source_as_of` is PER RECIPIENT — each row holds that contractor's own newest
 * action_date, so a generation contains ~970 distinct dates (Senture's is 08-03,
 * the busiest contractor's is 08-11). Reading MAX(source_as_of) therefore returns
 * the same number as the upstream probe by construction, and the gate would
 * compare a value to itself and no-op FOREVER.
 *
 * The right question is not "what is the newest date in the table" but "how far
 * had upstream advanced when this generation was built". MAX(source_as_of) answers
 * that correctly ONLY because a build always captures upstream's full extent — so
 * it is used, but paired with generated_at, and the comparison below is
 * strictly-greater against the upstream max at build time.
 *
 * Returns both so the caller can tell "we already have everything upstream holds"
 * from "we have never built".
 */
export async function readLiveGeneration(): Promise<{ capturedThrough: string | null; builtAt: string | null }> {
  const { data, error } = await db()
    .from('awards_serving_pages')
    .select('source_as_of, generated_at')
    .eq('lifecycle', 'live')
    .eq('data_version', DATA_VERSION)
    .order('source_as_of', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return { capturedThrough: null, builtAt: null };
  return {
    capturedThrough: data.source_as_of ? String(data.source_as_of) : null,
    builtAt: data.generated_at ? String(data.generated_at) : null,
  };
}

/** Back-compat alias used by the route's telemetry. */
export async function readLiveSourceAsOf(): Promise<string | null> {
  return (await readLiveGeneration()).capturedThrough;
}

/**
 * Step 3. THE FRESHNESS GATE.
 *
 * Rebuild only when upstream genuinely advanced. Two distinct signals:
 *   shouldRebuild  — upstream has data the live generation does not
 *   upstreamStale  — upstream ITSELF has not moved in > UPSTREAM_STALE_DAYS
 *
 * They are independent. Upstream can be stale AND newer than live, which means
 * rebuild AND alert — a fresher-but-still-stale build is an improvement, and the
 * ingest problem belongs to a different owner.
 *
 * ⚠️ `live` here is MAX(source_as_of) over the live generation, which equals the
 * upstream max at the moment that generation was built (a build always captures
 * upstream's full extent). So this comparison answers "has upstream advanced
 * SINCE we last built?" — not "is our newest row older than upstream's newest
 * row", which would be comparing a value to itself and would no-op forever.
 * Verified on 2026-08-25: a generation built at 00:43 that captured through
 * 08-11 correctly no-ops against an upstream still at 08-11.
 */
export function evaluateFreshness(
  upstream: string | null,
  live: string | null,
  upstreamAgeDays: number | null,
): { shouldRebuild: boolean; upstreamStale: boolean; reason: string } {
  const upstreamStale = (upstreamAgeDays ?? 0) > UPSTREAM_STALE_DAYS;
  if (!upstream) {
    return { shouldRebuild: false, upstreamStale: true, reason: 'upstream source date unreadable' };
  }
  if (!live) {
    return { shouldRebuild: true, upstreamStale, reason: 'no live generation yet' };
  }
  if (upstream > live) {
    return { shouldRebuild: true, upstreamStale, reason: `upstream ${upstream} > live ${live}` };
  }
  return {
    shouldRebuild: false,
    upstreamStale,
    reason: `upstream ${upstream} is not newer than live ${live}`,
  };
}

export const BUILD_QUERY = `
WITH elig AS (
  SELECT rollup_uei FROM \`market-assasin.usaspending.recipients_rollup_merged\`
  WHERE rollup_name IS NOT NULL AND rollup_name != ''
  ORDER BY total_obligated DESC LIMIT ${ELIGIBLE_LIMIT}
),
scoped AS (SELECT a.* FROM \`market-assasin.usaspending.awards\` a JOIN elig e ON e.rollup_uei = a.recipient_uei),
counts AS (
  SELECT recipient_uei,
    COUNT(DISTINCT IF(obligation_amount > 0, award_id, NULL)) AS contract_count,
    COUNTIF(obligation_amount > 0) AS displayed_action_count,
    COUNT(*) AS total_action_count,
    ROUND(SUM(IF(obligation_amount > 0, obligation_amount, 0)), 2) AS displayed_obligated,
    MAX(action_date) AS source_as_of
  FROM scoped GROUP BY recipient_uei
),
ranked AS (
  SELECT recipient_uei,
    ROW_NUMBER() OVER (PARTITION BY recipient_uei ORDER BY action_date DESC) AS rn,
    award_id, piid, awarding_agency, awarding_office, naics_code, naics_description,
    description, obligation_amount,
    CAST(action_date AS STRING) AS action_date,
    CAST(pop_start_date AS STRING) AS pop_start_date,
    CAST(pop_end_date AS STRING) AS pop_end_date,
    pop_state, set_aside
  FROM scoped WHERE obligation_amount > 0
)
SELECT r.recipient_uei, DIV(r.rn - 1, ${PAGE_SIZE}) + 1 AS page_number,
  ANY_VALUE(c.contract_count) AS contract_count,
  ANY_VALUE(c.displayed_action_count) AS displayed_action_count,
  ANY_VALUE(c.total_action_count) AS total_action_count,
  ANY_VALUE(c.displayed_obligated) AS displayed_obligated,
  ANY_VALUE(c.source_as_of) AS source_as_of,
  ARRAY_AGG(STRUCT(r.award_id, r.piid, r.awarding_agency, r.awarding_office, r.naics_code,
    r.naics_description, r.description, r.obligation_amount, r.action_date,
    r.pop_start_date, r.pop_end_date, r.pop_state, r.set_aside)
    ORDER BY r.action_date DESC) AS awards
FROM ranked r JOIN counts c ON c.recipient_uei = r.recipient_uei
WHERE r.rn <= ${MAX_ROWS_PER_RECIPIENT}
GROUP BY r.recipient_uei, page_number
`;

export interface ValidationResult {
  ok: boolean;
  failures: string[];
  recipients: number;
  pages: number;
  rows: number;
}

/**
 * Step 5. Validate a built generation before it can be promoted.
 * Every check is a reason to REFUSE, not a warning to log and continue.
 */
export async function validateGeneration(version: string): Promise<ValidationResult> {
  const supa = db();
  const failures: string[] = [];

  // Uses readAllPages, which PROVES exhaustion via a short final page. The
  // previous version used `.limit(50000)`, which LOOKS bounded but PostgREST
  // silently caps at 1,000 — so the validator inspected 1,000 of 23,492 pages
  // and reported "only 876 recipients", refusing a valid build (2026-08-25).
  const read = await readAllPages<{
    recipient_uei: string; page_number: number; row_count: number;
    contract_count: number; displayed_action_count: number; total_action_count: number;
    payload_checksum: string | null; source_as_of: string | null;
  }>(() =>
    supa
      .from('awards_serving_pages')
      .select('recipient_uei, page_number, row_count, contract_count, displayed_action_count, total_action_count, payload_checksum, source_as_of')
      .eq('data_version', version)
      .eq('lifecycle', 'staging')
      .order('recipient_uei', { ascending: true }) as never,
  );

  if (read.error) {
    return { ok: false, failures: [`read failed: ${read.error}`], recipients: 0, pages: 0, rows: 0 };
  }
  // A validator MUST NOT judge a partial set. Unproven exhaustion is a refusal,
  // not a smaller dataset.
  if (!read.exhausted) {
    return {
      ok: false,
      failures: ['could not prove the staging read was complete — refusing to validate a partial set'],
      recipients: 0, pages: 0, rows: 0,
    };
  }
  const rows = read.rows;

  const recipients = new Set(rows.map((r) => r.recipient_uei)).size;
  const totalRows = rows.reduce((a, r) => a + (r.row_count ?? 0), 0);

  if (rows.length === 0) failures.push('no staging rows');
  if (rows.some((r) => (r.row_count ?? 0) === 0)) failures.push('empty pages written');
  if (rows.some((r) => !r.payload_checksum)) failures.push('missing checksums');
  if (rows.some((r) => (r.contract_count ?? 0) > (r.displayed_action_count ?? 0)))
    failures.push('contract_count exceeds displayed_action_count');
  if (rows.some((r) => (r.displayed_action_count ?? 0) > (r.total_action_count ?? 0)))
    failures.push('displayed_action_count exceeds total_action_count');
  if (rows.some((r) => (r.page_number ?? 0) > MAX_PAGES)) failures.push('page beyond MAX_PAGES');
  // source_as_of is a property of each RECIPIENT's records, not a generation-wide
  // constant — a healthy build legitimately holds ~970 distinct dates. Requiring
  // one value failed every real build. Check what actually matters: present,
  // plausible, and not from the future.
  const missingSource = rows.filter((r) => !r.source_as_of).length;
  if (missingSource > 0) failures.push(`${missingSource} row(s) missing source_as_of`);
  const today = new Date().toISOString().slice(0, 10);
  const future = rows.filter((r) => r.source_as_of && r.source_as_of > today).length;
  if (future > 0) failures.push(`${future} row(s) have a source_as_of in the future`);
  const ancient = rows.filter((r) => r.source_as_of && r.source_as_of < '2000-01-01').length;
  if (ancient > 0) failures.push(`${ancient} row(s) have an implausible source_as_of`);

  if (recipients < TOLERANCE.minRecipients)
    failures.push(`only ${recipients} recipients (min ${TOLERANCE.minRecipients})`);

  return { ok: failures.length === 0, failures, recipients, pages: rows.length, rows: totalRows };
}

/**
 * Step 6. Plausibility. Validation proves a build is internally coherent;
 * this asks whether it is a believable SUCCESSOR to what is live. A build that
 * halves the corpus can be perfectly valid and still catastrophic to promote.
 */
export async function checkPlausibility(next: { recipients: number; pages: number }): Promise<{ ok: boolean; reason?: string }> {
  const supa = db();
  const { count: livePages } = await supa
    .from('awards_serving_pages')
    .select('id', { count: 'exact', head: true })
    .eq('lifecycle', 'live')
    .eq('data_version', DATA_VERSION);
  if (!livePages) return { ok: true }; // nothing to compare against

  const drift = Math.abs(next.pages - livePages) / livePages * 100;
  if (drift > TOLERANCE.pagesPct) {
    return { ok: false, reason: `page count moved ${drift.toFixed(1)}% (${livePages} → ${next.pages}), tolerance ${TOLERANCE.pagesPct}%` };
  }
  return { ok: true };
}

export async function alert(subject: string, html: string): Promise<void> {
  try {
    await sendOpsAlert({ subject, html });
  } catch (e) {
    console.error('[awards-refresh] alert failed:', e);
  }
}

export { db as refreshDb, createHash, LOCK_KEY, LOCK_TTL_SECONDS };
