/**
 * GET /reports/<id>/pdf — a real downloadable PDF of the hosted market report (2026-11-22).
 *
 * Before: "Save as PDF" was window.print() on the hosted page and a dead button inside Ask Mindy's
 * script-less preview frame. No file was ever produced. These pin the download response, error
 * handling and that the PDF is rendered from the SAME HTML as the hosted page. The real-Chromium file
 * validity / content check is in ./pdf-render.unit.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMarketReport = vi.fn();
vi.mock('@/lib/market/report-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/market/report-store')>()),
  getMarketReport: (id: string) => getMarketReport(id),
}));
const htmlToPdf = vi.fn();
vi.mock('@/lib/pdf/launch-browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pdf/launch-browser')>()),
  htmlToPdf: (...a: unknown[]) => htmlToPdf(...a),
}));
// The REAL limiter runs against a controllable KV: healthy by default, or throwing (an outage).
const kvCounts = new Map<string, number>();
let kvDown = false;
const kvIncr = vi.fn(async (k: string) => { if (kvDown) throw new Error('KV unavailable'); const n = (kvCounts.get(k) ?? 0) + 1; kvCounts.set(k, n); return n; });
vi.mock('@vercel/kv', () => ({
  kv: {
    incr: (k: string) => kvIncr(k),
    expire: async () => { if (kvDown) throw new Error('KV unavailable'); return 1; },
    ttl: async () => { if (kvDown) throw new Error('KV unavailable'); return 3600; },
  },
}));

import { GET, PDF_OPTIONS, PDF_LIMIT_PER_IP_HOUR, PDF_FALLBACK_PER_IP_HOUR, PDF_FALLBACK_PER_REPORT_HOUR, PDF_FALLBACK_INSTANCE_HOUR } from '../route';
import { resetFallbackWindows } from '@/lib/pdf/render-rate-limit';
import { GET as PAGE } from '../../route';
import { renderStoredReportHtml } from '@/lib/market/stored-report-html';
import { REPORT } from './fixture';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (accept = '*/*', ip = '203.0.113.9') => new Request(`https://getmindy.ai/reports/${REPORT.id}/pdf`, { headers: { accept, 'x-forwarded-for': ip } });
const FAKE_PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);

beforeEach(() => {
  getMarketReport.mockReset().mockResolvedValue(REPORT);
  htmlToPdf.mockReset().mockResolvedValue({ pdf: FAKE_PDF, error: null });
  kvCounts.clear();
  kvDown = false;
  kvIncr.mockClear();
  resetFallbackWindows();
});

describe('GET /reports/[id]/pdf — download response', () => {
  it('answers a PDF attachment with a safe file name', async () => {
    const res = await GET(req(), params(REPORT.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="drones-market-report.pdf"');
    expect(res.headers.get('Content-Length')).toBe(String(FAKE_PDF.length));
    expect(res.headers.get('Cache-Control')).toContain('private');
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders the PDF from exactly the HTML the hosted page shows (minus its download link), locked down', async () => {
    await GET(req(), params(REPORT.id));
    expect(htmlToPdf).toHaveBeenCalledTimes(1);
    const [html, opts, mode] = htmlToPdf.mock.calls[0];
    expect(html).toBe(renderStoredReportHtml(REPORT as never));
    expect(opts).toEqual(PDF_OPTIONS);
    expect(mode).toEqual({ lockdown: true });

    const page = await (await PAGE(new Request('https://getmindy.ai/x'), params(REPORT.id))).text();
    const strip = (h: string) => h.replace(/<a class="pdfbtn"[^>]*>Download PDF<\/a>|<button class="pdfbtn"[^>]*>Save as PDF<\/button>/, '');
    expect(strip(page)).toBe(strip(html));
  });

  it('uses the report’s own date, not today’s, so a later download still matches the preview', async () => {
    const [html] = (await GET(req(), params(REPORT.id)), htmlToPdf.mock.calls[0]);
    expect(html).toContain('July 16, 2026');
  });
});

describe('GET /reports/[id]/pdf — visible, actionable errors', () => {
  it('a failed render is a 503 with a message, never a broken PDF', async () => {
    htmlToPdf.mockResolvedValue({ pdf: null, error: 'Error: no browser' });
    const res = await GET(req('application/json'), params(REPORT.id));
    expect(res.status).toBe(503);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Retry-After')).toBe('60');
    const j = await res.json();
    expect(j).toMatchObject({ success: false, error: 'pdf_unavailable' });
    expect(j.message).toMatch(/Try again/);
    expect(JSON.stringify(j)).not.toContain('no browser'); // internals stay in the server log
  });

  it('bytes that are not a PDF are refused the same way', async () => {
    htmlToPdf.mockResolvedValue({ pdf: Buffer.from('<html>not a pdf</html>'.repeat(10)), error: null });
    const res = await GET(req('application/json'), params(REPORT.id));
    expect(res.status).toBe(503);
  });

  it('a link click (no JSON accept) gets a readable page that links back to the report', async () => {
    htmlToPdf.mockResolvedValue({ pdf: null, error: 'x' });
    const res = await GET(req('text/html'), params(REPORT.id));
    expect(res.status).toBe(503);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('PDF not available');
    expect(html).toContain(`href="/reports/${REPORT.id}"`);
  });

  it('malformed and missing ids get the identical 404 (ids cannot be probed)', async () => {
    getMarketReport.mockResolvedValue(null);
    const missing = await GET(req('application/json'), params('abc123abc123abc123abc1'));
    const malformed = await GET(req('application/json'), params('../etc'));
    expect(missing.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(await missing.text()).toBe(await malformed.text());
    expect(htmlToPdf).not.toHaveBeenCalled();
  });

  it('is rate-limited per IP and per report BEFORE a browser starts (KV healthy)', async () => {
    for (let i = 0; i < PDF_LIMIT_PER_IP_HOUR; i++) expect((await GET(req('application/json'), params(REPORT.id))).status).toBe(200);
    htmlToPdf.mockClear(); getMarketReport.mockClear();
    const res = await GET(req('application/json'), params(REPORT.id));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await res.json()).message).toMatch(/Wait a few minutes/);
    expect(htmlToPdf).not.toHaveBeenCalled();
    expect(getMarketReport).not.toHaveBeenCalled();
    expect([...kvCounts.keys()].sort()).toEqual([`rl:report-pdf:id:${REPORT.id}`, 'rl:report-pdf:ip:203.0.113.9']);
  });
});

describe('GET /reports/[id]/pdf — KV unavailable never means "no limit" (owner condition, #2307)', () => {
  it('falls back to the in-process per-IP cap: no Chromium launch beyond it', async () => {
    kvDown = true;
    for (let i = 0; i < PDF_FALLBACK_PER_IP_HOUR; i++) expect((await GET(req('application/json'), params(REPORT.id))).status).toBe(200);
    const res = await GET(req('application/json'), params(REPORT.id));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(htmlToPdf).toHaveBeenCalledTimes(PDF_FALLBACK_PER_IP_HOUR);
  });

  it('enforces the per-report fallback cap across many IPs', async () => {
    kvDown = true;
    for (let i = 0; i < PDF_FALLBACK_PER_REPORT_HOUR; i++) expect((await GET(req('application/json', `198.51.100.${i}`), params(REPORT.id))).status).toBe(200);
    expect((await GET(req('application/json', '198.51.100.200'), params(REPORT.id))).status).toBe(429);
    expect(htmlToPdf).toHaveBeenCalledTimes(PDF_FALLBACK_PER_REPORT_HOUR);
  });

  it('enforces a per-instance cap across all IPs and reports while degraded', async () => {
    kvDown = true;
    let launched = 0;
    for (let i = 0; i < PDF_FALLBACK_INSTANCE_HOUR + 10; i++) {
      const id = `report${String(i).padStart(4, '0')}abcdefghijkl`; // distinct valid ids
      const res = await GET(req('application/json', `192.0.2.${i}`), params(id));
      if (res.status === 200) launched++;
    }
    expect(launched).toBe(PDF_FALLBACK_INSTANCE_HOUR);
    expect(htmlToPdf).toHaveBeenCalledTimes(PDF_FALLBACK_INSTANCE_HOUR);
  });

  it('KV recovering restores normal limits (the fallback is not sticky)', async () => {
    kvDown = true;
    for (let i = 0; i <= PDF_FALLBACK_PER_IP_HOUR; i++) await GET(req('application/json'), params(REPORT.id));
    expect((await GET(req('application/json'), params(REPORT.id))).status).toBe(429);
    kvDown = false;
    expect((await GET(req('application/json'), params(REPORT.id))).status).toBe(200);
  });
});

describe('GET /reports/[id]/pdf — revoked or expired links', () => {
  it('a revoked link answers 410 and never starts Chromium', async () => {
    getMarketReport.mockResolvedValue({ ...REPORT, revoked_at: new Date().toISOString() });
    const res = await GET(req('application/json'), params(REPORT.id));
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ success: false, error: 'link_unavailable' });
    expect(htmlToPdf).not.toHaveBeenCalled();
  });

  it('an expired link answers 410 (HTML for a link click) and never starts Chromium', async () => {
    getMarketReport.mockResolvedValue({ ...REPORT, expires_at: new Date(Date.now() - 1000).toISOString() });
    const res = await GET(req('text/html'), params(REPORT.id));
    expect(res.status).toBe(410);
    const html = await res.text();
    expect(html).toContain('expired or was withdrawn');
    expect(html).not.toContain('drones');
    expect(htmlToPdf).not.toHaveBeenCalled();
  });

  it('the id check and the rate limit still run BEFORE the liveness lookup', async () => {
    const bad = await GET(req('application/json'), params('../x'));
    expect(bad.status).toBe(404);
    expect(getMarketReport).not.toHaveBeenCalled();
    kvDown = true;
    for (let i = 0; i < PDF_FALLBACK_PER_IP_HOUR; i++) await GET(req('application/json'), params(REPORT.id));
    getMarketReport.mockClear();
    expect((await GET(req('application/json'), params(REPORT.id))).status).toBe(429);
    expect(getMarketReport).not.toHaveBeenCalled();
  });
});

describe('build: the route can reach a browser on Vercel', () => {
  it('is listed in next.config.ts outputFileTracingIncludes', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const cfg = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');
    expect(cfg).toContain("'/reports/*/pdf': ['./node_modules/@sparticuz/chromium/bin/**/*']");
  });
});
