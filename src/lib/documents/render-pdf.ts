/**
 * DocModel → PDF: render-html.ts, then headless Chromium via the shared launcher
 * (src/lib/pdf/launch-browser.ts: @sparticuz/chromium + puppeteer-core on Vercel, full puppeteer
 * locally). Chromium output is real, selectable text with vector charts.
 *
 * Locked down: JavaScript off and every request except about:blank / data: aborted (htmlToPdf
 * `lockdown`). Scoped to this renderer; other callers of the shared launcher are unchanged.
 *
 * Never silent: when no browser can start, the result carries `pdf: null`, the reason, and the same
 * HTML so the caller can return a printable page WITH a degrade header. A route that launches
 * Chromium must be listed in next.config.ts `outputFileTracingIncludes`, or the binary never reaches
 * the function.
 */
import type { DocModel } from './model';
import { renderHtml, escapeHtml } from './render-html';
import { DOC_STAGE_MARK, keepDash, noEmDash } from './format';
export { DOC_STAGE_MARK };
import { htmlToPdf } from '@/lib/pdf/launch-browser';

export interface PdfRender {
  pdf: Buffer | null;
  html: string;
  /** Why the PDF could not be produced (null on success). */
  error: string | null;
}

/** Page header + "Page X of Y" footer. Chromium substitutes the classed spans. */

export function pdfOptions(model: DocModel): Record<string, unknown> {
  const t = noEmDash(model.title, 'heading');
  const title = escapeHtml(keepDash(t.length > 90 ? `${t.slice(0, 89)}…` : t));
  const style = 'font-family: Helvetica, Arial, sans-serif; font-size: 7.5pt; color: #6b7280; width: 100%; padding: 0 0.85in;';
  return {
    format: 'Letter',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="${style} display:flex; justify-content:space-between;"><span>${title}</span><span>Prepared with Mindy</span></div>`,
    footerTemplate: `<div style="${style} text-align:center;">Page <span class="pageNumber"></span> of <span class="totalPages"></span>${DOC_STAGE_MARK ? ` &nbsp;&middot;&nbsp; ${escapeHtml(DOC_STAGE_MARK)}` : ''}</div>`,
    margin: { top: '0.9in', right: '0.85in', bottom: '0.95in', left: '0.85in' },
  };
}

export async function renderPdf(
  model: DocModel,
  deps: { htmlToPdf: typeof htmlToPdf } = { htmlToPdf },
): Promise<PdfRender> {
  const html = renderHtml(model);
  // The model's text comes from an LLM and user uploads: render it with JavaScript off and no network
  // (the HTML is self-contained; charts are inline SVG).
  const { pdf, error } = await deps.htmlToPdf(html, pdfOptions(model), { lockdown: true });
  if (!pdf) return { pdf: null, html, error: error || 'pdf_unavailable' };
  return { pdf, html, error: null };
}
