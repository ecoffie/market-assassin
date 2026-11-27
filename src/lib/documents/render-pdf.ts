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
import { clientCopy, DOC_STAGE_MARK, keepDash, noEmDash } from './format';
import { CAP_LIMIT_STEPS, extractCapability, isCapabilityStatement } from './capability-statement';
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

/**
 * Capability statement: one Letter page, the margins from its own stylesheet, no running header or footer (no
 * page numbers or stage mark on a leave-behind a contracting officer keeps).
 */
export const CAPABILITY_PDF_OPTIONS: Record<string, unknown> = { format: 'Letter', printBackground: true, displayHeaderFooter: false, preferCSSPageSize: true };

/** Pages in a Chromium PDF (each page object is "/Type /Page"; the tree root is "/Type /Pages"). */
export function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

export async function renderPdf(
  model: DocModel,
  deps: { htmlToPdf: typeof htmlToPdf } = { htmlToPdf },
): Promise<PdfRender> {
  if (isCapabilityStatement(model)) return renderCapabilityPdf(model, deps);
  const html = renderHtml(model);
  // The model's text comes from an LLM and user uploads: render it with JavaScript off and no network
  // (the HTML is self-contained; charts are inline SVG).
  const { pdf, error } = await deps.htmlToPdf(html, pdfOptions(model), { lockdown: true });
  if (!pdf) return { pdf: null, html, error: error || 'pdf_unavailable' };
  return { pdf, html, error: null };
}

/**
 * A capability statement must stay on ONE page: render with the default item limits and, while the PDF runs to a
 * second page, tighten them (CAP_LIMIT_STEPS) and render again. What was trimmed is logged, never silently lost.
 */
async function renderCapabilityPdf(model: DocModel, deps: { htmlToPdf: typeof htmlToPdf }): Promise<PdfRender> {
  let last: PdfRender = { pdf: null, html: '', error: 'pdf_unavailable' };
  for (let i = 0; i < CAP_LIMIT_STEPS.length; i++) {
    const html = renderHtml(model, { capLimits: CAP_LIMIT_STEPS[i] });
    const { pdf, error } = await deps.htmlToPdf(html, CAPABILITY_PDF_OPTIONS, { lockdown: true });
    if (!pdf) return { pdf: null, html, error: error || 'pdf_unavailable' };
    last = { pdf, html, error: null };
    const pages = pdfPageCount(pdf);
    const trimmed = extractCapability(clientCopy(model), CAP_LIMIT_STEPS[i]).trimmed;
    if (pages <= 1) {
      if (trimmed.length) console.info('[capability-statement] trimmed to fit one page', { step: i, trimmed });
      return last;
    }
    console.warn('[capability-statement] over one page, tightening', { step: i, pages });
  }
  console.warn('[capability-statement] still over one page at the tightest limits; returning the last render');
  return last;
}
