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
import { CHROME, PDFTOTEXT, launch, pdfPages, htmlLines, printLayout, squash, norm } from './report-harness';

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

/** Anything found that is not a known defect. */
const unexpected = (found: string[], known: string[]) => found.filter((x) => !known.includes(x));

/**
 * Print defects this suite found when it was written (2026-11-22): the headline's basis cut by an ellipsis, the
 * top PSC name line-clamped, and the Recompetes table wider than the page (its Likelihood column clipped off).
 * Fixed on main by #2362 and #2360 and measured here with the real renderer: these lists stay EMPTY, so every
 * check is strict. Anything added here is material a PDF reader loses.
 */
const KNOWN_PRINT_DEFECTS = { missingLines: [] as string[], overflowingTables: [] as string[], clippedText: [] as string[] };

/** Pages the full fixture may use. It printed 8 (two of them a third full or less) before the layout fix. */
const PAGE_BUDGET = 6;

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
      // The running footer is printed on every page; drop it so a paragraph that continues on the next page
      // still reads as one line.
      const all = squash(execFileSync(PDFTOTEXT, ['-enc', 'UTF-8', '-', '-'], { input: pdf, encoding: 'utf8' })
        .replace(/Mindy · Federal market report · .*|Page \d+ of \d+/g, ''));
      expect(unexpected(lines.filter((l) => !all.includes(squash(l))), KNOWN_PRINT_DEFECTS.missingLines)).toEqual([]);
    } else {
      // pdf.js drops tabular digits and can extract a wrapped line out of reading order (after a page header),
      // so the fallback compares WORDS: a line counts as present when each of its words (4+ letters) appears in
      // the PDF. A truncated word ("descripti…") or a clipped column still fails.
      const words = (x: string) => x.toLowerCase().match(/[a-z]{4,}/g) ?? [];
      const inPdf = new Set(words(pages.join(' ')));
      const missing = lines.filter((l) => words(l).length > 0 && !words(l).every((w) => inPdf.has(w)));
      expect(unexpected(missing, KNOWN_PRINT_DEFECTS.missingLines)).toEqual([]);
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

  it('numbers every page: "Page X of Y" on each', () => {
    expect(pages.map((p, i) => squash(p).includes(squash(`Page ${i + 1} of ${pages.length}`))).every(Boolean)).toBe(true);
  });

  it('does not waste pages: no near-empty page, no page holding only the closing footer, within budget', () => {
    const footer = /Mindy · Federal market report.*|Page \d+ of \d+/g;
    const body = pages.map((p) => p.replace(footer, '').replace(/\s+/g, ' ').trim());
    const sizes = body.map((b) => b.length);
    const median = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)];
    // Every page but the last is at least 40% as full as a typical page.
    expect(sizes.slice(0, -1).map((n, i) => [i + 1, n] as const).filter(([, n]) => n < median * 0.4)).toEqual([]);
    // The last page carries report content, not only "Powered by Mindy …".
    expect(squash(body[body.length - 1].replace(/Powered by Mindy[\s\S]*$/, '')).length).toBeGreaterThan(80);
    expect(pages.length).toBeLessThanOrEqual(PAGE_BUDGET);
  });

  it('keeps every section heading with its content (no heading at the foot of a page)', () => {
    const lastLine = (p: string) => p.replace(/Mindy · Federal market report.*|Page \d+ of \d+/g, '').trim().split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
    expect(pages.map((p, i) => [i + 1, lastLine(p)] as const).filter(([, l]) => SECTIONS.some((h) => squash(l) === squash(h)))).toEqual([]);
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
