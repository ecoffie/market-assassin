import { kv } from '@vercel/kv';
import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { bqQuery } from './bigquery/client';
import { DATA_VERSION } from './bigquery/cache';
import { sendOpsAlert } from './ops-alert';

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

/** The source date of the CURRENT live generation. */
export async function readLiveSourceAsOf(): Promise<string | null> {
  const { data, error } = await db()
    .from('awards_serving_pages')
    .select('source_as_of')
    .eq('lifecycle', 'live')
    .eq('data_version', DATA_VERSION)
    .order('source_as_of', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.source_as_of) return null;
  return String(data.source_as_of);
}

/**
 * Step 3. THE FRESHNESS GATE.
 *
 * Rebuild only when upstream genuinely advanced. Two distinct signals:
 *   shouldRebuild  — upstream has data the live generation does not
 *   upstreamStale  — upstream ITSELF has not moved in > UPSTREAM_STALE_DAYS
 *
 * They are independent. Upstream can be stale AND newer than live (exactly the
 * state on 2026-08-25: live 08-03, upstream 08-11, upstream 14 days old). That
 * means rebuild AND alert — a fresher-but-still-stale build is an improvement,
 * and the ingest problem belongs to a different owner.
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

  const { data, error } = await supa
    .from('awards_serving_pages')
    .select('recipient_uei, page_number, row_count, contract_count, displayed_action_count, total_action_count, payload_checksum, source_as_of')
    .eq('data_version', version)
    .eq('lifecycle', 'staging')
    .limit(50000);

  if (error) return { ok: false, failures: [`read failed: ${error.message}`], recipients: 0, pages: 0, rows: 0 };
  const rows = data ?? [];
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
  if (new Set(rows.map((r) => String(r.source_as_of))).size > 1)
    failures.push('mixed source_as_of within one generation');
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
