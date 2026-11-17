/**
 * DocModel → a self-contained, print-ready HTML document.
 *
 * The PDF renderer feeds this to Chromium (render-pdf.ts); the same HTML is the printable fallback
 * when Chromium is unavailable and, later, the in-app preview. All model text is escaped: a model is
 * data, never markup. No external fonts, scripts or images are referenced, so rendering makes no
 * network requests.
 */
import type { Block, Claim, DocModel, TableBlock } from './model';
import { chartToSvg } from './charts';
import { assumptionOrigin, citationIndex, citeMarker, claimClass, claimLabel, claimsPresent, formatColumn, formatDocDate, parseInline, unverifiedStatements } from './format';

/**
 * The document page may load nothing but itself: no scripts, no network, no frames; only its own
 * inline styles and data: images. Emitted as the FIRST element of <head> so it governs everything
 * after it — including <link rel="prefetch">, which Chromium issues outside request interception
 * (A4, real-browser probe on #2107), so the PDF lockdown alone does not stop it. The render route
 * sends the same value as an HTTP header on the degraded HTML.
 */
export const DOC_HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inline(text: string): string {
  return parseInline(text)
    .map((r) => {
      const t = escapeHtml(r.text);
      if (r.bold && r.italic) return `<strong><em>${t}</em></strong>`;
      if (r.bold) return `<strong>${t}</strong>`;
      if (r.italic) return `<em>${t}</em>`;
      return t;
    })
    .join('');
}

const CSS = `
@page { size: Letter; margin: 0.9in 0.85in 0.95in 0.85in; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #1f2937; background: #fff; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; }
.doc { max-width: 7.2in; margin: 0 auto; }
.cover { padding: 1.4in 0 0.6in; border-bottom: 3px solid #1e3a8a; margin-bottom: 0.35in; break-after: page; }
.cover .kicker { font-size: 9pt; letter-spacing: .12em; text-transform: uppercase; color: #1e3a8a; font-weight: 700; }
.cover h1 { font-size: 28pt; line-height: 1.15; margin: 10px 0 8px; color: #111827; }
.cover .subtitle { font-size: 13pt; color: #4b5563; margin: 0 0 28px; }
.cover dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; font-size: 10pt; margin: 0; }
.cover dt { color: #6b7280; } .cover dd { margin: 0; }
.reading { margin-top: 0.5in; padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 9pt; color: #374151; background: #f9fafb; }
.reading b { color: #111827; }
.toc { break-after: page; }
.toc h2 { border: 0; }
.toc ol { padding-left: 18px; } .toc li { margin: 4px 0; }
h2 { font-size: 16pt; color: #1e3a8a; margin: 26px 0 10px; padding-bottom: 4px; border-bottom: 1px solid #c7d2fe; break-after: avoid; }
h3 { font-size: 12.5pt; color: #111827; margin: 20px 0 8px; break-after: avoid; }
h4 { font-size: 11pt; color: #111827; margin: 16px 0 6px; break-after: avoid; }
p { margin: 0 0 9px; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 10px; padding-left: 20px; } li { margin: 0 0 4px; }
sup.cite { font-size: 7.5pt; color: #1e3a8a; margin-left: 2px; }
.label { display: inline-block; font-size: 7.5pt; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 1px 6px; border-radius: 3px; margin-right: 6px; vertical-align: 1px; }
.label.assumption { background: #fef3c7; color: #92400e; }
.origin { color: #6b7280; font-style: italic; }
.label.unverified { background: #fee2e2; color: #991b1b; }
.label.recommendation { background: #dcfce7; color: #166534; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 4px; font-size: 9pt; break-inside: auto; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { text-align: left; background: #1e3a8a; color: #fff; font-weight: 600; padding: 6px 8px; }
td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
tbody tr:nth-child(even) td { background: #f8fafc; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
td.na { color: #9ca3af; font-style: italic; }
.caption { font-size: 8.5pt; color: #6b7280; margin: 12px 0 4px; break-after: avoid; }
.tablewrap { margin: 0 0 14px; }
th.num, td.num { white-space: nowrap; }
th { white-space: nowrap; }
figure { margin: 10px 0 14px; break-inside: avoid; }
.callout { border-left: 4px solid #1e3a8a; background: #eef2ff; padding: 10px 14px; margin: 10px 0 14px; border-radius: 0 6px 6px 0; break-inside: avoid; }
.callout.warning { border-color: #b45309; background: #fffbeb; }
.callout.key_finding { border-color: #0f766e; background: #f0fdfa; }
.callout .ct { font-size: 8pt; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #374151; margin-bottom: 3px; }
.pagebreak { break-after: page; }
.sources ol { padding-left: 22px; font-size: 9pt; } .sources li { margin-bottom: 5px; word-break: break-word; }
.sources .meta { color: #6b7280; }
.unverified ol { padding-left: 22px; font-size: 9.5pt; } .unverified li { margin-bottom: 5px; } .unverified .meta { color: #6b7280; }
`;

/** The visible label chip for a claim ('' when the claim carries none). */
function originHtml(u: { claim?: Claim; origin?: string }): string {
  const o = assumptionOrigin(u);
  return o ? ` <span class="origin">${escapeHtml(o)}</span>` : '';
}

function labelChip(claim: Claim | undefined): string {
  const l = claimLabel(claim);
  return l ? `<span class="label ${claimClass(claim)}">${escapeHtml(l)}</span>` : '';
}

function tableHtml(b: TableBlock, marker: string): string {
  const head = b.columns.map((c) => `<th class="${c.align === 'right' || ['usd', 'int', 'pct'].includes(c.format ?? '') ? 'num' : ''}">${escapeHtml(c.label)}</th>`).join('');
  const cells = b.columns.map((c) => formatColumn(b.rows.map((r) => r[c.key] ?? null), c.format));
  const body = b.rows
    .map((r, ri) => `<tr>${b.columns
      .map((c, ci) => {
        const v = r[c.key] ?? null;
        const txt = cells[ci][ri];
        const num = c.align === 'right' || ['usd', 'int', 'pct'].includes(c.format ?? '');
        return `<td class="${[num ? 'num' : '', v === null ? 'na' : ''].filter(Boolean).join(' ')}">${escapeHtml(txt)}</td>`;
      })
      .join('')}</tr>`)
    .join('');
  const cap = [labelChip(b.claim), b.caption ? inline(b.caption) : '', marker ? `<sup class="cite">${marker}</sup>` : ''].filter(Boolean).join(' ') + originHtml(b);
  return `<div class="tablewrap">${cap ? `<div class="caption">${cap}</div>` : ''}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function blockHtml(b: Block, numberOf: (id: string) => number | null): string {
  const lab = (c?: Claim) => labelChip(c);
  const sup = (cites?: string[]) => {
    const m = citeMarker(cites, numberOf);
    return m ? `<sup class="cite">${m}</sup>` : '';
  };
  switch (b.type) {
    case 'paragraph':
      return `<p>${lab(b.claim)}${inline(b.text)}${sup(b.cites)}${originHtml(b)}</p>`;
    case 'bullets': {
      const tag = b.ordered ? 'ol' : 'ul';
      return `<${tag}>${b.items.map((it) => `<li>${lab(it.claim)}${inline(it.text)}${sup(it.cites)}${originHtml(it)}</li>`).join('')}</${tag}>`;
    }
    case 'table':
      return tableHtml(b, citeMarker(b.cites, numberOf));
    case 'chart': {
      const cap = [labelChip(b.claim), b.caption ? inline(b.caption) : '', sup(b.cites)].filter(Boolean).join(' ') + originHtml(b);
      return `<figure>${cap ? `<figcaption class="caption">${cap}</figcaption>` : ''}${chartToSvg(b)}</figure>`;
    }
    case 'callout': {
      const title = b.tone === 'key_finding' ? 'Key finding' : b.tone === 'warning' ? 'Caution' : 'Note';
      return `<div class="callout ${b.tone}"><div class="ct">${title}</div>${lab(b.claim)}${inline(b.text)}${sup(b.cites)}${originHtml(b)}</div>`;
    }
    case 'pagebreak':
      return '<div class="pagebreak"></div>';
  }
}

export interface RenderHtmlOptions {
  /** Include a contents page (default true when there are 4+ sections). */
  toc?: boolean;
}

export function renderHtml(model: DocModel, opts: RenderHtmlOptions = {}): string {
  const { ordered, numberOf } = citationIndex(model);
  const showToc = opts.toc ?? model.sections.length >= 4;
  const present = claimsPresent(model);
  const unverified = unverifiedStatements(model);

  const meta: string[] = [];
  if (model.preparedFor) meta.push(`<dt>Prepared for</dt><dd>${escapeHtml(model.preparedFor)}</dd>`);
  meta.push(`<dt>Date</dt><dd>${escapeHtml(formatDocDate(model.date))}</dd>`);
  meta.push(`<dt>Prepared with</dt><dd>Mindy</dd>`);
  if (ordered.length) meta.push(`<dt>Sources</dt><dd>${ordered.length} cited source${ordered.length === 1 ? '' : 's'}</dd>`);

  const reading = [
    '<b>How to read this document.</b> Facts carry a numbered citation like <sup class="cite">[1]</sup> that points to the Sources section.',
    present.has('assumption') ? 'Statements marked <span class="label assumption">Planning assumption</span> are premises stated for this analysis, not recorded facts; each says where it comes from. Check them before relying on them.' : '',
    present.has('recommendation') ? 'Statements marked <span class="label recommendation">Recommendation</span> are suggested actions.' : '',
    unverified.length ? `Statements marked <span class="label unverified">Unverified — no source</span> could not be traced to a source and are listed in the Unverified statements section.` : '',
  ].filter(Boolean).join(' ');

  const cover = `<section class="cover"><div class="kicker">Report</div><h1>${escapeHtml(model.title)}</h1>${model.subtitle ? `<p class="subtitle">${escapeHtml(model.subtitle)}</p>` : ''}<dl>${meta.join('')}</dl><div class="reading">${reading}</div></section>`;

  const toc = showToc
    ? `<section class="toc"><h2>Contents</h2><ol>${model.sections.filter((s) => (s.level ?? 1) === 1).map((s) => `<li>${escapeHtml(s.heading)}</li>`).join('')}${unverified.length ? '<li>Unverified statements</li>' : ''}${ordered.length ? '<li>Sources</li>' : ''}</ol></section>`
    : '';

  const body = model.sections
    .map((s) => {
      const tag = s.level === 3 ? 'h4' : s.level === 2 ? 'h3' : 'h2';
      return `<section id="${escapeHtml(s.id)}"><${tag}>${escapeHtml(s.heading)}</${tag}>${s.blocks.map((b) => blockHtml(b, numberOf)).join('')}</section>`;
    })
    .join('');

  const unverifiedSection = unverified.length
    ? `<section class="unverified"><h2>Unverified statements</h2><p>These statements appear in the document without a source. Verify each one before relying on it.</p><ol>${unverified
      .map((u) => `<li><span class="meta">${escapeHtml(u.section)}:</span> ${inline(u.text)}</li>`)
      .join('')}</ol></section>`
    : '';

  const sources = ordered.length
    ? `<section class="sources"><h2>Sources</h2><ol>${ordered
      .map((s) => {
        const bits = [escapeHtml(s.label)];
        if (s.recordId) bits.push(`<span class="meta">(${escapeHtml(s.recordId)})</span>`);
        if (s.retrievedAt) bits.push(`<span class="meta">Retrieved ${escapeHtml(s.retrievedAt)}.</span>`);
        if (s.url) bits.push(`<span class="meta">${escapeHtml(s.url)}</span>`);
        return `<li>${bits.join(' ')}</li>`;
      })
      .join('')}</ol></section>`
    : '';

  return `<!doctype html><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="${DOC_HTML_CSP}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(model.title)}</title><style>${CSS}</style></head><body><main class="doc">${cover}${toc}${body}${unverifiedSection}${sources}</main></body></html>`;
}
