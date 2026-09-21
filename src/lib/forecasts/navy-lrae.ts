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

import { createHash } from 'node:crypto';

export interface NavyRevision {
  /** 'MM.YYYY' as it appears in the filename, e.g. '02.2026'. */
  revision: string;
  url: string;
  /** Bytes seen during probing — evidence the body was a real file. */
  probedBytes: number;
  /**
   * SOURCE FINGERPRINT — proves whether the SAME revision changed in place.
   *
   * ⚠️ NAVY DOES UPDATE IN PLACE. Measured 2026-09-13, a Range request for
   * `Combined LRAE_02.2026.xlsx` returns:
   *     etag: "{EBFE7A2E-2DB1-4BE2-B5E4-E8C152536A53},4"   <- ",4" is SharePoint's
   *                                                           version counter
   *     last-modified: Thu, 02 Jul 2026 20:24:05 GMT        <- AFTER the 02.2026
   *                                                           filename period
   *     content-range: bytes 0-2047/4118847                 <- full size from 2 KB
   * So a filename alone can NEVER prove "unchanged": 02.2026 today and 02.2026 next
   * week may hold different rows. The fingerprint is what the daily watch compares.
   */
  etag: string | null;
  lastModified: string | null;
  /** Full size, read from Content-Range on a 2 KB request — no full download. */
  contentLength: number | null;
}

/** The identity the daily watch compares. Any change triggers a full ingest. */
export interface SourceFingerprint {
  revision: string;
  etag: string | null;
  lastModified: string | null;
  contentLength: number | null;
}

export function fingerprintOf(r: NavyRevision): SourceFingerprint {
  return { revision: r.revision, etag: r.etag, lastModified: r.lastModified, contentLength: r.contentLength };
}

/**
 * Hash the fingerprint into the single TEXT column the control plane stores.
 *
 * ⚠️ ORDER MATTERS, so this does NOT reuse ops-alert-dedup's `fingerprint()` —
 * that helper SORTS its parts (correct for "which items are affected", wrong for
 * ordered fields, where sorting would let an etag and a size swap places without
 * changing the hash).
 *
 * Returns NULL when no upstream metadata is comparable. NULL means UNMEASURED,
 * never "unchanged" — writing a hash of nothing would manufacture false stability,
 * which is the exact failure this fingerprint exists to prevent.
 *
 * ⚠️ THE STORED VALUE IS A TRUNCATED DIGEST, NOT A FULL SHA-256. It is the first
 * 32 of the 64 hex characters (128 bits), matching ops-alert-dedup's convention.
 * That is 2^128 of space — far beyond what change-detection over a handful of
 * daily values needs — and it is a deterministic prefix of the full digest, so it
 * can always be re-derived. Do NOT describe or log this column as a complete
 * SHA-256 digest; it is deliberately abbreviated for storage and readability.
 */
export function hashSourceFingerprint(fp: SourceFingerprint): string | null {
  if (fp.etag == null && fp.lastModified == null && fp.contentLength == null) return null;
  const parts = [
    `rev=${fp.revision}`,
    `etag=${fp.etag ?? ''}`,
    `lastmod=${fp.lastModified ?? ''}`,
    `size=${fp.contentLength ?? ''}`,
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

/**
 * Has upstream changed since the last run?
 *
 * ⚠️ ABSENT METADATA IS NOT "UNCHANGED". When neither side carries a comparable
 * fingerprint we return `unknown`, and the caller must ingest rather than assume
 * quiet — the whole point is that a filename cannot prove stability.
 */
export function fingerprintChanged(
  prev: SourceFingerprint | null,
  next: SourceFingerprint,
): 'changed' | 'unchanged' | 'unknown' {
  if (!prev) return 'changed';                       // nothing held -> must ingest
  if (prev.revision !== next.revision) return 'changed';
  const pairs: Array<[string | number | null, string | number | null]> = [
    [prev.etag, next.etag], [prev.lastModified, next.lastModified], [prev.contentLength, next.contentLength],
  ];
  const comparable = pairs.filter(([a, b]) => a != null && b != null);
  if (comparable.length === 0) return 'unknown';     // cannot prove stability
  return comparable.some(([a, b]) => a !== b) ? 'changed' : 'unchanged';
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
        const cr = res.headers.get('content-range');          // "bytes 0-2047/4118847"
        const total = cr?.split('/')[1];
        return {
          latestAvailable: {
            revision: rev, url: FILE(rev), probedBytes: buf.length,
            etag: res.headers.get('etag'),
            lastModified: res.headers.get('last-modified'),
            contentLength: total && /^\d+$/.test(total) ? Number(total) : null,
          },
          discoveryFailed: false, probed,
        };
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

// ── CONTENT CURRENTNESS + RECONCILIATION ────────────────────────────────────

/**
 * ⚠️ REVISION EQUALITY IS NOT CURRENTNESS. Measured 2026-09-13, Navy is
 * REVISION-CURRENT (latest upstream 02.2026 == latest held 02.2026) and
 * CONTENT-BEHIND (upstream 9,919 rows vs 8,821 held). A source is only CURRENT when
 * BOTH hold. Reporting "current" on revision alone would have declared a source
 * healthy while it was missing ~1,100 real forecast rows.
 */
export interface ReconcileCounts {
  upstreamTotal: number;
  matched: number;      // present both sides, unchanged
  changed: number;      // present both sides, differing content
  added: number;        // upstream only -> to insert
  absentUpstream: number; // held but not in this workbook — RETAINED, never deleted
  duplicateIdentities: number;
  parseFailures: number;
}

export type NavyState =
  | 'current'            // latest revision held AND content reconciled
  | 'behind_upstream'    // newer revision, OR this revision holds rows we lack
  | 'upstream_quiet'     // watch succeeded, fingerprint unchanged
  | 'ingest_broken'      // changed upstream content exists but cannot be ingested
  | 'unmeasured';        // discovery or comparison could not be established

export interface NavyAssessment {
  state: NavyState;
  revisionCurrent: boolean;
  contentCurrent: boolean;
  detail: string;
}

/**
 * Combine version- and content-currentness into one honest state.
 *
 * `absentUpstream` deliberately does NOT make a source behind or broken: for a
 * FIRST activation, conservative retention beats destructive reconciliation. Navy's
 * removal/supersession semantics are not yet proven, so a row missing from today's
 * workbook is kept and counted, never deleted.
 */
export function assessNavy(input: {
  currentness: Currentness;
  counts: ReconcileCounts | null;
  ingestFailed?: boolean;
  fingerprint: 'changed' | 'unchanged' | 'unknown';
}): NavyAssessment {
  const { currentness, counts } = input;
  const revisionCurrent = currentness.state === 'current';

  if (currentness.state === 'latest_upstream_unmeasured') {
    return { state: 'unmeasured', revisionCurrent: false, contentCurrent: false,
      detail: currentness.detail };
  }
  if (input.ingestFailed) {
    return { state: 'ingest_broken', revisionCurrent, contentCurrent: false,
      detail: 'upstream content changed but ingestion failed' };
  }
  if (!counts) {
    // Watch-only run: no parse happened, so content currentness is unproven.
    if (input.fingerprint === 'unchanged' && revisionCurrent) {
      return { state: 'upstream_quiet', revisionCurrent, contentCurrent: true,
        detail: 'source fingerprint unchanged since the last successful ingest' };
    }
    return { state: 'unmeasured', revisionCurrent, contentCurrent: false,
      detail: 'no reconciliation performed this run; content currentness unproven' };
  }

  const contentCurrent = counts.added === 0 && counts.changed === 0 && counts.parseFailures === 0;
  if (!revisionCurrent) {
    return { state: 'behind_upstream', revisionCurrent, contentCurrent,
      detail: currentness.detail };
  }
  if (!contentCurrent) {
    return { state: 'behind_upstream', revisionCurrent: true, contentCurrent: false,
      detail: `revision ${currentness.latestHeldRevision} is current but ${counts.added} new + ${counts.changed} changed row(s) are not yet held` };
  }
  return { state: 'current', revisionCurrent: true, contentCurrent: true,
    detail: `revision ${currentness.latestHeldRevision} held and ${counts.upstreamTotal} upstream row(s) reconciled` };
}
