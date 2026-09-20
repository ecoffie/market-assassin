/**
 * LEGISLATIVE DISCOVERY — two jobs that must never be confused.
 *
 *   A. DISCOVERY  find measures we have never seen, over a BOUNDED, PROVABLE window
 *   B. TRACKING   follow measures we already know, BY IDENTITY, forever
 *
 * ── THE PRODUCTION DEFECT THIS EXISTS TO FIX (2026-09-20) ────────────────────
 * The first collector did both jobs with ONE mechanism: scan the first N pages of
 * /bill/{congress} sorted by updateDate desc. That works only while a measure stays
 * near the top of a rolling "recently updated" feed.
 *
 * Measured on prod: H.R. 8800 sat at feed position 795, but **S. 4784 was at 2948** —
 * outside the 1500-row window — so the production preview returned 5 documents and
 * SILENTLY omitted S. 4784 and S. Rept. 119-127. It reported `pollOk:true`,
 * `collectFailures:0`, `partial:false`, `discoveryState:'introduced'`: a confident,
 * incomplete answer. Two days earlier the same code found it, because it had just
 * been updated. Nothing broke; ~2,900 unrelated bills were updated in between.
 *
 * Raising the page count to 16 is NOT the fix. It buys a few weeks and restores the
 * same silent failure with a larger constant — and the whole point of this workstream
 * is that absence must never masquerade as evidence.
 *
 * ── WHY A WATERMARK MAKES COVERAGE PROVABLE ─────────────────────────────────
 * congress.gov accepts `fromDateTime`, and its `pagination.count` reports the TOTAL
 * matching that filter. So we can ask "how many bills changed since our last
 * successful discovery?" and compare it to how many we actually read. Measured
 * 2026-09-20: 1 day = 2,812 bills; the whole 119th Congress = 18,962. A bounded
 * window is small and answerable; an unbounded one never is.
 *
 * COVERAGE IS THEREFORE A MEASURED FACT, NOT AN ASSUMPTION:
 *   complete   we read every bill the API said changed in the interval
 *   partial    we hit a page/time ceiling first -> the interval is NOT covered, the
 *              watermark does NOT advance, and NO completeness claim is made
 *
 * ⚠️ A ceiling must produce `partial`, never a confident "nothing new". That is the
 * exact lie the production defect told.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  matchesSubject,
  chamberOf,
  congressApiKey,
  NDAA_TITLE_PATTERN,
  LEGISLATIVE_SOURCE_TYPES,
  type BillRef,
} from './legislation';

const API_BASE = 'https://api.congress.gov/v3';
const UA = 'Mindy-Institute (hello@getmindy.ai)';

/**
 * ⚠️ Params are appended verbatim — NOT via URLSearchParams, which encodes the `+`
 * in `updateDate+desc` to `%2B`. congress.gov does not error on that; it silently
 * returns a different ordering. See the guard in legislation.ts.
 */
function url(path: string, params: Record<string, string | number>): string {
  const qs = ['format=json', ...Object.entries(params).map(([k, v]) => `${k}=${v}`)];
  return `${API_BASE}${path}?${qs.join('&')}&api_key=${congressApiKey()}`;
}

async function getJson(u: string, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const res = await fetchImpl(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`congress.gov ${res.status} ${res.statusText}`);
  return (await res.json()) as Record<string, unknown>;
}

// ── A. DISCOVERY ─────────────────────────────────────────────────────────────

/** Why a discovery pass stopped. Only `complete` may advance the watermark. */
export type CoverageStatus = 'complete' | 'partial' | 'source_unavailable';

export interface DiscoveryPass {
  coverage: CoverageStatus;
  pollOk: boolean;
  /** The API's OWN total for this window — the denominator coverage is judged against. */
  reportedTotal: number | null;
  scanned: number;
  pagesRead: number;
  matched: BillRef[];
  /** Advance the cursor to this ONLY when coverage === 'complete'. */
  nextWatermark: string | null;
  windowFrom: string | null;
  error?: string;
}

export interface DiscoverOptions {
  congress: number;
  /** ISO timestamp of the last COMPLETE pass. Null = never discovered (first run). */
  since: string | null;
  pattern?: RegExp;
  maxPages?: number;
  pageSize?: number;
  budgetMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/**
 * Scan the bill feed for NEW measures matching the subject, bounded by a watermark.
 *
 * Completeness is decided by comparing what we read against the API's own
 * `pagination.count` for the same window — never by "we read N pages, so we're done".
 */
export async function discoverSince(opts: DiscoverOptions): Promise<DiscoveryPass> {
  const pattern = opts.pattern ?? NDAA_TITLE_PATTERN;
  const pageSize = opts.pageSize ?? 250;
  const maxPages = opts.maxPages ?? 40;
  const budgetMs = opts.budgetMs ?? 120_000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());
  const started = now().getTime();

  // The watermark is rewound slightly: congress.gov's updateDate has day
  // granularity in the feed, so an exact-boundary query can drop a bill updated in
  // the same second as the previous cursor. Overlap is free (ingest is idempotent);
  // a gap is permanent data loss.
  const from = opts.since ? new Date(new Date(opts.since).getTime() - 36 * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z') : null;

  const matched: BillRef[] = [];
  let scanned = 0;
  let pagesRead = 0;
  let reportedTotal: number | null = null;
  // Stamped BEFORE the scan: anything changed mid-scan is caught next pass via the
  // rewind, but the cursor must never claim coverage of time we had not yet reached.
  const passStartedAt = now().toISOString().replace(/\.\d+Z$/, 'Z');

  for (let page = 0; page < maxPages; page++) {
    if (now().getTime() - started > budgetMs) {
      return {
        coverage: 'partial', pollOk: true, reportedTotal, scanned, pagesRead, matched,
        nextWatermark: null, windowFrom: from,
        error: 'time_budget_exhausted',
      };
    }

    let payload: Record<string, unknown>;
    try {
      payload = await getJson(
        url(`/bill/${opts.congress}`, {
          limit: pageSize,
          offset: page * pageSize,
          sort: 'updateDate+desc',
          ...(from ? { fromDateTime: from } : {}),
        }),
        fetchImpl,
      );
    } catch (e) {
      // ⚠️ NEVER "no new legislation". The watermark does not move.
      return {
        coverage: 'source_unavailable', pollOk: false, reportedTotal, scanned, pagesRead, matched,
        nextWatermark: null, windowFrom: from,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    const pag = (payload.pagination ?? {}) as { count?: number };
    if (typeof pag.count === 'number') reportedTotal = pag.count;

    const bills = (payload.bills ?? []) as Array<Record<string, unknown>>;
    pagesRead++;
    if (!Array.isArray(bills) || bills.length === 0) break;
    scanned += bills.length;

    for (const raw of bills) {
      if (!matchesSubject({ title: raw.title as string }, pattern)) continue;
      matched.push({
        congress: Number(raw.congress) || opts.congress,
        billType: String(raw.type ?? '').toUpperCase(),
        number: String(raw.number ?? ''),
        title: String(raw.title ?? ''),
        updateDate: (raw.updateDate as string) ?? null,
        originChamber: (raw.originChamber as string) ?? null,
      });
    }

    if (bills.length < pageSize) break;          // natural end of the feed
    if (reportedTotal !== null && scanned >= reportedTotal) break;
  }

  // COVERAGE IS MEASURED, NOT ASSUMED. Without the API's own total we cannot prove
  // we saw everything, so we refuse to claim it.
  const covered = reportedTotal !== null && scanned >= reportedTotal;

  return {
    coverage: covered ? 'complete' : 'partial',
    pollOk: true,
    reportedTotal,
    scanned,
    pagesRead,
    matched,
    nextWatermark: covered ? passStartedAt : null,
    windowFrom: from,
    ...(covered ? {} : { error: 'page_ceiling_before_full_coverage' }),
  };
}

// ── B. TRACKING ──────────────────────────────────────────────────────────────

/**
 * Measures already in the corpus, recovered from institute_sources.raw.
 *
 * ⚠️ NO NEW TABLE. `raw` already carries congress/billType/billNumber for every
 * ingested version (that is what the provenance work put there), so the corpus IS
 * the tracking registry. A parallel table would be a second source of truth able to
 * disagree with the evidence it describes.
 */
export async function knownMeasures(
  db: SupabaseClient,
  congress?: number,
): Promise<{ measures: BillRef[]; error?: string }> {
  // ⚠️ PAGED, NOT ONE BIG .limit(). PostgREST hard-caps a response at 1,000 rows, so
  // a .limit(2000) SILENTLY returns 1,000 and the caller cannot tell truncation from
  // a small corpus — the capped-RETURNING lesson. Untracking a measure because its
  // row fell off page one is precisely the failure this module exists to prevent, so
  // we page until the source is exhausted and surface an unfinished read as an ERROR.
  const PAGE = 1000;
  const MAX_PAGES = 20;                       // 20k versions; far beyond any real corpus
  const rows: Array<{ raw: unknown; title: unknown }> = [];
  let exhausted = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await db
      .from('institute_sources')
      // unranged-ok: explicitly paged by .range() below the PostgREST cap.
      .select('raw, title')
      .in('source_type', LEGISLATIVE_SOURCE_TYPES as unknown as string[])
      .order('discovered_at', { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);

    // A read failure is UNKNOWN, never "nothing is tracked" — returning [] here
    // would silently stop tracking every known measure.
    if (error) return { measures: [], error: error.message };

    const batch = (data ?? []) as Array<{ raw: unknown; title: unknown }>;
    rows.push(...batch);
    if (batch.length < PAGE) { exhausted = true; break; }
  }

  if (!exhausted) {
    return { measures: [], error: `corpus_read_incomplete: more than ${MAX_PAGES * PAGE} legislative rows` };
  }

  const seen = new Map<string, BillRef>();
  for (const row of rows) {
    const raw = (row.raw ?? {}) as Record<string, unknown>;
    const c = Number(raw.congress);
    const t = String(raw.billType ?? '').toUpperCase();
    const n = String(raw.billNumber ?? '');
    if (!Number.isFinite(c) || !t || !n) continue;                 // reports w/o a bill
    if (congress !== undefined && c !== congress) continue;
    const key = `${c}-${t}${n}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      congress: c,
      billType: t,
      number: n,
      title: String(row.title ?? ''),
      updateDate: null,
      originChamber: chamberOf(t),
    });
  }
  return { measures: [...seen.values()] };
}

/**
 * Merge discovered + known into one tracking set, de-duplicated by identity.
 *
 * THE INVARIANT: a measure already known is ALWAYS polled, regardless of where it
 * sits in the update feed. S. 4784 at position 2948 is tracked exactly as reliably
 * as H.R. 8800 at 795.
 */
export function mergeMeasures(discovered: BillRef[], known: BillRef[]): BillRef[] {
  const out = new Map<string, BillRef>();
  for (const m of [...known, ...discovered]) {
    const key = `${m.congress}-${m.billType}${m.number}`;
    const prior = out.get(key);
    // Prefer the richer record (discovery carries updateDate/title from the feed).
    if (!prior || (!prior.updateDate && m.updateDate)) out.set(key, m);
  }
  return [...out.values()];
}

// ── CURSOR PERSISTENCE ───────────────────────────────────────────────────────
/**
 * The discovery cursor lives in data_sources.notes beside the clocks, in its own
 * sentinel block. No schema change: same mechanism the GAO and legislation clocks
 * already use.
 *
 * It records the last COMPLETE pass only. A partial pass leaves it untouched, so the
 * next run re-covers the same interval rather than skipping over an unscanned gap.
 */
export interface DiscoveryCursor {
  lastCompleteDiscoveryAt: string;
  congress: number;
  reportedTotal: number | null;
  scanned: number;
}

const START = '[legislation-discovery-cursor:v1]';
const END = '[/legislation-discovery-cursor]';
const PATTERN = /\n?\[legislation-discovery-cursor:v1\]\n([\s\S]*?)\n\[\/legislation-discovery-cursor\]\n?/;

export function encodeDiscoveryCursor(notes: string | null, cursor: DiscoveryCursor): string {
  const human = (notes ?? '').replace(PATTERN, '\n').trim();
  const block = `${START}\n${JSON.stringify(cursor)}\n${END}`;
  return human ? `${human}\n\n${block}` : block;
}

export function decodeDiscoveryCursor(notes: string | null | undefined): DiscoveryCursor | null {
  const m = notes?.match(PATTERN);
  if (!m) return null;
  try {
    const p = JSON.parse(m[1]) as Partial<DiscoveryCursor>;
    return typeof p.lastCompleteDiscoveryAt === 'string'
      && Number.isFinite(Date.parse(p.lastCompleteDiscoveryAt))
      && Number.isFinite(Number(p.congress))
      ? {
          lastCompleteDiscoveryAt: p.lastCompleteDiscoveryAt,
          congress: Number(p.congress),
          reportedTotal: p.reportedTotal ?? null,
          scanned: Number(p.scanned ?? 0),
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * A cursor from a DIFFERENT Congress must not be used as this Congress's watermark.
 *
 * ⚠️ THE NEW-CONGRESS TRANSITION. On 2027-01-03 the 120th convenes and the bill
 * feed resets. Carrying the 119th's cursor forward would ask for "everything changed
 * since last week" inside a corpus that did not exist last week, and the resulting
 * tiny window would look complete while covering nothing. A Congress change forces a
 * FULL first pass — the same path as a first-ever run. No code change, no bill
 * number, no fiscal year.
 */
export function watermarkFor(cursor: DiscoveryCursor | null, congress: number): string | null {
  if (!cursor) return null;
  return cursor.congress === congress ? cursor.lastCompleteDiscoveryAt : null;
}
