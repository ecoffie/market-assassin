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

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Enumerate the ENTIRE FCO source. Terminates by EXHAUSTION (no new nids / reported total reached),
 * never by a page-number ceiling.
 *
 * A failed page is NOT an empty page: a fetch error or a non-2xx marks the census INCOMPLETE rather
 * than silently shortening it. That distinction is the whole point — "succeeded while seeing less
 * than the source" is the failure shape that hid State.
 */
export async function runFcoCensus(
  opts: { fetchImpl?: FetchLike; pageDelayMs?: number; concurrency?: number; budgetMs?: number } = {},
): Promise<FcoCensus> {
  const doFetch: FetchLike = opts.fetchImpl ?? ((url) => fetch(url) as unknown as ReturnType<FetchLike>);
  const delay = opts.pageDelayMs ?? 0;
  // Bounded concurrency. Sequential at 120ms/page took ~7 minutes for 370 pages, which EXCEEDS the
  // 300s cron ceiling — a watcher that always times out never succeeds. A small pool keeps us well
  // inside it without hammering the source. De-dup is on `nid`, so overlapping pages are harmless.
  const pool = Math.max(1, Math.min(opts.concurrency ?? 6, 12));
  // SOFT WALL-CLOCK BUDGET. Measured 2026-09-14: a full 372-page census takes ~215s at pool 6,
  // against a 300s cron ceiling. Rather than be KILLED mid-run (which looks like nothing happened),
  // stop at the budget and report INCOMPLETE — the watcher then alerts on incomplete enumeration
  // instead of silently recording a short census as a success.
  const budgetMs = opts.budgetMs ?? 240_000;
  const startedAt = Date.now();
  const byNid = new Map<string, FcoRow>();
  let reportedTotal = 0;
  let pagesFetched = 0;
  let pagesFailed = 0;
  let consecutiveNoNew = 0;
  let failure: string | undefined;

  type FcoPayload = { listing?: { total?: number | string; data?: Record<string, { render?: Record<string, unknown> }> } };
  const fetchPage = async (page: number): Promise<FcoPayload | null> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await doFetch(`${FCO_BASE}?range=${PAGE_SIZE}&page=${page}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as FcoPayload;
      } catch {
        if (attempt === 2) return null;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    return null;
  };

  for (let start = 0; start < MAX_PAGES; start += pool) {
    const batch = await Promise.all(
      Array.from({ length: pool }, (_, k) => fetchPage(start + k)),
    );
    let added = 0;
    for (const payload of batch) {
      if (!payload?.listing) {
        // A page we could not read. Record it and STOP claiming completeness.
        pagesFailed++;
        failure = `a page in batch starting ${start} was unreadable after 3 attempts`;
        continue;
      }
      pagesFetched++;
      // ⚠️ `listing.total` arrives as a STRING ("9225"), not a number. A `typeof === 'number'`
      // guard silently left reportedTotal at 0, which made EVERY census report itself incomplete —
      // the census that exists to detect a source growing could not read the source's own size.
      const rawTotal = Number(payload.listing.total);
      if (Number.isFinite(rawTotal) && rawTotal > 0) reportedTotal = rawTotal;

      // ⚠️ `listing.data` is keyed by POSITION (0..24) on every page, NOT by record id. De-duping on
      // that key collapses the entire corpus to 25 rows — measured. Always key on the row's own nid.
      for (const v of Object.values(payload.listing.data ?? {})) {
        const row = mapFcoRow((v as { render?: Record<string, unknown> })?.render ?? {});
        if (!row.nid) continue;
        if (!byNid.has(row.nid)) { byNid.set(row.nid, row); added++; }
      }
    }
    if (pagesFailed > 0) break;
    if (Date.now() - startedAt > budgetMs) {
      failure = `soft time budget ${budgetMs}ms exceeded after ${byNid.size} rows`;
      break;
    }
    if (added === 0) {
      consecutiveNoNew++;
      if (consecutiveNoNew >= 1) break;   // a whole batch yielding nothing new = exhausted
    } else consecutiveNoNew = 0;
    if (reportedTotal > 0 && byNid.size >= reportedTotal) break;
    if (delay) await new Promise((r) => setTimeout(r, delay));
  }

  const rows = [...byNid.values()];
  const ids = rows.map((r) => r.listingId).filter(Boolean);
  const uniqueIds = new Set(ids);

  const depMap = new Map<string, { rows: number; ids: Set<string> }>();
  for (const r of rows) {
    let d = depMap.get(r.department);
    if (!d) depMap.set(r.department, (d = { rows: 0, ids: new Set() }));
    d.rows++;
    if (r.listingId) d.ids.add(r.listingId);
  }

  const changedList = rows.map((r) => r.changed).filter((x): x is string => !!x).sort();

  // Complete ONLY when every page read cleanly AND we hold at least the source's own reported total.
  const complete = pagesFailed === 0 && reportedTotal > 0 && byNid.size >= reportedTotal;
  if (!complete && !failure) {
    failure = reportedTotal === 0 ? 'source reported no total'
      : `enumerated ${byNid.size} of reported ${reportedTotal}`;
  }

  return {
    reportedTotal,
    uniqueRows: byNid.size,
    uniqueListingIds: uniqueIds.size,
    duplicateListingIds: ids.length - uniqueIds.size,
    departments: [...depMap.entries()]
      .map(([department, d]) => ({ department, rows: d.rows, listingIds: d.ids.size }))
      .sort((a, b) => b.rows - a.rows),
    maxChanged: changedList.length ? changedList[changedList.length - 1] : null,
    fingerprint: fingerprintRows(rows),
    pagesFetched,
    pagesFailed,
    complete,
    incompleteReason: complete ? undefined : failure,
  };
}
