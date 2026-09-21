/**
 * The Market Research Determination memo, rendered to print-ready HTML.
 *
 * Feeds the PDF path (HTML → Puppeteer → PDF, the pattern already used by
 * `/api/app/coach/report`) and doubles as the degraded output when Chromium
 * cannot launch — a CO can still Print-to-PDF from the browser, so a
 * Puppeteer failure never leaves them with nothing.
 *
 * Deliberately plain: black text on white, serif body, no color fills, no
 * web fonts. This is a document that gets printed and filed in an acquisition
 * package, not a dashboard — it should look like the memo a contracting
 * officer already writes.
 */

import type { MemoModel } from '@/lib/gov-buyer/memo-model';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function memoToHtml(m: MemoModel): string {
  const sections = m.sections.map((s) => {
    const lead = s.lead ? `<p class="lead">${esc(s.lead)}</p>` : '';
    const paras = s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
    const table = s.table
      ? `<table>
           <thead><tr>${s.table.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
           <tbody>${s.table.rows
             .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
             .join('')}</tbody>
         </table>${s.table.caption ? `<p class="caption">${esc(s.table.caption)}</p>` : ''}`
      : '';
    const notes = s.footnotes?.length
      ? `<ul class="notes">${s.footnotes.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
      : '';
    return `<section><h2>${esc(s.heading)}</h2>${lead}${paras}${table}${notes}</section>`;
  }).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(m.fileBase)}</title>
<style>
  @page { size: Letter; margin: 0.9in; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #111; font-size: 10.5pt; line-height: 1.5; margin: 0; }
  h1 { font-size: 16pt; text-align: center; margin: 0 0 4px; letter-spacing: 0.02em; }
  .sub { text-align: center; font-style: italic; font-size: 11pt; color: #333; margin: 0 0 22px; }
  .meta { margin: 0 0 20px; padding-bottom: 14px; border-bottom: 1px solid #bbb; }
  .meta div { margin: 2px 0; font-size: 9.5pt; }
  h2 { font-size: 11.5pt; margin: 20px 0 8px; padding-bottom: 3px; border-bottom: 1px solid #ddd; page-break-after: avoid; }
  p { margin: 0 0 8px; }
  p.lead { font-weight: bold; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 6px; font-size: 8.5pt; font-family: Arial, Helvetica, sans-serif; page-break-inside: auto; }
  th { text-align: left; border-bottom: 1.5px solid #999; padding: 5px 6px; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.04em; }
  td { border-bottom: 1px solid #e6e6e6; padding: 5px 6px; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .caption { font-size: 8.5pt; font-style: italic; color: #555; margin-top: 2px; }
  ul.notes { margin: 8px 0 0; padding-left: 16px; }
  ul.notes li { font-size: 8.5pt; color: #333; margin-bottom: 5px; line-height: 1.45; }
  .closing { margin-top: 26px; padding-top: 12px; border-top: 1px solid #bbb; font-size: 9pt; font-style: italic; color: #333; }
  section { page-break-inside: auto; }
</style></head>
<body>
  <h1>${esc(m.title)}</h1>
  <p class="sub">${esc(m.subtitle)}</p>
  <div class="meta">
    <div><strong>Date prepared:</strong> ${esc(m.datePrepared)}</div>
    <div><strong>Prepared by:</strong> ${esc(m.preparedBy)}</div>
    <div><strong>Scope of research:</strong> ${esc(m.scope)}</div>
    <div><strong>Data sources:</strong> ${esc(m.dataSources)}</div>
  </div>
  ${sections}
  <p class="closing">${esc(m.closing)}</p>
</body></html>`;
}
