/**
 * The document engine's public surface. Features produce a DocModel (directly or through their own
 * adapter) and call renderDocument; they never reach into a renderer.
 */
import type { DocModel } from './model';
import { validateDocModel, type ValidationIssue } from './validate';
import { renderDocx } from './render-docx';
import { renderPdf } from './render-pdf';
import { renderHtml } from './render-html';
import { fileBaseName } from './format';

export type DocFormat = 'pdf' | 'docx' | 'html';

export const DOC_MIME: Record<DocFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  html: 'text/html; charset=utf-8',
};

export type RenderOutcome =
  | { ok: true; format: DocFormat; bytes: Buffer; mime: string; filename: string; degraded: null }
  /** PDF requested but no browser could start: printable HTML instead, with the reason. Never silent. */
  | { ok: true; format: 'html'; bytes: Buffer; mime: string; filename: string; degraded: { requested: 'pdf'; reason: string } }
  | { ok: false; issues: ValidationIssue[] };

export async function renderDocument(input: unknown, format: DocFormat): Promise<RenderOutcome> {
  const v = validateDocModel(input);
  if (!v.ok) return { ok: false, issues: v.issues };
  const model: DocModel = v.model;
  const base = fileBaseName(model.title);
  if (format === 'docx') {
    return { ok: true, format, bytes: await renderDocx(model), mime: DOC_MIME.docx, filename: `${base}.docx`, degraded: null };
  }
  if (format === 'html') {
    return { ok: true, format, bytes: Buffer.from(renderHtml(model), 'utf-8'), mime: DOC_MIME.html, filename: `${base}.html`, degraded: null };
  }
  const r = await renderPdf(model);
  if (r.pdf) return { ok: true, format: 'pdf', bytes: r.pdf, mime: DOC_MIME.pdf, filename: `${base}.pdf`, degraded: null };
  return {
    ok: true, format: 'html', bytes: Buffer.from(r.html, 'utf-8'), mime: DOC_MIME.html, filename: `${base}.html`,
    degraded: { requested: 'pdf', reason: r.error || 'pdf_unavailable' },
  };
}

export type { DocModel } from './model';
export { validateDocModel, demoteUncitedFacts } from './validate';
