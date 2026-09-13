/**
 * NAVY LRAE — revision discovery + safe parse. Phase II, Potato 2D-B.
 *
 * SOURCE MODEL (proven 2026-09-13, not assumed):
 *   Navy publishes ONE ROLLING MULTI-YEAR workbook, not one file per fiscal year.
 *   `Combined LRAE_02.2026.xlsx` contains FY2026 (3,311 rows), FY2027 (612),
 *   FY2028 (189), FY2029 (85), FY2030 (54) and a long tail.
 *   So:  SOURCE = NAVY LRAE · EDITION = revision `MM.YYYY` · FISCAL YEAR = a ROW field.
 *   There is no NAVY_FY2026 / NAVY_FY2027 source split, and none is needed.
 *
 * ⚠️ THE SOFT-404 TRAP — why status codes cannot be trusted here.
 *   Probing `02.2027`, `01.2027`, `09.2026`, `10.2026` each returns **HTTP 200 with
 *   104,048 bytes of text/html** — SharePoint's "not found" page. Only `02.2026`
 *   returns a real workbook. A naive `res.ok` check would have concluded FY2027
 *   exists. Existence therefore requires the **ZIP/XLSX magic bytes `PK` (0x504b)**,
 *   never the status code.
 *
 * ⚠️ NO UNAUTHENTICATED LISTING EXISTS. Checked before writing any probing code:
 *   `_api/web/GetFolderByServerRelativeUrl(...)/Files`,
 *   `_api/web/lists/getbytitle('Documents')/items` and `_vti_bin/ListData.svc/Documents`
 *   all return HTML, not JSON. Bounded candidate probing is the fallback, kept
 *   deliberately small — this is not SharePoint archaeology.
 *
 * ⚠️ REVISION IS NOT FISCAL YEAR. The filename identifies the REVISION. Fiscal year
 *   is read from each ROW. Inferring FY from the filename would collapse a
 *   multi-year workbook into a single year and silently discard FY2027+.
 */

export interface NavyRevision {
  /** 'MM.YYYY' as it appears in the filename, e.g. '02.2026'. */
  revision: string;
  url: string;
  /** Bytes seen during probing — evidence the body was a real file. */
  probedBytes: number;
}

const BASE = 'https://www.secnav.navy.mil/smallbusiness/Documents';

/**
 * ⚠️ A BROWSER USER-AGENT IS REQUIRED. Measured 2026-09-13: requesting the REAL
 * workbook with `Mindy-Institute (hello@getmindy.ai)` returns **HTTP 200 +
 * text/html, 244 bytes** — the soft-404 — while the identical request with a
 * browser UA returns the real 4,118,847-byte XLSX. secnav.navy.mil rejects
 * non-browser agents by serving the not-found page rather than a 403, so a polite
 * custom UA would have made every revision look nonexistent. This cost one full
 * discovery run that reported "no valid revision found" for a file proven to exist.
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const FILE = (rev: string) => `${BASE}/Combined%20LRAE_${rev}.xlsx`;

/** XLSX is a ZIP: it MUST start with 'PK' (0x50 0x4b). */
export function isXlsxSignature(head: Uint8Array): boolean {
  return head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b;
}

/** `MM.YYYY` revision candidates, newest first. Bounded — never an open history sweep. */
export function revisionCandidates(now: Date, monthsBack = 18): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 0; i < monthsBack; i++) {
    out.push(`${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`);
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

/** Compare 'MM.YYYY' chronologically. */
export function revisionSortKey(rev: string): number {
  const m = rev.match(/^(\d{2})\.(\d{4})$/);
  return m ? Number(m[2]) * 100 + Number(m[1]) : -1;
}

export interface DiscoveryResult {
  /** Newest revision proven to be a real XLSX. Null when discovery found none. */
  latestAvailable: NavyRevision | null;
  /** TRUE when probing itself failed (network/etc) — the caller must report UNMEASURED. */
  discoveryFailed: boolean;
  probed: number;
  error?: string;
}

/**
 * Discover the newest REAL workbook revision.
 *
 * A technical probing failure is NEVER "no newer revision" — it returns
 * `discoveryFailed`, so the caller reports UNMEASURED instead of falsely CURRENT.
 */
export async function discoverLatestRevision(
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
  monthsBack = 18,
): Promise<DiscoveryResult> {
  const candidates = revisionCandidates(now, monthsBack);
  let probed = 0;
  let transportFailures = 0;

  for (const rev of candidates) {
    probed++;
    try {
      // Range-GET: cheap, and enough bytes to read the signature.
      const res = await fetchImpl(FILE(rev), {
        headers: { 'User-Agent': UA, Range: 'bytes=0-2047' },
      });
      const buf = new Uint8Array(await res.arrayBuffer());
      // HTTP 200 + HTML is SharePoint's soft-404. Only the signature proves a file.
      if (isXlsxSignature(buf)) {
        return { latestAvailable: { revision: rev, url: FILE(rev), probedBytes: buf.length }, discoveryFailed: false, probed };
      }
    } catch {
      transportFailures++;
    }
  }

  // Every candidate failed at the transport layer -> we learned nothing.
  if (transportFailures === probed) {
    return { latestAvailable: null, discoveryFailed: true, probed, error: 'all revision probes failed at transport level' };
  }
  return { latestAvailable: null, discoveryFailed: false, probed };
}

export type CurrentnessState = 'current' | 'behind_upstream' | 'latest_upstream_unmeasured';

export interface Currentness {
  state: CurrentnessState;
  latestAvailableRevision: string | null;
  latestHeldRevision: string | null;
  detail: string;
}

/**
 * Currentness is ORTHOGONAL to producer health. A source can ingest successfully
 * today and still be BEHIND_UPSTREAM — today's sync never proves currentness.
 */
export function assessCurrentness(
  discovery: DiscoveryResult,
  latestHeldRevision: string | null,
): Currentness {
  if (discovery.discoveryFailed || !discovery.latestAvailable) {
    return {
      state: 'latest_upstream_unmeasured',
      latestAvailableRevision: null,
      latestHeldRevision,
      detail: discovery.discoveryFailed
        ? 'revision discovery failed — cannot establish the newest upstream revision'
        : 'no valid workbook revision found in the probed window',
    };
  }
  const available = discovery.latestAvailable.revision;
  if (!latestHeldRevision) {
    return { state: 'behind_upstream', latestAvailableRevision: available, latestHeldRevision: null,
      detail: `upstream revision ${available} available; Mindy holds none` };
  }
  if (revisionSortKey(available) > revisionSortKey(latestHeldRevision)) {
    return { state: 'behind_upstream', latestAvailableRevision: available, latestHeldRevision,
      detail: `upstream revision ${available} is newer than the held ${latestHeldRevision}` };
  }
  return { state: 'current', latestAvailableRevision: available, latestHeldRevision,
    detail: `Mindy holds the newest known revision ${latestHeldRevision}` };
}

// ── PARSE SAFETY ────────────────────────────────────────────────────────────

export const REQUIRED_COLUMNS = ['Requirement Title'] as const;

export interface ParsedNavyRow {
  externalId: string;
  title: string;
  description: string | null;
  fiscalYear: string | null;
  rawFiscalYear: string | null;
}

export interface ParseOutcome {
  ok: boolean;
  rows: ParsedNavyRow[];
  sheet: string | null;
  headerRow: number | null;
  reason?: string;
  fiscalYears: Record<string, number>;
}

/** Sheet names seen in the real workbook; 'Full LRAE' is the authoritative one. */
export function selectSheet(sheetNames: string[]): string | null {
  return sheetNames.find((n) => /full\s*lrae/i.test(n))
    ?? sheetNames.find((n) => /lrae/i.test(n))
    ?? null;
}

/**
 * Find the real header row. The workbook has a banner at rows 0-2 and the true
 * header at row 3 — a naive read produces `__EMPTY_*` columns and silently yields
 * nothing useful, which is the exact failure Phase II exists to prevent.
 */
export function detectHeaderRow(aoa: unknown[][], maxScan = 12): number | null {
  for (let i = 0; i < Math.min(aoa.length, maxScan); i++) {
    const cells = (aoa[i] || []).map((c) => String(c ?? '').trim());
    if (REQUIRED_COLUMNS.every((req) => cells.some((c) => c.toLowerCase() === req.toLowerCase()))) return i;
  }
  return null;
}

/** TRUE when a parse produced only placeholder columns — a silent-failure signature. */
export function isEmptyColumnParse(columns: string[]): boolean {
  if (columns.length === 0) return true;
  return columns.every((c) => /^__EMPTY/i.test(c) || !c.trim());
}
