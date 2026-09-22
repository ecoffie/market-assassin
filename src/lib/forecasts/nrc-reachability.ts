/**
 * NRC source watch — TWO independent observations, neither of which may ingest.
 *
 * A. CANONICAL: the GSA Acquisition Gateway FCO data behind
 *    `ag-dashboard.acquisitiongateway.gov`, which 302-chains to secure.login.gov
 *    demanding OpenID Connect at AAL2 (MFA). That is `auth_gated` — NOT unreachable,
 *    NOT current, and never to be automated around.
 *
 * ⚠️ HTTP 200 IS NOT ACCESS HERE. Every guessed path under acquisitiongateway.gov —
 *    /api/forecast, /api/v3.0/forecast, /forecast/resources/<id> — returns 200 with the
 *    IDENTICAL ~19,603-byte Angular shell. A byte-identical shell across unrelated paths
 *    is a soft-404, so the probe measures the SHELL SIGNATURE and refuses to read it as data.
 *
 * ⚠️ AND DO NOT CONCLUDE "login-gated" FROM THE DASHBOARD HOST ALONE. The repo ledger
 *    records this source being written off twice on exactly that evidence; the PUBLIC tool
 *    at www.acquisitiongateway.gov/forecast needs no auth and has an Export CSV button.
 *    What is gated is the machine/API path this source was ingested through. Re-establishing
 *    a supported export route is COVERAGE work, deliberately out of scope for this watch.
 *
 * B. SECONDARY: NRC's own published PDF. It is an EDITION SIGNAL ONLY — 34 pages whose
 *    data tables are SCANNED IMAGES (pages 8/15/25 yield 0 text chars) and which carries no
 *    NRC_26_ identifiers. It can never establish row identity, population, or currentness
 *    for the 89 held API records, and must never be OCR'd into forecast rows.
 */
import { createHash } from 'crypto';

export const NRC_DISCOVERY_URL = 'https://www.nrc.gov/about-nrc/contracting/small-business/forecast.html';
export const NRC_CANONICAL_HOST = 'https://ag-dashboard.acquisitiongateway.gov/';
export const NRC_PUBLIC_FORECAST = 'https://www.acquisitiongateway.gov/forecast';
export const NRC_PDF_URL = 'https://www.nrc.gov/docs/ML2604/ML26042A301.pdf';
export const NRC_SOURCE_KEY = 'forecast_nrc_gateway';

/** The measured soft-404 shell. A body at/near this size with no data is not access. */
const SHELL_BYTES = 19603;
const SHELL_TOLERANCE = 400;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const htmlHeaders = (referer?: string): Record<string, string> => ({
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': referer ? 'same-origin' : 'none', 'Sec-Fetch-User': '?1',
  'Sec-Ch-Ua-Platform': '"macOS"', 'Upgrade-Insecure-Requests': '1',
  ...(referer ? { Referer: referer } : {}),
});

export type NrcCanonicalState =
  | 'auth_gated'            // the measured condition: bounces to login.gov
  | 'public_shell_only'     // 200 but the byte-identical Angular shell
  | 'machine_readable'      // genuine structured data — triggers a controlled audit
  | 'probe_failed';

export interface NrcWatchResult {
  watchExecution: 'success' | 'error';
  canonical: {
    state: NrcCanonicalState;
    authRedirect: boolean;
    finalUrl?: string;
    status: number | null;
    shellBytes?: number;
    detail: string;
  };
  pdf: {
    reachable: boolean;
    status: number | null;
    lastModified?: string | null;
    etag?: string | null;
    fingerprint?: string;
    bytes?: number;
    changed?: boolean;
    detail: string;
  };
  /** True only when the canonical machine path is genuinely readable again. */
  canonicalRecovered: boolean;
}

async function safeFetch(url: string, init: RequestInit, fetchImpl: typeof fetch, timeoutMs = 25_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try { return await fetchImpl(url, { ...init, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

export async function probeNrcSource(
  opts: { fetchImpl?: typeof fetch; knownPdfFingerprint?: string | null } = {},
): Promise<NrcWatchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;

  // ---- A. canonical machine path ----
  let canonical: NrcWatchResult['canonical'];
  try {
    const res = await safeFetch(NRC_CANONICAL_HOST, { headers: htmlHeaders(), redirect: 'follow' }, fetchImpl);
    const finalUrl = res.url || '';
    const authRedirect = /login\.gov|openid_connect|\/user\/login/i.test(finalUrl);
    if (authRedirect) {
      canonical = { state: 'auth_gated', authRedirect: true, finalUrl, status: res.status,
        detail: 'canonical FCO host redirects to Login.gov (OIDC, AAL2) — authorized access required, never automated around' };
    } else {
      const body = await res.text();
      const isShell = Math.abs(body.length - SHELL_BYTES) <= SHELL_TOLERANCE
        && !/\bNRC_\d{2}_\d{4}\b/.test(body);
      canonical = isShell
        ? { state: 'public_shell_only', authRedirect: false, finalUrl, status: res.status, shellBytes: body.length,
            detail: `HTTP ${res.status} but the body is the ~${SHELL_BYTES}-byte Angular shell — a soft-404, not data` }
        : { state: 'machine_readable', authRedirect: false, finalUrl, status: res.status, shellBytes: body.length,
            detail: 'canonical path returned a non-shell payload — run a controlled read-only audit before any ingest' };
    }
  } catch (e) {
    canonical = { state: 'probe_failed', authRedirect: false, status: null,
      detail: `canonical probe failed: ${(e as Error).message}` };
  }

  // ---- B. secondary PDF edition signal ----
  let pdf: NrcWatchResult['pdf'];
  try {
    const res = await safeFetch(NRC_PDF_URL, { headers: htmlHeaders(NRC_DISCOVERY_URL), redirect: 'follow' }, fetchImpl, 60_000);
    if (!res.ok) {
      pdf = { reachable: false, status: res.status, detail: `PDF returned HTTP ${res.status}` };
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      const isPdf = buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
      if (!isPdf) {
        pdf = { reachable: false, status: res.status, bytes: buf.length, detail: 'payload is not a %PDF- document' };
      } else {
        const fingerprint = createHash('sha256').update(buf).digest('hex').slice(0, 32);
        pdf = {
          reachable: true, status: res.status, bytes: buf.length, fingerprint,
          lastModified: res.headers.get('last-modified'), etag: res.headers.get('etag'),
          changed: opts.knownPdfFingerprint ? fingerprint !== opts.knownPdfFingerprint : undefined,
          detail: 'secondary edition signal only — scanned tables, no row identity, never OCR’d into forecasts',
        };
      }
    }
  } catch (e) {
    pdf = { reachable: false, status: null, detail: `PDF probe failed: ${(e as Error).message}` };
  }

  return { watchExecution: 'success', canonical, pdf, canonicalRecovered: canonical.state === 'machine_readable' };
}
