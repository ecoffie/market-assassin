/**
 * EPA APEX reachability watch — measures access, never ingests.
 *
 * WHY THIS EXISTS. EPA's canonical Acquisition Forecast is an Oracle APEX application
 * with NO documented downloadable dataset (data.gov lists the portal URL as the only
 * distribution). As of 2026-09-14 the APEX host is intermittently dead:
 *
 *   ofmpub.epa.gov          200  — the entry point is fine
 *   www.epa.gov             200
 *   ordspub.epa.gov         000  — TCP RESET on every path (/, /ords/, the app URL)
 *   ordspubproxy.epa.gov    000  — the CNAME target, same
 *
 * TLS completes, THEN the peer resets. It is not header- or HTTP-version-sensitive,
 * a cookie jar does not help, and an independent third-party vantage also times out —
 * so this is EPA-side, not a Mindy egress block (unlike SSA). It is also INTERMITTENT:
 * some attempts return the first 302 before the chain dies.
 *
 * ⚠️ THE FIRST 302 IS NOT REACHABILITY. ofmpub reliably answers 302 into ordspub, and
 * the chain then mints a fresh APEX session id per hop. Treating "302 received" or
 * "TLS succeeded" as recovery would declare a dead source healthy. Recovery requires
 * the chain to LAND on the APEX application and return a response carrying real
 * application markers.
 *
 * ⚠️ NEVER SCRAPES OR INGESTS. Reachability verification only. A reachable page is not
 * permission to run an untested producer — the live schema, population, identity
 * stability and lifecycle vocabulary are all unverified while the source is down.
 */
export const EPA_DISCOVERY_URL = 'https://ofmpub.epa.gov/apex/forecast/f?p=forecast';
export const EPA_APEX_HOST = 'ordspub.epa.gov';
export const EPA_SOURCE_KEY = 'forecast_epa_apex';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function headers(): Record<string, string> {
  return {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
}

/** §6 — never collapse a source problem into "0 records" or "empty". */
export type EpaReachability =
  | 'reachable_pending_verification'   // landed on APEX with real markers
  | 'discovery_unreachable'            // even ofmpub failed
  | 'redirect_started'                 // 302 chain began but never landed
  | 'apex_transport_reset'             // TCP reset — the measured condition today
  | 'apex_timeout'
  | 'apex_http_error'
  | 'apex_invalid_payload';            // 200 but not the APEX app (proxy/login/error)

export interface EpaReachabilityResult {
  /** Did the WATCH run to completion? Distinct from whether EPA is reachable. */
  watchExecution: 'success' | 'error';
  reachability: EpaReachability;
  blocked: boolean;
  discoveryStatus: number | null;
  finalUrl?: string;
  finalStatus?: number | null;
  attempts: number;
  detail: string;
  markersFound?: string[];
}

/** Markers that distinguish the real APEX forecast app from a proxy/error page. */
const APEX_MARKERS = ['apex', 'f?p=', 'forecast', 'Record Number', 'apex_session', 'p_flow_id'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function classifyTransport(msg: string): EpaReachability {
  const m = msg.toLowerCase();
  if (m.includes('timeout') || m.includes('timed out') || m.includes('abort')) return 'apex_timeout';
  if (m.includes('reset') || m.includes('econnreset') || m.includes('socket hang up')
      || m.includes('fetch failed') || m.includes('closed')) return 'apex_transport_reset';
  return 'apex_transport_reset';
}

export async function probeEpaReachability(
  opts: { fetchImpl?: typeof fetch; tries?: number; timeoutMs?: number } = {},
): Promise<EpaReachabilityResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const tries = opts.tries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 25_000;
  let attempts = 0;
  let discoveryStatus: number | null = null;
  let last: EpaReachabilityResult | null = null;

  for (let i = 0; i < tries; i++) {
    attempts++;
    let res: Response;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        res = await fetchImpl(EPA_DISCOVERY_URL, { headers: headers(), redirect: 'follow', signal: ctl.signal });
      } finally { clearTimeout(t); }
    } catch (e) {
      const why = (e as Error).message ?? String(e);
      last = {
        watchExecution: 'success', reachability: classifyTransport(why), blocked: true,
        discoveryStatus, attempts,
        detail: `redirect chain toward ${EPA_APEX_HOST} failed: ${why}`,
      };
      if (i < tries - 1) { await sleep(2000 * (i + 1)); continue; }
      return last;
    }

    discoveryStatus = res.status;
    const finalUrl = res.url || undefined;

    if (!res.ok) {
      // A non-2xx that still names the APEX host means the chain started but never landed.
      const reach: EpaReachability = finalUrl && finalUrl.includes(EPA_APEX_HOST)
        ? 'redirect_started' : 'apex_http_error';
      last = { watchExecution: 'success', reachability: reach, blocked: true,
        discoveryStatus, finalUrl, finalStatus: res.status, attempts,
        detail: `chain ended at HTTP ${res.status}${finalUrl ? ` (${finalUrl})` : ''} without landing on the APEX application` };
      if (i < tries - 1) { await sleep(2000 * (i + 1)); continue; }
      return last;
    }

    const body = await res.text();
    const found = APEX_MARKERS.filter((m) => body.toLowerCase().includes(m.toLowerCase()));
    // A 200 is not proof: a proxy/error/login page also returns 200.
    if (found.length < 2 || body.length < 500) {
      last = { watchExecution: 'success', reachability: 'apex_invalid_payload', blocked: true,
        discoveryStatus, finalUrl, finalStatus: res.status, attempts, markersFound: found,
        detail: `HTTP 200 but the payload lacks APEX application markers (${body.length} bytes, ${found.length} marker(s))` };
      if (i < tries - 1) { await sleep(2000 * (i + 1)); continue; }
      return last;
    }

    // Landed on the real application. Still NOT "current" — nothing is verified yet.
    return {
      watchExecution: 'success', reachability: 'reachable_pending_verification', blocked: false,
      discoveryStatus, finalUrl, finalStatus: res.status, attempts, markersFound: found,
      detail: 'redirect chain landed on the EPA APEX forecast application; a controlled read-only audit is required before any ingest',
    };
  }
  return last ?? { watchExecution: 'success', reachability: 'apex_transport_reset', blocked: true,
    discoveryStatus, attempts, detail: 'exhausted retries' };
}
