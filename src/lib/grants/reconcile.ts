/**
 * Grants cache reconcile — evidence-gated staleness for grants_cache (2026-09-26).
 *
 * The nightly ingest only upserts, so a grant Grants.gov stops listing stayed "actionable" on the map
 * forever (measured 2026-09-26: 103 such rows). This module separates two facts and never conflates them:
 *
 *   ABSENCE      (absent_since)  — OUR snapshot evidence: not listed by a PROVEN-COMPLETE ingest run.
 *   CONFIRMATION (source_status) — THE SOURCE's statement from the official fetchOpportunity API.
 *
 * Hard rules (Eric, 2026-09-26):
 *   - Reconcile ONLY after a demonstrably complete run. A degraded page, a fetch error, a capped fetch,
 *     a hitCount of 0, a hitCount that changes mid-run, or unique-fetched ≠ hitCount for ANY status →
 *     nothing is marked absent in that run (see runIsComplete for why it is run-level, not per-status).
 *   - Records are preserved: nothing is deleted, and a row seen again is restored (absent_since cleared).
 *   - Absent ≠ closed. Only a well-formed source answer sets source_status; an API error leaves it NULL.
 *   - Safe without the migration: missing columns/table → old upsert-only behaviour, reconcile skipped
 *     with a reason, no read path filters on a column that does not exist.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/* ── completeness ──────────────────────────────────────────────────────────────────────── */

export interface StatusFetchEvidence {
  status: string;
  /** Upstream hitCount values reported by each page of this status (should all be equal). */
  hitCounts: number[];
  pages: number;
  fetchedUnique: number;
  degraded: boolean;
  error: string | null;
  /** The per-status safety cap was reached before the listing was exhausted. */
  capped: boolean;
}

export interface StatusCompleteness {
  expected: number | null;
  fetchedUnique: number;
  pages: number;
  degraded: boolean;
  error: string | null;
  complete: boolean;
  reason: string | null;
}

/**
 * A status is complete ONLY when every page answered, the listing was exhausted, the upstream hitCount
 * was reported consistently and is > 0, and we hold exactly that many unique grants. Tolerance: EXACT.
 * (A silent-empty Grants.gov answer is hitCount 0 with no error — indistinguishable from a real
 * outage, so 0 is never "complete".)
 */
export function statusCompleteness(e: StatusFetchEvidence): StatusCompleteness {
  const distinct = [...new Set(e.hitCounts)];
  const expected = distinct.length === 1 ? distinct[0] : null;
  const base = { expected, fetchedUnique: e.fetchedUnique, pages: e.pages, degraded: e.degraded, error: e.error };
  const fail = (reason: string) => ({ ...base, complete: false, reason });
  if (e.error) return fail(`fetch error: ${e.error}`);
  if (e.degraded) return fail('a page was degraded (upstream error mid-run)');
  if (e.capped) return fail('per-status cap reached before the listing was exhausted');
  if (e.pages === 0 || e.hitCounts.length === 0) return fail('no page answered');
  if (distinct.length !== 1) return fail(`hitCount changed during the run (${distinct.join(' → ')})`);
  if (expected === 0) return fail('upstream hitCount 0 (indistinguishable from a silent-empty answer)');
  if (e.fetchedUnique !== expected) return fail(`unique fetched ${e.fetchedUnique} ≠ upstream hitCount ${expected}`);
  return { ...base, complete: true, reason: null };
}

/**
 * RUN-level completeness. Deliberately not per-status: grants move between statuses (a forecast
 * becomes a posted synopsis — measured: PAR-26-120, cached as forecasted, is live as posted). If the
 * posted fetch were incomplete while forecasted was complete, a forecast that just became posted would
 * be missing from the forecasted listing AND possibly from the partial posted listing — marking it
 * absent would hide a live grant. So one incomplete status blocks reconcile for the whole run.
 */
export function runIsComplete(perStatus: Record<string, StatusCompleteness>): boolean {
  const all = Object.values(perStatus);
  return all.length > 0 && all.every((s) => s.complete);
}

/* ── schema probe (migration-missing safety) ───────────────────────────────────────────── */

export interface ReconcileSchema {
  columns: boolean; // grants_cache.last_seen_at / absent_since / source_status / source_checked_at
  runsTable: boolean; // grants_ingest_runs
}

/** Postgres undefined_column / undefined_table, or PostgREST's schema-cache miss. */
export function isMissingSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === '42703' || err.code === '42P01' || err.code === 'PGRST204' || err.code === 'PGRST205') return true;
  return /does not exist|could not find the .* (column|table)|schema cache/i.test(err.message || '');
}

export async function probeReconcileSchema(db: SupabaseClient): Promise<ReconcileSchema> {
  const cols = await db.from('grants_cache').select('opp_number, last_seen_at, absent_since, source_status, source_checked_at, superseded_by').limit(1);
  const runs = await db.from('grants_ingest_runs').select('id').limit(1);
  const columns = !cols.error;
  const runsTable = !runs.error;
  if (cols.error && !isMissingSchemaError(cols.error)) console.error('[grants:reconcile] schema probe error:', cols.error.message);
  if (runs.error && !isMissingSchemaError(runs.error)) console.error('[grants:reconcile] runs-table probe error:', runs.error.message);
  return { columns, runsTable };
}

/* ── read-path visibility ──────────────────────────────────────────────────────────────── */

/**
 * VISIBILITY RULE (Eric, 2026-09-26 — replaces "hide on absence"). A complete listing proves the
 * listing was fully RETRIEVED, not that it contains every live grant (measured: 17 of 103 "absent"
 * rows were live, each re-listed under a NEW funding-opportunity number). So:
 *
 *   listed in the latest snapshot                        → visible
 *   absent, not yet looked up                            → VISIBLE, labelled absent/unverified
 *   absent, official lookup says posted / forecast       → visible (confirmed live)
 *   absent, lookup failed / timed out (source_status NULL)→ VISIBLE, uncertainty retained
 *   absent, lookup says not_found (ambiguous)            → VISIBLE, labelled ambiguous — never "closed"
 *   absent, lookup says closed / archived                → HIDDEN from actionable results (record kept)
 *   superseded_by set — the SAME Grants.gov opportunity  → HIDDEN as a duplicate: the grant stays
 *     id is listed in the complete run under a new number   visible exactly once via its current row
 *
 * Hidden rows are PRESERVED, never deleted.
 */
export const GRANTS_HIDDEN_SOURCE_STATES: readonly SourceStatus[] = ['closed', 'archived'];
export const GRANTS_VISIBLE_OR = 'absent_since.is.null,source_status.is.null,source_status.in.(posted,forecast,not_found)';

/** Apply the visibility rule to a grants_cache query (AND-ed with the caller's own filters). */
export function applyGrantsVisibility<Q extends { is(c: string, v: null): Q; or(e: string): Q }>(q: Q): Q {
  return q.is('superseded_by', null).or(GRANTS_VISIBLE_OR);
}

export type GrantVerification = 'listed' | 'absent_unverified' | 'absent_confirmed_live' | 'absent_not_found_ambiguous';
/** What a visible row can honestly say about itself. */
export function grantVerification(row: { absent_since?: unknown; source_status?: unknown }): GrantVerification {
  if (!row.absent_since) return 'listed';
  if (row.source_status === 'posted' || row.source_status === 'forecast') return 'absent_confirmed_live';
  if (row.source_status === 'not_found') return 'absent_not_found_ambiguous';
  return 'absent_unverified';
}

/** The cached status to present for a visible row: a source confirmation beats the stale cached status. */
export function effectiveGrantStatus(row: { status?: unknown; absent_since?: unknown; source_status?: unknown }): string {
  if (row.absent_since && row.source_status === 'forecast') return 'forecasted';
  if (row.absent_since && row.source_status === 'posted') return 'posted';
  return String(row.status || '');
}

/** Grants.gov opportunity id from a cached detail URL (…/search-results-detail/<id>). The STABLE identity:
 *  the funding-opportunity number changes when a forecast is posted or a notice is reissued. */
/** The SAME predicate as GRANTS_VISIBLE_OR / applyGrantsVisibility, in JS (for reconcile's own checks). */
export function isGrantRowVisible(r: { absent_since?: string | null; source_status?: string | null; superseded_by?: string | null }): boolean {
  if (r.superseded_by) return false;
  if (!r.absent_since || !r.source_status) return true;
  return r.source_status === 'posted' || r.source_status === 'forecast' || r.source_status === 'not_found';
}

export function grantsGovIdFromUrl(url: unknown): string | null {
  const m = String(url ?? '').match(/search-results-detail\/(\d+)\s*$/);
  return m ? m[1] : null;
}

/* ── reconcile (mark absent) ───────────────────────────────────────────────────────────── */

export interface ReconcileResult {
  ran: boolean;
  reason: string | null;
  markedAbsent: number;
  actionableMarkedAbsent: number;
  /** Of markedAbsent: the same Grants.gov id is listed today under a new number (duplicate, hidden). */
  superseded: number;
  /** Same Grants.gov id listed under a new number, but the replacement row was NOT proven present and
   *  visible — so the old row stays VISIBLE as absent/unverified instead of being hidden. By reason. */
  supersedeDeclined?: Record<string, number>;
  restored: number;
}

export interface ReconcileOptions {
  /** Refuse if newly-absent ACTIONABLE rows exceed this fraction of actionable rows present before. */
  breakerFraction?: number;
  /** Manual override of the breaker for a supervised backfill run. Never set by the cron. */
  allowLargeReconcile?: boolean;
  todayIso?: string;
}

type CacheRow = {
  opp_number: string; status: string | null; close_date: string | null; absent_since: string | null; url?: string | null;
  map_lat?: number | null; superseded_by?: string | null; source_status?: string | null;
};

async function readAllCacheRows(db: SupabaseClient): Promise<CacheRow[]> {
  const out: CacheRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('grants_cache')
      .select('opp_number, status, close_date, absent_since, url, map_lat, superseded_by, source_status')
      .order('opp_number', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`grants_cache read failed: ${error.message}`);
    out.push(...((data || []) as CacheRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const isActionable = (r: CacheRow, todayIso: string) =>
  r.status === 'forecasted' || !r.close_date || String(r.close_date).slice(0, 10) >= todayIso;

/**
 * Mark rows not seen by this (complete) run as absent. Caller MUST pass `complete` from
 * runIsComplete — this function refuses on anything else, so a partial run can never hide a grant.
 * `previouslyAbsent` = rows that were absent before this run's upsert (to count restorations).
 */
export async function reconcileAbsentGrants(
  db: SupabaseClient,
  run: {
    complete: boolean; seen: Set<string>; previouslyAbsent: Set<string>; nowIso: string;
    /** Grants.gov opportunity id → the opp_number it is listed under in THIS snapshot. */
    seenIds?: Map<string, string>;
  },
  opts: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const none = (reason: string): ReconcileResult => ({ ran: false, reason, markedAbsent: 0, actionableMarkedAbsent: 0, superseded: 0, restored: 0 });
  if (!run.complete) return none('run not proven complete — nothing marked absent');
  if (run.seen.size === 0) return none('empty snapshot — nothing marked absent');

  const todayIso = opts.todayIso ?? run.nowIso.slice(0, 10);
  const rows = await readAllCacheRows(db);
  const tracked = rows.filter((r) => r.status === 'posted' || r.status === 'forecasted');
  const candidates = tracked.filter((r) => !r.absent_since && !run.seen.has(r.opp_number));
  const actionableBefore = tracked.filter((r) => !r.absent_since && isActionable(r, todayIso)).length;
  const actionableCandidates = candidates.filter((r) => isActionable(r, todayIso)).length;
  const restored = [...run.previouslyAbsent].filter((id) => run.seen.has(id)).length;

  const fraction = opts.breakerFraction ?? 0.2;
  if (!opts.allowLargeReconcile && actionableBefore > 0 && actionableCandidates > fraction * actionableBefore) {
    return {
      ran: false,
      reason: `breaker: ${actionableCandidates} actionable rows would be marked absent (> ${Math.round(fraction * 100)}% of ${actionableBefore}) — refused; needs a supervised run`,
      markedAbsent: 0, actionableMarkedAbsent: 0, superseded: 0, restored,
    };
  }

  // Identity first. A candidate is a duplicate ONLY on authoritative identity: its stored Grants.gov
  // opportunity id (the `id` Grants.gov's own search API returned when we cached it) is listed in THIS
  // snapshot under another number. Titles, number shapes and successor announcements are never used.
  // Then the replacement must be PROVEN present and visible before the old row is hidden — otherwise
  // hiding would delete the grant from view. Anything that fails a check stays absent/unverified (VISIBLE).
  const byNumber = new Map(rows.map((r) => [r.opp_number, r] as const));
  const supersededBy = new Map<string, string>();
  const declined: Record<string, number> = {};
  const decline = (why: string) => { declined[why] = (declined[why] || 0) + 1; };
  for (const r of candidates) {
    const gid = grantsGovIdFromUrl(r.url);
    const current = gid ? run.seenIds?.get(gid) : undefined;
    if (!current || current === r.opp_number) continue;
    const rep = byNumber.get(current);
    if (!rep) { decline('replacement_not_in_cache'); continue; }
    if (grantsGovIdFromUrl(rep.url) !== gid) { decline('replacement_id_mismatch'); continue; }
    if (!isGrantRowVisible(rep)) { decline('replacement_not_visible'); continue; }
    if (!isActionable(rep, todayIso)) { decline('replacement_not_actionable'); continue; }
    if (r.map_lat != null && rep.map_lat == null) { decline('replacement_not_on_map'); continue; }
    supersededBy.set(r.opp_number, current);
  }
  let marked = 0;
  const plain = candidates.map((r) => r.opp_number).filter((id) => !supersededBy.has(id));
  for (let i = 0; i < plain.length; i += 200) {
    const chunk = plain.slice(i, i + 200);
    const { error } = await db
      .from('grants_cache')
      // A fresh absence invalidates any earlier source confirmation — it must be re-confirmed.
      .update({ absent_since: run.nowIso, source_status: null, source_checked_at: null, superseded_by: null })
      .in('opp_number', chunk)
      .is('absent_since', null);
    if (error) throw new Error(`grants_cache mark-absent failed: ${error.message}`);
    marked += chunk.length;
  }
  for (const [stale, current] of supersededBy) {
    const { error } = await db
      .from('grants_cache')
      .update({ absent_since: run.nowIso, source_status: null, source_checked_at: null, superseded_by: current })
      .in('opp_number', [stale])
      .is('absent_since', null);
    if (error) throw new Error(`grants_cache mark-superseded failed: ${error.message}`);
    marked += 1;
  }
  return { ran: true, reason: null, markedAbsent: marked, actionableMarkedAbsent: actionableCandidates, superseded: supersededBy.size, supersedeDeclined: declined, restored };
}

/* ── confirmation against the official source ──────────────────────────────────────────── */

export type SourceStatus = 'posted' | 'forecast' | 'closed' | 'archived' | 'not_found';

const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
/** "Sep 23, 2026 12:00:00 AM EDT" → "2026-09-23" (date only; timezone-free comparison). */
export function grantsGovDate(s: unknown): string | null {
  const m = String(s ?? '').match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/);
  if (!m || !MONTHS[m[1]]) return null;
  return `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, '0')}`;
}

/**
 * Classify a fetchOpportunity answer. Returns null (= stay unconfirmed) for anything that is not a
 * well-formed successful answer — an outage or a malformed body must never mark a grant gone.
 * Measured shapes (2026-09-26): archived synopsis PD-24-110Z (archiveDate past); archived forecast
 * RFA-DK-27-102; live synopsis PAR-26-120 (archiveDate 2030); not found NOAA-…-27967 (errorcode 0, no data.id).
 */
export function classifySourceRecord(httpStatus: number, body: unknown, todayIso: string): SourceStatus | null {
  if (httpStatus !== 200 || !body || typeof body !== 'object') return null;
  const b = body as { errorcode?: unknown; data?: Record<string, unknown> };
  if (b.errorcode !== 0) return null;
  const d = b.data;
  if (!d || typeof d !== 'object') return null;
  if (!d.id) return 'not_found';
  const docType = String(d.docType || '');
  const part = (docType === 'forecast' ? d.forecast : d.synopsis) as Record<string, unknown> | undefined;
  const archive = grantsGovDate(part?.archiveDate);
  if (archive && archive < todayIso) return 'archived';
  if (docType === 'forecast') return 'forecast';
  if (docType !== 'synopsis') return null; // unknown doc type → do not guess
  const response = grantsGovDate(part?.responseDate);
  if (response && response < todayIso) return 'closed';
  return 'posted';
}

export interface ConfirmResult {
  attempted: number;
  confirmed: Partial<Record<SourceStatus, number>>;
  unconfirmed: number;
}

const FETCH_OPPORTUNITY = 'https://api.grants.gov/v1/api/fetchOpportunity';

/** Bounded: confirm up to `limit` absent-and-unconfirmed rows per run against the official API. */
export async function confirmAbsentGrants(
  db: SupabaseClient,
  opts: { limit?: number; fetchImpl?: typeof fetch; nowIso: string; timeoutMs?: number },
): Promise<ConfirmResult> {
  const limit = Math.max(0, opts.limit ?? 40);
  const out: ConfirmResult = { attempted: 0, confirmed: {}, unconfirmed: 0 };
  if (limit === 0) return out;
  const f = opts.fetchImpl ?? fetch;
  const todayIso = opts.nowIso.slice(0, 10);
  const { data, error } = await db
    .from('grants_cache')
    .select('opp_number, url')
    .not('absent_since', 'is', null)
    .is('superseded_by', null) // a renumbered duplicate needs no lookup — its current row is listed
    .is('source_checked_at', null)
    .order('absent_since', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`grants_cache confirm read failed: ${error.message}`);
  for (const r of (data || []) as Array<{ opp_number: string; url: string | null }>) {
    out.attempted++;
    const id = Number(String(r.url || '').match(/(\d+)\s*$/)?.[1]);
    let status: SourceStatus | null = null;
    if (Number.isFinite(id) && id > 0) {
      try {
        const res = await f(FETCH_OPPORTUNITY, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ opportunityId: id }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        });
        const body = await res.json().catch(() => null);
        status = classifySourceRecord(res.status, body, todayIso);
      } catch (e) {
        console.error(`[grants:confirm] ${r.opp_number}: ${(e as Error).message}`);
        status = null; // outage / timeout → stays unconfirmed
      }
    }
    if (!status) { out.unconfirmed++; continue; }
    const { error: upErr } = await db
      .from('grants_cache')
      .update({ source_status: status, source_checked_at: opts.nowIso })
      .eq('opp_number', r.opp_number)
      .not('absent_since', 'is', null);
    if (upErr) { console.error(`[grants:confirm] write failed ${r.opp_number}: ${upErr.message}`); out.unconfirmed++; continue; }
    out.confirmed[status] = (out.confirmed[status] || 0) + 1;
  }
  return out;
}
