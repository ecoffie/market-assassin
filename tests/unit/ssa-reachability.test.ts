import { describe, it, expect } from 'vitest';
import { probeSsaReachability } from '@/lib/forecasts/ssa-reachability';

/**
 * The distinction this whole job exists to preserve:
 * the WATCH succeeding is not the SOURCE being healthy.
 */
const res = (status: number, body = '') =>
  ({ status, ok: status >= 200 && status < 300, text: async () => body } as Response);

const PAGE = '<h2>Contracting Forecast</h2><ul><li><a href="x.xlsm">FY26</a></li></ul>';

describe('SSA reachability probe', () => {
  it('a 403 is a SUCCESSFUL watch reporting a BLOCKED source', async () => {
    const r = await probeSsaReachability({ fetchImpl: async () => res(403), tries: 2 });
    expect(r.watchExecution).toBe('success');   // the job did its job
    expect(r.reachability).toBe('blocked');     // the source did not
    expect(r.httpStatus).toBe(403);
    expect(r.attempts).toBe(2);                 // bounded retry actually retried
  });

  it('a real 200 with the Contracting Forecast section is reachable', async () => {
    const r = await probeSsaReachability({ fetchImpl: async () => res(200, PAGE) });
    expect(r.reachability).toBe('reachable');
    expect(r.discoveryFingerprint).toMatch(/^[0-9a-f]{32}$/);
  });

  it('HTTP 200 with a WAF/HTML body is DEGRADED, never reachable', async () => {
    // The measured trap: status alone is not proof of a payload.
    const r = await probeSsaReachability({ fetchImpl: async () => res(200, '<html><h1>Access Denied</h1></html>') });
    expect(r.reachability).toBe('degraded');
    expect(r.reachability).not.toBe('reachable');
  });

  it('a 404 is reported as retired, distinct from blocked', async () => {
    const r = await probeSsaReachability({ fetchImpl: async () => res(404) });
    expect(r.reachability).toBe('retired');
  });

  it('a transport error is degraded, not silently "blocked"', async () => {
    const r = await probeSsaReachability({ fetchImpl: async () => { throw new Error('ECONNRESET'); }, tries: 1 });
    expect(r.watchExecution).toBe('success');
    expect(r.reachability).toBe('degraded');
    expect(r.detail).toContain('ECONNRESET');
  });

  it('recovers on a later attempt rather than giving up on the first 403', async () => {
    let n = 0;
    const r = await probeSsaReachability({ fetchImpl: async () => (++n === 1 ? res(403) : res(200, PAGE)), tries: 3 });
    expect(r.reachability).toBe('reachable');
    expect(r.attempts).toBe(2);
  });
});
