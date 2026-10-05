import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { probeEpaReachability, EPA_PROBE_DEADLINE_MS } from './epa-reachability';

/**
 * REGRESSION 2026-10-03 / 10-04: epa-source-watch recorded `timeout` (50,002 ms) twice.
 * The dispatcher waits min(cron_jobs.timeout_ms = 50,000, 55,000) for the route's headers,
 * but the probe alone could take 3 × 25s + 2s + 4s backoff = 81s, and the body read sat
 * OUTSIDE the attempt timer (unbounded). A hanging EPA turned a successful
 * "source unavailable" watch into a dispatcher timeout.
 *
 * These run the REAL defaults (25s per try, 3 tries, backoff) under fake timers.
 */
const DISPATCHER_WAIT_MS = 50_000;

const never = <T,>() => new Promise<T>(() => {});

function apexBody(): string {
  return '<html>apex f?p=forecast Record Number p_flow_id '.padEnd(800, 'x') + '</html>';
}

async function runWithClock(probe: Promise<unknown>, advanceMs: number) {
  let settled = false;
  let value: unknown;
  probe.then((v) => { settled = true; value = v; });
  const t0 = Date.now();
  // Advance in 1s steps so each awaited timer/backoff can schedule the next.
  for (let i = 0; i < advanceMs / 1000 && !settled; i++) await vi.advanceTimersByTimeAsync(1000);
  return { settled, value: value as Awaited<ReturnType<typeof probeEpaReachability>>, elapsed: Date.now() - t0 };
}

describe('EPA probe stays inside the dispatcher wait', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('the deadline leaves headroom under the 50s dispatcher wait', () => {
    expect(EPA_PROBE_DEADLINE_MS).toBeLessThanOrEqual(DISPATCHER_WAIT_MS - 10_000);
  });

  it('hanging fetch (headers never arrive): returns apex_timeout within the deadline', async () => {
    const fetchImpl = vi.fn(() => never<Response>()) as unknown as typeof fetch;
    const r = await runWithClock(probeEpaReachability({ fetchImpl }), 90_000);
    expect(r.settled).toBe(true);
    expect(r.elapsed).toBeLessThanOrEqual(EPA_PROBE_DEADLINE_MS);
    expect(r.value.reachability).toBe('apex_timeout');
    expect(r.value.blocked).toBe(true);
    expect(r.value.watchExecution).toBe('success');
    expect(r.value.probeBudget.exhausted).toBe(true);
  });

  it('headers OK but the body read hangs: the attempt timer covers res.text()', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, url: 'https://ordspub.epa.gov/ords/f?p=forecast',
      text: () => never<string>(),
    })) as unknown as typeof fetch;
    const r = await runWithClock(probeEpaReachability({ fetchImpl }), 90_000);
    expect(r.settled).toBe(true);
    expect(r.elapsed).toBeLessThanOrEqual(EPA_PROBE_DEADLINE_MS);
    expect(r.value.reachability).toBe('apex_timeout');
    expect(r.value.blocked).toBe(true);
    expect(r.value.probeBudget.exhausted).toBe(true);
  });

  it('fast resets × 3: all attempts run, classified as transport reset, not budget-limited', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const r = await runWithClock(probeEpaReachability({ fetchImpl }), 90_000);
    expect(r.settled).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(r.value.attempts).toBe(3);
    expect(r.value.reachability).toBe('apex_transport_reset');
    expect(r.value.probeBudget.exhausted).toBe(false);
    expect(r.elapsed).toBeLessThanOrEqual(EPA_PROBE_DEADLINE_MS);
  });

  it('a real APEX landing is reachable_pending_verification, never current', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, url: 'https://ordspub.epa.gov/ords/f?p=forecast', text: async () => apexBody(),
    })) as unknown as typeof fetch;
    const r = await runWithClock(probeEpaReachability({ fetchImpl }), 5_000);
    expect(r.settled).toBe(true);
    expect(r.value.reachability).toBe('reachable_pending_verification');
    expect(r.value.blocked).toBe(false);
    expect(r.value.attempts).toBe(1);
    expect(r.value.probeBudget.exhausted).toBe(false);
  });
});
