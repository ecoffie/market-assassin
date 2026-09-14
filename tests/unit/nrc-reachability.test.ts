import { describe, it, expect } from 'vitest';
import { probeNrcSource } from '@/lib/forecasts/nrc-reachability';

/**
 * The trap: every guessed path under acquisitiongateway.gov returns HTTP 200 with the
 * SAME ~19,603-byte Angular shell. A byte-identical body across unrelated paths is a
 * soft-404. Reading it as data would fabricate an empty source.
 */
const SHELL = '<!doctype html><html lang="en" data-beasties-container>' + 'x'.repeat(19_550);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 7)]);

const res = (o: Partial<{status:number;url:string;body:string;buf:Buffer;headers:Record<string,string>}>) => ({
  status: o.status ?? 200, ok: (o.status ?? 200) < 400, url: o.url ?? '',
  text: async () => o.body ?? '',
  arrayBuffer: async () => (o.buf ?? Buffer.alloc(0)),
  headers: { get: (k: string) => (o.headers ?? {})[k.toLowerCase()] ?? null },
} as unknown as Response);

const route = (h: (u: string) => Response) => (async (u: string) => h(String(u))) as unknown as typeof fetch;

describe('NRC source watch', () => {
  it('classifies the login.gov bounce as auth_gated, not unreachable or current', async () => {
    const r = await probeNrcSource({ fetchImpl: route(u =>
      u.includes('ag-dashboard')
        ? res({ url: 'https://secure.login.gov/openid_connect/authorize?client_id=x' })
        : res({ buf: PDF, headers: { 'last-modified': 'Thu, 26 Feb 2026 13:28:37 GMT' } })) });
    expect(r.canonical.state).toBe('auth_gated');
    expect(r.canonical.authRedirect).toBe(true);
    expect(r.canonicalRecovered).toBe(false);
    expect(r.watchExecution).toBe('success');   // the WATCH succeeded
  });

  it('REFUSES the ~19,603-byte shell as data — HTTP 200 is not access', async () => {
    const r = await probeNrcSource({ fetchImpl: route(u =>
      u.includes('ag-dashboard') ? res({ url: 'https://ag-dashboard.acquisitiongateway.gov/', body: SHELL })
                                 : res({ buf: PDF })) });
    expect(r.canonical.state).toBe('public_shell_only');
    expect(r.canonicalRecovered).toBe(false);
  });

  it('only a genuine non-shell payload counts as machine_readable', async () => {
    const real = JSON.stringify({ results: [{ sourceId: 'NRC_26_0001', title: 'x' }] });
    const r = await probeNrcSource({ fetchImpl: route(u =>
      u.includes('ag-dashboard') ? res({ url: 'https://ag-dashboard.acquisitiongateway.gov/api', body: real })
                                 : res({ buf: PDF })) });
    expect(r.canonical.state).toBe('machine_readable');
    expect(r.canonicalRecovered).toBe(true);
  });

  it('captures the PDF as an EDITION SIGNAL only — never population or identity', async () => {
    const r = await probeNrcSource({ fetchImpl: route(u =>
      u.includes('ag-dashboard') ? res({ url: 'https://secure.login.gov/' })
        : res({ buf: PDF, headers: { 'last-modified': 'Thu, 26 Feb 2026 13:28:37 GMT', etag: '"319e21d023a7dc1:0"' } })) });
    expect(r.pdf.reachable).toBe(true);
    expect(r.pdf.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(r.pdf.lastModified).toContain('26 Feb 2026');
    // The PDF must never imply record-level facts.
    expect(JSON.stringify(r.pdf)).not.toMatch(/population|held|upstreamCount/i);
  });

  it('flags a CHANGED pdf against a known fingerprint', async () => {
    const r = await probeNrcSource({ knownPdfFingerprint: 'deadbeef'.repeat(4), fetchImpl: route(u =>
      u.includes('ag-dashboard') ? res({ url: 'https://secure.login.gov/' }) : res({ buf: PDF })) });
    expect(r.pdf.changed).toBe(true);
  });

  it('a non-PDF payload is not accepted as the edition signal', async () => {
    const r = await probeNrcSource({ fetchImpl: route(u =>
      u.includes('ag-dashboard') ? res({ url: 'https://secure.login.gov/' })
                                 : res({ buf: Buffer.from('<html>Access Denied</html>') })) });
    expect(r.pdf.reachable).toBe(false);
    expect(r.pdf.detail).toMatch(/not a %PDF/);
  });

  it('a canonical transport failure is probe_failed, never "no records"', async () => {
    const r = await probeNrcSource({ fetchImpl: route(u => {
      if (u.includes('ag-dashboard')) throw new Error('ECONNRESET');
      return res({ buf: PDF }); }) });
    expect(r.canonical.state).toBe('probe_failed');
    expect(r.canonicalRecovered).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/"records"\s*:\s*0/);
  });
});
