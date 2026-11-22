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
const checkRateLimit = vi.fn();
vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
}));

import { GET, PDF_OPTIONS } from '../route';
import { GET as PAGE } from '../../route';
import { renderStoredReportHtml } from '@/lib/market/stored-report-html';
import { REPORT } from './fixture';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (accept = '*/*') => new Request(`https://getmindy.ai/reports/${REPORT.id}/pdf`, { headers: { accept, 'x-forwarded-for': '203.0.113.9' } });
const FAKE_PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF')]);
const allowed = { allowed: true, remaining: 10, limit: 20, resetAt: Math.floor(Date.now() / 1000) + 3600 };

beforeEach(() => {
  getMarketReport.mockReset().mockResolvedValue(REPORT);
  htmlToPdf.mockReset().mockResolvedValue({ pdf: FAKE_PDF, error: null });
  checkRateLimit.mockReset().mockResolvedValue(allowed);
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

  it('is rate-limited per IP and per report BEFORE a browser starts', async () => {
    checkRateLimit.mockImplementation(async (key: string) => (key.startsWith('report-pdf:ip:') ? { ...allowed, allowed: false } : allowed));
    const res = await GET(req('application/json'), params(REPORT.id));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await res.json()).message).toMatch(/Wait a few minutes/);
    expect(htmlToPdf).not.toHaveBeenCalled();
    expect(getMarketReport).not.toHaveBeenCalled();
    const keys = checkRateLimit.mock.calls.map((c) => c[0]);
    expect(keys).toEqual([`report-pdf:ip:203.0.113.9`, `report-pdf:id:${REPORT.id}`]);
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
