/**
 * SSA production REACHABILITY watch — measures access, never ingests.
 *
 * WHY THIS EXISTS. SSA/Akamai rejects Mindy's Vercel egress at the network level:
 * measured simultaneously with identical headers and identical code, a residential IP
 * gets 200 and Vercel gets 403. That is a reputation block, so no header tuning fixes
 * it, and scheduling the ingest route would just fail daily.
 *
 * ⚠️ THE WATCH SUCCEEDING IS NOT THE SOURCE BEING HEALTHY. This job's purpose is to
 * MEASURE a known-blocked condition, so a blocked result is a successful execution with
 * `reachability: 'blocked'` — not a failed cron. Job success != source health, and
 * job success != data advancement.
 *
 * ⚠️ IT MUST NEVER MUTATE FORECASTS, and a blocked probe must never be read as zero
 * records: the last successfully measured fingerprint/population stay exactly as they
 * are (see the clock rules in the route).
 */
import { createHash } from 'crypto';

export const SSA_DISCOVERY_URL = 'https://www.ssa.gov/osdbu/contract-forecast-intro.html';
export const SSA_SOURCE_KEY = 'forecast_ssa_osdbu';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** The exact header set proven to pass the WAF from a non-blocked network. */
function wafHeaders(): Record<string, string> {
  return {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"macOS"',
    'Upgrade-Insecure-Requests': '1',
  };
}

export type SsaReachability = 'reachable' | 'blocked' | 'retired' | 'degraded';

export interface SsaReachabilityResult {
  /** Did the WATCH run to completion? Distinct from whether SSA is reachable. */
  watchExecution: 'success' | 'error';
  reachability: SsaReachability;
  httpStatus: number | null;
  attempts: number;
  detail: string;
  /** Only set on a genuine reachable+valid HTML response. */
  discoveryFingerprint?: string;
  bytes?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function probeSsaReachability(
  opts: { fetchImpl?: typeof fetch; tries?: number } = {},
): Promise<SsaReachabilityResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const tries = opts.tries ?? 3;
  let status: number | null = null;
  let attempts = 0;

  for (let i = 0; i < tries; i++) {
    attempts++;
    let res: Response;
    try {
      res = await fetchImpl(SSA_DISCOVERY_URL, { headers: wafHeaders(), redirect: 'follow' });
    } catch (e) {
      // A transport error is NOT "blocked" — say what it was.
      if (i === tries - 1) {
        return { watchExecution: 'success', reachability: 'degraded', httpStatus: null, attempts,
          detail: `transport error: ${(e as Error).message}` };
      }
      await sleep(2000 * (i + 1));
      continue;
    }
    status = res.status;

    if (res.status === 403) {                    // the measured Akamai egress block
      if (i < tries - 1) { await sleep(2000 * (i + 1)); continue; }
      return { watchExecution: 'success', reachability: 'blocked', httpStatus: 403, attempts,
        detail: 'Akamai returned 403 to Mindy production egress after bounded retries' };
    }
    if (res.status === 404) {
      return { watchExecution: 'success', reachability: 'retired', httpStatus: 404, attempts,
        detail: 'discovery page returned 404 — the source URL may have moved again' };
    }
    if (!res.ok) {
      if (i < tries - 1) { await sleep(2000 * (i + 1)); continue; }
      return { watchExecution: 'success', reachability: 'degraded', httpStatus: res.status, attempts,
        detail: `unexpected status ${res.status}` };
    }

    const html = await res.text();
    // A 200 is not proof: the WAF can serve an HTML error body. Require the real section.
    if (!/Contracting\s+Forecast/i.test(html)) {
      return { watchExecution: 'success', reachability: 'degraded', httpStatus: res.status, attempts,
        detail: 'HTTP 200 but the Contracting Forecast section is absent (WAF or page change)' };
    }
    return {
      watchExecution: 'success', reachability: 'reachable', httpStatus: res.status, attempts,
      detail: 'discovery page fetched and the Contracting Forecast section is present',
      discoveryFingerprint: createHash('sha256').update(html).digest('hex').slice(0, 32),
      bytes: html.length,
    };
  }
  return { watchExecution: 'success', reachability: 'blocked', httpStatus: status, attempts,
    detail: 'exhausted retries' };
}
