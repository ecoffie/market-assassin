/**
 * FCO CENSUS — read-only enumeration of the GSA Acquisition Gateway "Forecast of Contracting
 * Opportunities" upstream source.
 *
 * ⚠️ THIS MODULE MUST NEVER WRITE `agency_forecasts`. It is census/watch infrastructure only.
 * The canonical ingest representation stays the supported CSV export (`gsa_gateway_csv`), because
 * the API is materially poorer on two fields we depend on (measured 2026-09-14 over 1,000 matched
 * rows and the full 9,225-row corpus):
 *   • the API schema has **no POC field at all** — the CSV carries `poc_email` on 100% of held rows
 *   • the API's `field_funding_organization` (bureau) is populated on only 1,932/9,225 (21%);
 *     the CSV carries bureau on 100%, and bureau is the anchor for the shipped FAS/PBS subagency
 *     identities. Switching to the API would silently break child identity.
 *
 * WHY THIS EXISTS: `scripts/import-forecasts-live.js` (the retired duplicate API writer) enumerates
 * with `for (let start = 0; start < 320; start += POOL)` at `range=25` — a hard ceiling of 8,000
 * rows. Upstream is 9,225 and growing. That ceiling is why **Department of State joined FCO on
 * 2026-08-19/20 and nothing noticed for three and a half weeks.** A monitoring blind spot that
 * cannot see the tail of the source cannot detect the source growing.
 */

const FCO_BASE = 'https://ag-dashboard.acquisitiongateway.gov/api/v3.0/resources/forecast';
/** range=25 is the only page size that paginates cleanly — larger ranges duplicate/gap. */
const PAGE_SIZE = 25;
/** Generous ceiling ONLY as a runaway guard; termination is by exhaustion, never by this. */
const MAX_PAGES = 2000;

export interface FcoRow {
  nid: string;
  listingId: string;
  department: string;
  organization: string;
  title: string;
  naics: string | null;
  awardFy: string | null;
  status: string | null;
  changed: string | null;
}

export interface FcoCensus {
  /** `listing.total` as reported by the source — the authority we reconcile against. */
  reportedTotal: number;
  /** Rows we actually enumerated and de-duplicated by nid. */
  uniqueRows: number;
  /** Distinct source-native listing ids. */
  uniqueListingIds: number;
  duplicateListingIds: number;
  departments: Array<{ department: string; rows: number; listingIds: number }>;
  /** MAX(changed) — the SOURCE's own advance marker. Never a Mindy timestamp. */
  maxChanged: string | null;
  /** Deterministic fingerprint of the whole corpus (id+changed), for movement detection. */
  fingerprint: string;
  pagesFetched: number;
  pagesFailed: number;
  /** TRUE only when enumeration is provably complete. A partial census is NOT a success. */
  complete: boolean;
  incompleteReason?: string;
  /**
   * Next page index to request. Null when the census finished or truly exhausted.
   * A later run passes this as startPage. A partial read is degraded, not complete.
   */
  resumePage: number | null;
  /** True when we read the source but did not finish. Never means unreachable. */
  degraded: boolean;
  /**
   * Cumulative progress to persist and pass back as `progress` on the next run. Null when the
   * census completed, or when it ended without a cursor (exhausted short of the total): the next
   * run then starts a NEW census at page 0. Never a stale late-page cursor.
   */
  progress?: FcoCensusProgress | null;
  /** How many runs this census spans (1 = enumerated within this run alone). */
  runsSpanned?: number;
  /** When the census this result belongs to started (first page of page 0's run). */
  censusStartedAt?: string;
  /** Why a carried census was abandoned and restarted at page 0 during this run. */
  restartReason?: string;
}

/**
 * Cross-run census progress, stored as `census_progress` inside the instance row's
 * `upstream_fingerprint` JSON.
 *
 * WHY: the full source is ~540 pages at ~3.5 s each (~31 min) against a 240 s run budget
 * (~65 pages). A resumed run used to start with an EMPTY seen set and needed seen >= total on its
 * own, so it could never complete; and a run that reached the end incomplete left the old cursor
 * in place, so every run restarted at the same late page. Progress is therefore carried as
 * AGGREGATES (not the row set: 13K nids would bloat a row every forecast health read selects).
 *
 * ⚠️ Cross-run uniqueness is exact only WITHIN a run and at the run boundary (`last_page_key`
 * skips the live API's repeated page index). A row that shifts pages between runs (offset drift)
 * can be counted twice or missed. A census whose reported total moves materially is restarted.
 */
export interface FcoCensusProgress {
  v: 1;
  census_started_at: string;
  /** reportedTotal when the census started — a material move restarts the census. */
  start_total: number;
  next_page: number;
  rows_seen_so_far: number;
  listing_ids_seen: number;
  duplicate_listing_ids: number;
  departments: Record<string, { rows: number; listing_ids: number }>;
  max_changed: string | null;
  /** Order-independent running digest: sum and xor of per-row FNV-1a(listingId:changed). */
  digest_sum: number;
  digest_xor: number;
  /** nid key of the last page read, so a repeated page index across the boundary is skipped. */
  last_page_key: string;
  runs: number;
  pages_fetched: number;
}

/** A reported-total move at or beyond max(ABS, PCT × start) abandons the census and starts again. */
export const CENSUS_RESTART_ABS = 50;
export const CENSUS_RESTART_PCT = 0.005;

export function totalMovedMaterially(startTotal: number, nowTotal: number): boolean {
  if (!(startTotal > 0) || !(nowTotal > 0)) return false;
  return Math.abs(nowTotal - startTotal) >= Math.max(CENSUS_RESTART_ABS, CENSUS_RESTART_PCT * startTotal);
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Validate stored progress. Anything malformed (including the legacy `{resumePage, partial}`) is null. */
export function parseCensusProgress(raw: unknown): FcoCensusProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (p.v !== 1 || typeof p.census_started_at !== 'string') return null;
  for (const k of ['start_total', 'next_page', 'rows_seen_so_far', 'listing_ids_seen', 'duplicate_listing_ids',
    'digest_sum', 'digest_xor', 'runs', 'pages_fetched'] as const) {
    if (!isCount(p[k])) return null;
  }
  if (!p.departments || typeof p.departments !== 'object' || Array.isArray(p.departments)) return null;
  const departments: FcoCensusProgress['departments'] = {};
  for (const [d, v] of Object.entries(p.departments as Record<string, unknown>)) {
    const o = v as { rows?: unknown; listing_ids?: unknown } | null;
    if (!o || !isCount(o.rows) || !isCount(o.listing_ids)) return null;
    departments[d] = { rows: o.rows, listing_ids: o.listing_ids };
  }
  return {
    v: 1,
    census_started_at: p.census_started_at,
    start_total: p.start_total as number,
    next_page: p.next_page as number,
    rows_seen_so_far: p.rows_seen_so_far as number,
    listing_ids_seen: p.listing_ids_seen as number,
    duplicate_listing_ids: p.duplicate_listing_ids as number,
    departments,
    max_changed: typeof p.max_changed === 'string' ? p.max_changed : null,
    digest_sum: p.digest_sum as number,
    digest_xor: p.digest_xor as number,
    last_page_key: typeof p.last_page_key === 'string' ? p.last_page_key : '',
    runs: p.runs as number,
    pages_fetched: p.pages_fetched as number,
  };
}

const strip = (s: unknown): string =>
  String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** `changed` arrives as `<time datetime="2026-09-11T…">09/11/2026</time>` — take the ISO attribute. */
export function parseChanged(raw: unknown): string | null {
  const s = String(raw ?? '');
  const iso = s.match(/datetime="([^"]+)"/);
  if (iso) return iso[1];
  const us = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return us ? `${us[3]}-${us[1]}-${us[2]}` : null;
}

export function mapFcoRow(render: Record<string, unknown>): FcoRow {
  return {
    nid: String(render.nid ?? ''),
    listingId: strip(render.field_source_listing_id),
    department: strip(render.field_result_id) || '(none)',
    organization: strip(render.field_funding_organization),
    title: strip(render.title),
    naics: (strip(render.field_naics_code).match(/(\d{6})/) || [])[1] ?? null,
    awardFy: strip(render.field_estimated_award_fy) || null,
    status: strip(render.field_award_status) || null,
    changed: parseChanged(render.changed),
  };
}

/**
 * Normalise a source-native listing id for RECONCILIATION ONLY.
 *
 * ⚠️ The CSV renders ids with hyphens (`FY26-WBSCM-000835`), the API with underscores
 * (`FY26_WBSCM_000835`). A naive join reported USDA as 0-of-2,519 matched when the true answer is
 * 2,519-of-2,519. **Never persist the API form as an `external_id`** — the canonical external_id
 * stays the CSV form (`GW-L:<csv id>`). This function exists to compare, not to store.
 */
export function normalizeListingId(id: unknown): string {
  return String(id ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** FNV-1a over sorted `id:changed` pairs — stable, order-independent, cheap. */
export function fingerprintRows(rows: FcoRow[]): string {
  const parts = rows.map((r) => `${r.listingId}:${r.changed ?? ''}`).sort();
  let h = 0x811c9dc5;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) { h ^= p.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    h ^= 0x2c; h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + ':' + parts.length;
}

/** FNV-1a of one `id:changed` pair — the unit of the combinable cross-run digest. */
function rowHash(r: FcoRow): number {
  const p = `${r.listingId}:${r.changed ?? ''}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < p.length; i++) { h ^= p.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Enumerate the ENTIRE FCO source. Terminates by EXHAUSTION (no new nids / reported total reached),
 * never by a page-number ceiling.
 *
 * A failed page is NOT an empty page: a fetch error or a non-2xx marks the census INCOMPLETE rather
 * than silently shortening it. That distinction is the whole point — "succeeded while seeing less
 * than the source" is the failure shape that hid State.
 *
 * RESUMABLE ACROSS RUNS: pass the previous run's `progress` and the census continues from its
 * `next_page` with its cumulative coverage. It completes when cumulative coverage reaches the
 * source's reported total. A carried census that reaches the end of the source short of the total,
 * or whose reported total moved materially, is abandoned and a NEW census starts at page 0 in the
 * same run — never a stale late-page cursor.
 */
export async function runFcoCensus(
  opts: {
    fetchImpl?: FetchLike;
    pageDelayMs?: number;
    concurrency?: number;
    budgetMs?: number;
    /**
     * Legacy single-run resume point, without cumulative progress. Kept for API compatibility;
     * `progress` wins when both are given. Page 2 of the live API repeats page 1; dedupe handles that.
     */
    startPage?: number;
    /** Cumulative progress from the previous run (`FcoCensus.progress`). */
    progress?: FcoCensusProgress | null;
    /** Base delay for 429/503/network retries. Tests pass 0. */
    retryBaseMs?: number;
    now?: () => Date;
  } = {},
): Promise<FcoCensus> {
  const doFetch: FetchLike = opts.fetchImpl ?? ((url) => fetch(url) as unknown as ReturnType<FetchLike>);
  const delay = opts.pageDelayMs ?? 0;
  const retryBaseMs = opts.retryBaseMs ?? 1_000;
  const nowIso = () => (opts.now ? opts.now() : new Date()).toISOString();
  // Default pool is 1. Measured 2026-11-19: a pool of 3 from this network 503'd after page 2.
  // A sequential walk with backoff finishes degraded and resumable instead of looking dead.
  const pool = Math.max(1, Math.min(opts.concurrency ?? 1, 4));
  // SOFT WALL-CLOCK BUDGET. Measured 2026-09-14: a full 372-page census takes ~215s at pool 6,
  // against a 300s cron ceiling. Rather than be KILLED mid-run (which looks like nothing happened),
  // stop at the budget and report INCOMPLETE — the census then resumes from `progress` next run.
  const budgetMs = opts.budgetMs ?? 240_000;
  const startedAt = Date.now();
  const byNid = new Map<string, FcoRow>();
  let reportedTotal = 0;
  let pagesFetched = 0;
  /** Pages read for the census this result belongs to (excludes pages discarded by a restart). */
  let censusPagesThisRun = 0;
  let pagesFailed = 0;
  let duplicatePages = 0;
  let failure: string | undefined;
  let resumePage: number | null = null;
  let exhausted = false;

  let carry: FcoCensusProgress | null = opts.progress ? parseCensusProgress(opts.progress) : null;
  let censusStartedAt = carry?.census_started_at ?? nowIso();
  let startTotal = carry?.start_total ?? 0;
  let totalChecked = false;
  let restartReason: string | undefined;
  const carried = () => carry?.rows_seen_so_far ?? 0;

  type FcoPayload = { listing?: { total?: number | string; data?: Record<string, { render?: Record<string, unknown> }> | Array<{ render?: Record<string, unknown> }> } };
  const fetchPage = async (page: number): Promise<FcoPayload | null> => {
    // 503/429: back off and retry THIS page. A failed page is not an empty page and
    // does not make the source unreachable if an earlier page was read.
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await doFetch(`${FCO_BASE}?range=${PAGE_SIZE}&page=${page}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as FcoPayload;
      } catch {
        if (attempt === 5) return null;
        const wait = retryBaseMs * 2 ** attempt;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
    }
    return null;
  };

  const nidKey = (payload: FcoPayload): string => {
    const data = payload.listing?.data;
    const values = Array.isArray(data) ? data : Object.values(data ?? {});
    return values.map((v) => String((v as { nid?: unknown; render?: { nid?: unknown } }).nid
      ?? (v as { render?: { nid?: unknown } }).render?.nid ?? '')).join(',');
  };

  let page = carry ? carry.next_page : Math.max(0, opts.startPage ?? 0);
  let previousKey = carry?.last_page_key ?? '';

  /** Abandon the carried census and begin a new one at page 0, inside this run. At most once. */
  const restart = (reason: string) => {
    carry = null;
    byNid.clear();
    page = 0;
    previousKey = '';
    duplicatePages = 0;
    censusPagesThisRun = 0;
    censusStartedAt = nowIso();
    startTotal = reportedTotal;
    restartReason = reason;
  };

  while (page < MAX_PAGES) {
    if (Date.now() - startedAt > budgetMs) {
      failure = `soft time budget ${budgetMs}ms exceeded after ${carried() + byNid.size} rows; resume at page ${page}`;
      resumePage = page;
      break;
    }
    const batchPages = Array.from({ length: pool }, (_, k) => page + k).filter((p) => p < MAX_PAGES);
    const batch = await Promise.all(batchPages.map((p) => fetchPage(p)));
    let stop = false;
    let restarted = false;
    for (let i = 0; i < batch.length; i++) {
      const payload = batch[i];
      const pageNo = batchPages[i];
      if (!payload?.listing) {
        pagesFailed++;
        failure = `page ${pageNo} unreadable after backoff`;
        resumePage = pageNo;
        stop = true;
        break;
      }
      pagesFetched++;
      censusPagesThisRun++;
      // ⚠️ `listing.total` arrives as a STRING ("9225"), not a number. A `typeof === 'number'`
      // guard silently left reportedTotal at 0, which made EVERY census report itself incomplete —
      // the census that exists to detect a source growing could not read the source's own size.
      const rawTotal = Number(payload.listing.total);
      if (Number.isFinite(rawTotal) && rawTotal > 0) reportedTotal = rawTotal;
      if (!totalChecked && reportedTotal > 0) {
        totalChecked = true;
        if (!(startTotal > 0)) startTotal = reportedTotal;
        else if (carry && totalMovedMaterially(startTotal, reportedTotal)) {
          restart(`reported total moved ${startTotal} → ${reportedTotal} mid-census`);
          restarted = true;
          break;
        }
      }

      const key = nidKey(payload);
      const values = Array.isArray(payload.listing.data)
        ? payload.listing.data
        : Object.values(payload.listing.data ?? {});
      if (values.length === 0) {
        if (carry) {
          // A carried census reached the end of the source without covering the total. Its
          // coverage cannot complete from here: start a NEW census now rather than keep a cursor.
          restart(`reached end of source at page ${pageNo} with ${carried() + byNid.size} of ${reportedTotal}`);
          restarted = true;
          break;
        }
        exhausted = true;
        stop = true;
        break;
      }
      // Measured 2026-11-19 with range=5 and range=25: page=2 returns the same nids as page=1.
      // That is a repeated index, not the end of the source. Do not stop.
      if (key && key === previousKey) {
        duplicatePages++;
        previousKey = key;
        continue;
      }
      previousKey = key;
      // ⚠️ `listing.data` is keyed by POSITION (0..24) on every page, NOT by record id. De-duping on
      // that key collapses the entire corpus to 25 rows — measured. Always key on the row's own nid.
      for (const v of values) {
        const row = mapFcoRow((v as { render?: Record<string, unknown> })?.render ?? {});
        if (!row.nid) continue;
        if (!byNid.has(row.nid)) byNid.set(row.nid, row);
      }
      if (reportedTotal > 0 && carried() + byNid.size >= reportedTotal) {
        exhausted = true;
        stop = true;
        break;
      }
    }
    if (stop) break;
    if (!restarted) page += pool;
    if (delay) await new Promise((r) => setTimeout(r, delay));
  }

  const rows = [...byNid.values()];
  const ids = rows.map((r) => r.listingId).filter(Boolean);
  const uniqueIds = new Set(ids);

  // Cumulative department roster: carried aggregates + this run's rows.
  const depAgg = new Map<string, { rows: number; listingIds: number }>();
  for (const [d, v] of Object.entries(carry?.departments ?? {})) depAgg.set(d, { rows: v.rows, listingIds: v.listing_ids });
  const depMap = new Map<string, { rows: number; ids: Set<string> }>();
  for (const r of rows) {
    let d = depMap.get(r.department);
    if (!d) depMap.set(r.department, (d = { rows: 0, ids: new Set() }));
    d.rows++;
    if (r.listingId) d.ids.add(r.listingId);
  }
  for (const [d, v] of depMap) {
    const a = depAgg.get(d) ?? { rows: 0, listingIds: 0 };
    depAgg.set(d, { rows: a.rows + v.rows, listingIds: a.listingIds + v.ids.size });
  }

  const changedList = rows.map((r) => r.changed).filter((x): x is string => !!x).sort();
  const runMaxChanged = changedList.length ? changedList[changedList.length - 1] : null;
  const maxChanged = [runMaxChanged, carry?.max_changed ?? null].filter((x): x is string => !!x).sort().pop() ?? null;

  let digestSum = carry?.digest_sum ?? 0;
  let digestXor = carry?.digest_xor ?? 0;
  for (const r of rows) {
    const h = rowHash(r);
    digestSum = (digestSum + h) >>> 0;
    digestXor = (digestXor ^ h) >>> 0;
  }

  const cumulativeRows = carried() + byNid.size;
  const runsSpanned = (carry?.runs ?? 0) + 1;

  // Complete ONLY when every page read cleanly AND cumulative coverage holds at least the source's
  // own reported total. A 503 mid-walk is degraded (resumePage set), not complete, not unreachable.
  const complete = pagesFailed === 0 && reportedTotal > 0 && cumulativeRows >= reportedTotal && resumePage == null;
  if (exhausted) resumePage = null;
  if (!complete && !failure) {
    failure = reportedTotal === 0 ? 'source reported no total'
      : `enumerated ${cumulativeRows} of reported ${reportedTotal}`
        + (carry ? ` across ${runsSpanned} runs since ${censusStartedAt}` : '')
        + (duplicatePages ? ` (${duplicatePages} repeated page index${duplicatePages === 1 ? '' : 'es'} skipped)` : '');
  }
  if (!complete && restartReason) failure = `${failure} [new census: ${restartReason}]`;

  const progress: FcoCensusProgress | null = !complete && resumePage != null ? {
    v: 1,
    census_started_at: censusStartedAt,
    start_total: startTotal,
    next_page: resumePage,
    rows_seen_so_far: cumulativeRows,
    listing_ids_seen: (carry?.listing_ids_seen ?? 0) + uniqueIds.size,
    duplicate_listing_ids: (carry?.duplicate_listing_ids ?? 0) + (ids.length - uniqueIds.size),
    departments: Object.fromEntries([...depAgg].map(([d, v]) => [d, { rows: v.rows, listing_ids: v.listingIds }])),
    max_changed: maxChanged,
    digest_sum: digestSum,
    digest_xor: digestXor,
    last_page_key: previousKey,
    runs: runsSpanned,
    pages_fetched: (carry?.pages_fetched ?? 0) + censusPagesThisRun,
  } : null;

  return {
    reportedTotal,
    uniqueRows: cumulativeRows,
    uniqueListingIds: (carry?.listing_ids_seen ?? 0) + uniqueIds.size,
    duplicateListingIds: (carry?.duplicate_listing_ids ?? 0) + (ids.length - uniqueIds.size),
    departments: [...depAgg.entries()]
      .map(([department, d]) => ({ department, rows: d.rows, listingIds: d.listingIds }))
      .sort((a, b) => b.rows - a.rows),
    maxChanged,
    // A single-run census keeps the exact sorted fingerprint. A cross-run census can only carry an
    // order-independent running digest, so it is marked `cum:` and is not comparable to the other.
    fingerprint: carry
      ? `cum:${digestSum.toString(16).padStart(8, '0')}${digestXor.toString(16).padStart(8, '0')}:${cumulativeRows}`
      : fingerprintRows(rows),
    pagesFetched,
    pagesFailed,
    complete,
    incompleteReason: complete ? undefined : failure,
    resumePage: complete ? null : resumePage,
    degraded: !complete && pagesFetched > 0,
    progress,
    runsSpanned,
    censusStartedAt,
    restartReason,
  };
}
