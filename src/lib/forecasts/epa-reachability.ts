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
  /**
   * The probe's wall-clock budget. `exhausted: true` means the probe stopped because its
   * deadline ran out (EPA hanging), not because it measured a definitive answer. It is
   * still a completed watch reporting an unavailable source.
   */
  probeBudget: { deadlineMs: number; elapsedMs: number; exhausted: boolean };
}

/**
 * Whole-probe deadline. The dispatcher waits min(cron_jobs.timeout_ms, 55s) for the
 * route's response headers (cron/dispatch/route.ts DISPATCH_AWAIT_CAP_MS); this job's row
 * is 50,000 ms. The route answers only after the probe AND the instance read/update AND
 * the dedup check + ops alert, so the probe must leave headroom for those. Before this
 * deadline the probe alone could run 3 × 25s + 2s + 4s backoff = 81s, plus an UNBOUNDED
 * body read (the attempt timer was cleared before res.text()), so a hanging EPA turned a
 * successful "source unavailable" watch into a dispatcher `timeout` (2026-10-03, 10-04).
 */
export const EPA_PROBE_DEADLINE_MS = 35_000;

/** Do not start an attempt with less time than this left — it could only time out. */
const MIN_ATTEMPT_MS = 1_000;

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

class ProbeTimeout extends Error {
  constructor() { super('probe attempt timed out (aborted)'); this.name = 'AbortError'; }
}

/** Resolve `p`, or reject when `signal` aborts, so a hung read cannot outlive its attempt. */
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ProbeTimeout());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ProbeTimeout());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

type ProbeOutcome = Omit<EpaReachabilityResult, 'probeBudget'>;

export async function probeEpaReachability(
  opts: {
    fetchImpl?: typeof fetch;
    tries?: number;
    timeoutMs?: number;
    /** Wall-clock budget for the WHOLE probe: every attempt, backoff and body read. */
    deadlineMs?: number;
    nowMs?: () => number;
    sleepImpl?: (ms: number) => Promise<void>;
  } = {},
): Promise<EpaReachabilityResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const tries = opts.tries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const deadlineMs = opts.deadlineMs ?? EPA_PROBE_DEADLINE_MS;
  const nowMs = opts.nowMs ?? Date.now;
  const wait = opts.sleepImpl ?? sleep;
  const startedAt = nowMs();
  const remaining = () => deadlineMs - (nowMs() - startedAt);
  let attempts = 0;
  let discoveryStatus: number | null = null;
  let last: ProbeOutcome | null = null;
  let exhausted = false;

  const finish = (r: ProbeOutcome): EpaReachabilityResult => ({
    ...r, probeBudget: { deadlineMs, elapsedMs: nowMs() - startedAt, exhausted },
  });
  /** Back off before the next attempt; false when there is none or the deadline cannot fit it. */
  const backoff = async (i: number): Promise<boolean> => {
    if (i >= tries - 1) return false;
    const ms = 2000 * (i + 1);
    if (remaining() < ms + MIN_ATTEMPT_MS) { exhausted = true; return false; }
    await wait(ms);
    return true;
  };

  for (let i = 0; i < tries; i++) {
    const budget = Math.min(timeoutMs, remaining());
    if (budget < MIN_ATTEMPT_MS) { exhausted = true; break; }
    attempts++;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), budget);
    let res: Response;
    let body = '';
    try {
      res = await abortable(
        fetchImpl(EPA_DISCOVERY_URL, { headers: headers(), redirect: 'follow', signal: ctl.signal }),
        ctl.signal,
      );
      // The attempt timer stays armed through the body read: a 200 whose body never
      // finishes is a hang, not a pass.
      if (res.ok) body = await abortable(res.text(), ctl.signal);
    } catch (e) {
      clearTimeout(t);
      const why = (e as Error).message ?? String(e);
      const timedOut = ctl.signal.aborted;
      if (timedOut && remaining() < MIN_ATTEMPT_MS) exhausted = true;
      last = {
        watchExecution: 'success', reachability: timedOut ? 'apex_timeout' : classifyTransport(why), blocked: true,
        discoveryStatus, attempts,
        detail: `redirect chain toward ${EPA_APEX_HOST} failed: ${why}`,
      };
      if (await backoff(i)) continue;
      return finish(last);
    }
    clearTimeout(t);

    discoveryStatus = res.status;
    const finalUrl = res.url || undefined;

    if (!res.ok) {
      // A non-2xx that still names the APEX host means the chain started but never landed.
      const reach: EpaReachability = finalUrl && finalUrl.includes(EPA_APEX_HOST)
        ? 'redirect_started' : 'apex_http_error';
      last = { watchExecution: 'success', reachability: reach, blocked: true,
        discoveryStatus, finalUrl, finalStatus: res.status, attempts,
        detail: `chain ended at HTTP ${res.status}${finalUrl ? ` (${finalUrl})` : ''} without landing on the APEX application` };
      if (await backoff(i)) continue;
      return finish(last);
    }

    const found = APEX_MARKERS.filter((m) => body.toLowerCase().includes(m.toLowerCase()));
    // A 200 is not proof: a proxy/error/login page also returns 200.
    if (found.length < 2 || body.length < 500) {
      last = { watchExecution: 'success', reachability: 'apex_invalid_payload', blocked: true,
        discoveryStatus, finalUrl, finalStatus: res.status, attempts, markersFound: found,
        detail: `HTTP 200 but the payload lacks APEX application markers (${body.length} bytes, ${found.length} marker(s))` };
      if (await backoff(i)) continue;
      return finish(last);
    }

    // Landed on the real application. Still NOT "current" — nothing is verified yet.
    return finish({
      watchExecution: 'success', reachability: 'reachable_pending_verification', blocked: false,
      discoveryStatus, finalUrl, finalStatus: res.status, attempts, markersFound: found,
      detail: 'redirect chain landed on the EPA APEX forecast application; a controlled read-only audit is required before any ingest',
    });
  }
  return finish(last ?? { watchExecution: 'success', reachability: 'apex_timeout', blocked: true,
    discoveryStatus, attempts, detail: `probe deadline (${deadlineMs} ms) exhausted before an attempt could start` });
}
