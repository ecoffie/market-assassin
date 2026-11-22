/**
 * Market report PDF regression suite (Design & Output, 2026-11-22).
 *
 * A professional deliverable must keep every section, every figure and every source line the report holds,
 * download as a real file, and print tables a reader can read. This suite pins those on a FULL report
 * (every section populated, real-report sizes, synthetic names) through the production route and renderer.
 * Layout targets (pagination, page numbers) are added by the print-layout PR that changes them.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { FULL_REPORT } from '@/lib/market/__fixtures__/market-report-full';
import { CHROME, PDFTOTEXT, launch, pdfPages, htmlLines, printLayout, squash, norm, lettersOnly } from './report-harness';

const getMarketReport = vi.fn();
vi.mock('@/lib/market/report-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/market/report-store')>()),
  getMarketReport: (id: string) => getMarketReport(id),
}));
// The real route launches Chromium through launchBrowser(); point it at the harness browser.
vi.mock('@/lib/pdf/launch-browser', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/pdf/launch-browser')>();
  return { ...real, htmlToPdf: (h: string, o: Record<string, unknown>, opts: Record<string, unknown> = {}) => real.htmlToPdf(h, o, { ...opts, launch }) };
});
vi.mock('@vercel/kv', () => ({ kv: { incr: async () => 1, expire: async () => 1, ttl: async () => 3600 } }));

import { GET } from '@/app/reports/[id]/pdf/route';
import { renderStoredReportHtml } from '@/lib/market/stored-report-html';

/** Letter (8.5in) minus the route's 0.5in side margins, at 96 CSS px per inch. */
const PDF_CONTENT_WIDTH_PX = (8.5 - 1) * 96;

/**
 * Print defects present on main when this suite landed (2026-11-22). Whether each one shows depends on font
 * metrics (the report uses the system font stack: it reproduces with the cloud sessions' Chromium, not with the
 * fonts on GitHub's runner), so the suite allows ONLY these and fails on anything else. The print-layout PR that
 * fixes them empties these lists, which makes every check strict. Each is material the
 * reader loses in the PDF only (the hosted page shows it): the headline's basis is cut by an ellipsis,
 * and the Recompetes table is wider than the page, so its Likelihood column is clipped off.
 */
/** Anything found that is not a known defect. */
const unexpected = (found: string[], known: string[]) => found.filter((x) => !known.includes(x));

const KNOWN_PRINT_DEFECTS = {
  missingLines: ['FY2026 (1 complete fiscal year · description match)', 'Likelihood', 'high', 'medium'],
  overflowingTables: ['Recompetes on the horizon'],
  clippedText: ['FY2026 (1 complete fiscal year · description match)', 'HOUSEKEEPING- CUSTODIAL JANITORIAL'],
};

/** Section headings this report must carry, in reading order. Each one is backed by data in the fixture. */
const SECTIONS = [
  'Market composition',
  'How to reconcile this with a NAICS-based tool',
  'Who is buying',
  'Who to call',
  'Competitive landscape',
  'Recompetes on the horizon',
  'Upcoming forecasts',
];

describe.runIf(!!CHROME)('market report PDF — full report', () => {
  let pdf: Buffer;
  let pages: string[];
  const html = renderStoredReportHtml(FULL_REPORT as never);

  beforeAll(async () => {
    getMarketReport.mockResolvedValue(FULL_REPORT);
    const res = await GET(
      new Request(`https://getmindy.ai/reports/${FULL_REPORT.id}/pdf`, { headers: { 'x-forwarded-for': '203.0.113.20' } }),
      { params: Promise.resolve({ id: FULL_REPORT.id }) },
    );
    expect(res.status, await res.clone().text().then((t) => t.slice(0, 200))).toBe(200);
    pdf = Buffer.from(await res.arrayBuffer());
    pages = await pdfPages(pdf);
  }, 90_000);

  it('downloads as a real PDF attachment', () => {
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-8).toString('latin1')).toContain('%%EOF');
    expect(pages.length).toBeGreaterThanOrEqual(1);
  });

  it('carries every section, in reading order', () => {
    const text = squash(pages.join('\n'));
    const at = SECTIONS.map((h) => text.indexOf(squash(h)));
    expect(SECTIONS.filter((_, i) => at[i] < 0), 'sections missing from the PDF').toEqual([]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('omits nothing the report shows: every visible line is in the PDF', () => {
    const lines = htmlLines(html);
    expect(lines.length).toBeGreaterThan(100);
    if (PDFTOTEXT) {
      const all = squash(execFileSync(PDFTOTEXT, ['-enc', 'UTF-8', '-', '-'], { input: pdf, encoding: 'utf8' }));
      expect(unexpected(lines.filter((l) => !all.includes(squash(l))), KNOWN_PRINT_DEFECTS.missingLines)).toEqual([]);
    } else {
      // pdf.js drops tabular digits: compare letters only. A short line ("high") is found inside other words by a
      // letters-only search, so it proves nothing either way; only lines of 8+ letters are compared here.
      const all = lettersOnly(pages.join(''));
      const comparable = (l: string) => lettersOnly(l).length >= 8;
      expect(unexpected(lines.filter((l) => comparable(l) && !all.includes(lettersOnly(l))), KNOWN_PRINT_DEFECTS.missingLines)).toEqual([]);
    }
  });

  it('keeps every person, contractor, recompete and forecast row', () => {
    const text = norm(pages.join('\n'));
    const s = FULL_REPORT.payload.sections;
    const names = [
      ...s.contacts.people.map((p) => p.email),
      ...s.competition.contractors.map((c) => c.recipient_name),
      ...s.recompetes.contracts.map((c) => c.incumbent_name),
      ...s.forecasts.forecasts.map((f) => f.title),
      ...s.top_agencies.map((a) => a.name),
    ];
    expect(names.filter((n) => !text.includes(norm(n)))).toEqual([]);
  });

  it('never prints a blank page', () => {
    expect(pages.map((p, i) => [i + 1, p.trim().length] as const).filter(([, n]) => n === 0)).toEqual([]);
  });

  it('prints tables a reader can read: nothing clipped, no cell under 9px', async () => {
    const layout = await printLayout(html, PDF_CONTENT_WIDTH_PX);
    expect(unexpected(layout.overflowingTables, KNOWN_PRINT_DEFECTS.overflowingTables), 'tables wider than the printed page').toEqual([]);
    expect(unexpected(layout.clippedText, KNOWN_PRINT_DEFECTS.clippedText), 'text cut off by an ellipsis or line clamp in print').toEqual([]);
    expect(layout.minCellFontPx).toBeGreaterThanOrEqual(9);
  }, 60_000);
});

describe.runIf(!CHROME)('market report PDF — full report (skipped: no Chromium binary here)', () => {
  it.skip('needs PUPPETEER_EXECUTABLE_PATH, /opt/pw-browsers/chromium or /usr/bin/google-chrome', () => {});
});
