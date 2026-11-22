/**
 * One way to turn a STORED market report into HTML, so every view and export of /reports/<id> reads the
 * same thing: the hosted page and its PDF download both call this.
 *
 * It reuses the shared renderer (renderMarketReportHtml), which is also what generate_market_report used
 * to build the HTML shown in Ask Mindy's report pane. The date is the report's own generation date, not
 * today's date, so a PDF made a week later still matches what the customer previewed.
 */
import { renderMarketReportHtml } from './market-report-html';
import type { SavedReport } from './report-store';

type ReportLike = Parameters<typeof renderMarketReportHtml>[0];

/** "November 22, 2026" from the stored generated_at; undefined (renderer falls back to today) if absent. */
export function reportDate(generatedAt: unknown): string | undefined {
  if (typeof generatedAt !== 'string') return undefined;
  const d = new Date(generatedAt);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function renderStoredReportHtml(report: SavedReport, opts: { pdfUrl?: string } = {}): string {
  const payload = report.payload as Record<string, unknown>;
  return renderMarketReportHtml(
    {
      ...payload,
      generated_for: report.client_name ?? (payload as { generated_for?: string | null }).generated_for ?? null,
    } as ReportLike,
    { date: reportDate(payload.generated_at), pdfUrl: opts.pdfUrl },
  );
}

/** ASCII file name for the download: "<subject>-market-report.pdf". */
export function reportPdfFileName(subject: unknown): string {
  const slug = String(subject ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'mindy'}-market-report.pdf`;
}
