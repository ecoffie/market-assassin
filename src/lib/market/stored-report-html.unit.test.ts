/**
 * The PDF matches the Ask Mindy preview (2026-11-22).
 *
 * generate_market_report renders the preview HTML from its result and saves that same result (minus
 * `deliverable`) with `clientName = generated_for`. /reports/<id> and /reports/<id>/pdf re-render the
 * saved copy with renderStoredReportHtml. These pin that the re-render equals what the customer
 * previewed, apart from the header button: print dialog in the preview, a download link on the hosted
 * page, and print-hidden in the PDF either way.
 */
import { describe, it, expect } from 'vitest';
import { renderMarketReportHtml } from './market-report-html';
import { renderStoredReportHtml, reportDate, reportPdfFileName } from './stored-report-html';
import { REPORT } from '@/app/reports/[id]/pdf/__tests__/fixture';

const stripButton = (h: string) => h.replace(/<a class="pdfbtn"[^>]*>Download PDF<\/a>|<button class="pdfbtn"[^>]*>Save as PDF<\/button>/, '');

describe('stored report HTML = the preview the tool rendered', () => {
  // What generate_market_report holds when it renders the preview (generated_for = client_name).
  const toolResult = { ...REPORT.payload, generated_for: REPORT.client_name, deliverable: { html: '', url: null, report_id: null } };
  // What it saves: the result minus deliverable, client_name alongside.
  const { deliverable: _omit, ...savedPayload } = toolResult;
  const saved = { ...REPORT, payload: savedPayload as Record<string, unknown> };

  it('re-rendering the saved copy gives the same document on the report’s generation day', () => {
    // The tool renders "today", which is the generation day.
    const preview = renderMarketReportHtml(toolResult as never, { date: 'July 16, 2026' });
    expect(stripButton(renderStoredReportHtml(saved as never))).toBe(stripButton(preview));
    expect(stripButton(renderStoredReportHtml(saved as never, { pdfUrl: '/reports/x/pdf' }))).toBe(stripButton(preview));
  });

  it('a later view matches the preview: no generation or freshness date is printed (Eric, 2026-11-27), so nothing drifts', () => {
    const html = renderStoredReportHtml(saved as never);
    expect(html).not.toContain('July 16, 2026');
    expect(html).not.toContain(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
  });

  it('the preview keeps its print button; the hosted page gets the download link', () => {
    expect(renderMarketReportHtml(toolResult as never)).toContain('onclick="window.print()"');
    const hosted = renderStoredReportHtml(saved as never, { pdfUrl: '/reports/abc/pdf' });
    expect(hosted).toContain('<a class="pdfbtn" href="/reports/abc/pdf" download>Download PDF</a>');
    expect(hosted).not.toContain('window.print()');
  });
});

describe('helpers', () => {
  it('reportDate is UTC and tolerates bad input', () => {
    expect(reportDate('2026-07-16T23:30:00.000Z')).toBe('July 16, 2026');
    expect(reportDate('nope')).toBeUndefined();
    expect(reportDate(undefined)).toBeUndefined();
  });

  it('reportPdfFileName is a safe ASCII name', () => {
    expect(reportPdfFileName('Drones & UAS — Navy')).toBe('drones-uas-navy-market-report.pdf');
    expect(reportPdfFileName('"><script>')).toBe('script-market-report.pdf');
    expect(reportPdfFileName('')).toBe('mindy-market-report.pdf');
    expect(reportPdfFileName('é'.repeat(5))).toBe('eeeee-market-report.pdf');
  });
});
