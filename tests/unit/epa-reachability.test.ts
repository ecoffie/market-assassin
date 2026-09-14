import { describe, it, expect } from 'vitest';
import { probeEpaReachability } from '@/lib/forecasts/epa-reachability';

/**
 * The trap this guards: EPA's entry point (ofmpub) reliably answers 302 into an APEX
 * host that then resets. "A 302 arrived" and "TLS succeeded" both look like progress
 * and are NOT reachability. Only landing on the application counts.
 */
const APEX_BODY = `<html><head><title>EPA Acquisition Forecast</title></head>
<body><form action="f?p=122:1"><table><tr><th>Record Number</th><th>NAICS Code</th></tr></table>
<input name="p_flow_id" value="122"></form>${'x'.repeat(600)}</body></html>`;

const ok = (body: string, url = 'https://ordspub.epa.gov/ords/forecast/f?p=122:1:999') =>
  ({ status: 200, ok: true, url, text: async () => body } as Response);

describe('EPA APEX reachability probe', () => {
  it('a TCP reset is a SUCCESSFUL watch reporting apex_transport_reset', async () => {
    const r = await probeEpaReachability({
      fetchImpl: async () => { throw new Error('fetch failed: ECONNRESET'); }, tries: 2 });
    expect(r.watchExecution).toBe('success');        // the job did its job
    expect(r.reachability).toBe('apex_transport_reset');
    expect(r.blocked).toBe(true);                    // the source did not
    expect(r.attempts).toBe(2);
  });

  it('a timeout is classified separately from a reset', async () => {
    const r = await probeEpaReachability({
      fetchImpl: async () => { throw new Error('The operation timed out'); }, tries: 1 });
    expect(r.reachability).toBe('apex_timeout');
    expect(r.blocked).toBe(true);
  });

  it('landing on the real APEX app is reachable_pending_verification — never "current"', async () => {
    const r = await probeEpaReachability({ fetchImpl: async () => ok(APEX_BODY) });
    expect(r.reachability).toBe('reachable_pending_verification');
    expect(r.blocked).toBe(false);
    expect((r.markersFound ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('HTTP 200 from a proxy/error page is apex_invalid_payload, NOT reachable', async () => {
    const r = await probeEpaReachability({
      fetchImpl: async () => ok('<html><body>Service Unavailable</body></html>'), tries: 1 });
    expect(r.reachability).toBe('apex_invalid_payload');
    expect(r.blocked).toBe(true);
  });

  it('a chain that ends non-2xx on the APEX host is redirect_started, not reachable', async () => {
    const r = await probeEpaReachability({
      fetchImpl: async () => ({ status: 503, ok: false,
        url: 'https://ordspub.epa.gov/ords/forecast/f?p=122:1', text: async () => '' } as Response),
      tries: 1 });
    expect(r.reachability).toBe('redirect_started');
    expect(r.blocked).toBe(true);
  });

  it('never reports the source as empty or zero records', async () => {
    const r = await probeEpaReachability({
      fetchImpl: async () => { throw new Error('ECONNRESET'); }, tries: 1 });
    expect(JSON.stringify(r)).not.toMatch(/"records"\s*:\s*0|empty/i);
    expect(r.detail.length).toBeGreaterThan(10);   // always explains itself
  });

  it('recovers on a later attempt rather than giving up on the first reset', async () => {
    let n = 0;
    const r = await probeEpaReachability({
      fetchImpl: async () => { if (++n === 1) throw new Error('ECONNRESET'); return ok(APEX_BODY); },
      tries: 3 });
    expect(r.reachability).toBe('reachable_pending_verification');
    expect(r.attempts).toBe(2);
  });
});
