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
import { hex, resolveTheme, type Theme } from './theme';
import { INTER_LATIN_FONT_FACE } from '@/lib/fonts/inter-latin-embedded';
import { assumptionOrigin, clientCopy, keepDash, stripHeadingNumber, citationIndex, citeMarker, claimClass, claimLabel, claimsPresent, formatColumn, formatDocDate, parseInline, unverifiedStatements } from './format';

/**
 * The document page may load nothing but itself: no scripts, no network, no frames; only its own
 * inline styles and data: images. Emitted as the FIRST element of <head> so it governs everything
 * after it — including <link rel="prefetch">, which Chromium issues outside request interception
 * (A4, real-browser probe on #2107), so the PDF lockdown alone does not stop it. The render route
 * sends the same value as an HTTP header on the degraded HTML.
 */
export const DOC_HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

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

/**
 * The page stylesheet, built ONLY from theme tokens (theme.ts) — no color is hard-coded here, so a
 * preset restyles the whole PDF. Structure and class names are the same for every theme.
 */
function themeCss(t: Theme): string {
  const c = (k: Exclude<keyof Theme['colors'], 'caution' | 'keyMessage' | 'note' | 'recommendation' | 'assumption' | 'unverified' | 'chart'>) => hex(t.colors[k]);
  const k = t.colors;
  const band = t.headingStyle === 'band';
  const r = t.table.headerRadiusPx;
  return `
${INTER_LATIN_FONT_FACE}
@page { size: Letter; margin: 0.9in 0.85in 0.95in 0.85in; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: ${c('pageBg')}; }
body { margin: 0; color: ${c('ink')}; background: ${c('pageBg')}; font-family: 'Mindy Report Inter', ${t.fonts.pdf}; font-size: 10.5pt; line-height: 1.5; }
.doc { max-width: 7.2in; margin: 0 auto; }
.cover { padding: ${t.cover === 'rule' ? '0.3in' : '0.05in'} 0 0.1in; margin-bottom: 0.25in; }
.cover.rule .titleblock { border-bottom: 2px solid ${c('accent2')}; padding-bottom: 18px; }
.brandband { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-radius: 12px; padding: 16px 20px; margin-bottom: 0.45in; color: ${c('white')}; background: linear-gradient(90deg, ${hex((t.gradient ?? [k.accent, k.accent])[0])}, ${hex((t.gradient ?? [k.accent, k.accent])[1])}); }
.brandband .mark { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 8px; background: ${c('white')}; color: ${c('accent')}; font-weight: 800; font-size: 18pt; margin-right: 12px; }
.brandband .who { display: flex; align-items: center; }
.brandband .name { font-weight: 700; font-size: 13pt; line-height: 1.1; }
.brandband .tag { font-size: 7.5pt; letter-spacing: .14em; font-weight: 600; opacity: .9; }
.brandband .contact { text-align: right; font-size: 8.5pt; line-height: 1.4; opacity: .95; }
.cover .kicker { font-size: 9pt; letter-spacing: .12em; text-transform: uppercase; color: ${c('accent2')}; font-weight: 700; }
.cover h1 { font-size: 28pt; line-height: 1.15; margin: 10px 0 8px; color: ${c('title')}; }
.cover .subtitle { font-size: 13pt; color: ${c('meta')}; margin: 0 0 28px; }
.cover dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; font-size: 10pt; margin: 0; }
.cover dt { color: ${c('meta')}; } .cover dd { margin: 0; color: ${c('meta')}; }
.cover .card { background: ${c('panelBg')}; border: 1px solid ${c('rule')}; border-radius: 10px; padding: 14px 18px; }
.cover .card dt { color: ${c('accent')}; font-weight: 700; } .cover .card dd { color: ${c('ink')}; }
.reading { margin-top: 0.22in; padding: 12px 14px; border: 1px solid ${c('rule')}; border-radius: 6px; font-size: 9pt; color: ${c('meta')}; background: ${c('panelBg')}; }
.reading b { color: ${c('ink')}; }
.letterhead .lh { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 12px; margin-bottom: 0.3in; border-bottom: 2px solid ${c('accent2')}; }
.letterhead .who { display: flex; align-items: center; }
.letterhead .mark { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 7px; background: ${c('accent2')}; color: ${c('white')}; font-weight: 800; font-size: 15pt; margin-right: 10px; }
.letterhead .name { font-weight: 700; font-size: 13pt; line-height: 1.1; color: ${c('accent')}; }
.letterhead .tag { font-size: 7pt; letter-spacing: .14em; font-weight: 600; color: ${c('accent2')}; }
.letterhead .contact { text-align: right; font-size: 8pt; line-height: 1.45; color: ${c('muted')}; }
.letterhead h1 { font-size: 21pt; margin: 0 0 4px; }
.letterhead .byline { font-size: 9.5pt; color: ${c('meta')}; margin: 0 0 16px; }
.letterhead dl.card { display: grid; grid-template-columns: 1.7in 1fr; gap: 0; padding: 0; border-radius: 0; font-size: 9.5pt; }
.letterhead dl.card dt, .letterhead dl.card dd { padding: 7px 12px; border-bottom: 1px solid ${c('rule')}; }
.letterhead dl.card dt { background: ${c('rowFill')}; }
ul.checklist { list-style: none; padding-left: 4px; }
ul.checklist li { position: relative; padding-left: 24px; margin: 5px 0; }
ul.checklist li::before { content: ''; position: absolute; left: 0; top: 0.22em; width: 11px; height: 11px; border: 1.5px solid ${c('accent2')}; border-radius: 2px; }
.toc { break-after: auto; margin-bottom: 0.2in; }
.toc ol { list-style: none; padding-left: 0; } .toc li { margin: 4px 0; }
.toc li .n { display: inline-block; width: 2em; color: ${c('accent')}; font-weight: 600; }
${band
    ? `h2 { background: ${c('accent')}; color: ${c('white')}; text-transform: uppercase; letter-spacing: .06em; font-size: 12pt; padding: 7px 12px; margin: 26px 0 12px; break-after: avoid; }`
    : `h2 { font-size: 15pt; color: ${c('accent')}; margin: 26px 0 10px; padding-bottom: 5px; border-bottom: 1px solid ${c('rule')}; break-after: avoid; }
h2 .num { margin-right: 8px; }`}
h3 { font-size: 12.5pt; color: ${c('accent')}; margin: 20px 0 8px; break-after: avoid; }
h4 { font-size: 11pt; color: ${c('accent')}; margin: 16px 0 6px; break-after: avoid; }
p { margin: 0 0 9px; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 10px; padding-left: 20px; } li { margin: 0 0 4px; }
em { color: ${c('accent')}; }
sup.cite { font-size: 7.5pt; color: ${c('accent')}; margin-left: 2px; }
.label { display: inline-block; font-size: 7.5pt; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 1px 6px; border-radius: 3px; margin-right: 6px; vertical-align: 1px; }
.label.assumption { background: ${hex(k.assumption.fill)}; color: ${hex(k.assumption.text)}; }
.origin { color: ${c('muted')}; font-style: italic; }
.label.unverified { background: ${hex(k.unverified.fill)}; color: ${hex(k.unverified.text)}; }
.label.recommendation { background: ${hex(k.recommendation.fill)}; color: ${hex(k.recommendation.text)}; box-shadow: inset 0 0 0 1px ${hex(k.recommendation.border)}; }
table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 6px 0 4px; font-size: 9pt; break-inside: auto; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { text-align: left; background: ${c('tableHeaderBg')}; color: ${c('tableHeaderFg')}; font-weight: 700; padding: 6px 8px; vertical-align: bottom; overflow-wrap: break-word;${t.table.uppercaseHeader ? ' text-transform: uppercase; letter-spacing: .04em; font-size: 7.8pt;' : ''} }
${r ? `th:first-child { border-top-left-radius: ${r}px; } th:last-child { border-top-right-radius: ${r}px; }` : ''}
td { overflow-wrap: anywhere; padding: 5px 8px; border-bottom: 1px solid ${c('rule')}; vertical-align: top; background: ${c('panelBg')}; }
tbody tr:nth-child(even) td { background: ${c('rowFill')}; }
${t.table.boldFirstColumn ? `td:first-child { font-weight: 600; color: ${c('accent')}; }` : ''}
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
td.num { white-space: nowrap; overflow-wrap: normal; }
table.wide { font-size: 8pt; } table.wide th, table.wide td { padding: 4px 5px; }
td.na { color: ${c('na')}; font-style: italic; }
.caption { font-size: 8.5pt; color: ${c('muted')}; margin: 12px 0 4px; break-after: avoid; }
.tablewrap { margin: 0 0 14px; }
figure { margin: 10px 0 14px; break-inside: avoid; }
.callout { border-left: 4px solid ${hex(k.note.border)}; background: ${hex(k.note.fill)}; color: ${hex(k.note.text)}; padding: 10px 14px; margin: 10px 0 14px; border-radius: 0 6px 6px 0; break-inside: avoid; }
.callout.warning { border-color: ${hex(k.caution.border)}; background: ${hex(k.caution.fill)}; color: ${hex(k.caution.text)}; font-weight: 700; }
.callout.key_finding { border-color: ${hex(k.keyMessage.border)}; background: ${hex(k.keyMessage.fill)}; color: ${hex(k.keyMessage.text)}; font-size: 11.5pt; }
.callout .ct { font-size: 8pt; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: ${c('accent')}; margin-bottom: 3px; }
.callout.warning .ct { color: ${hex(k.caution.text)}; }
.pagebreak { break-after: page; }
.sources ol { padding-left: 22px; font-size: 9pt; } .sources li { margin-bottom: 5px; word-break: break-word; }
.sources .meta { color: ${c('muted')}; }
.unverified ol { padding-left: 22px; font-size: 9.5pt; } .unverified li { margin-bottom: 5px; } .unverified .meta { color: ${c('muted')}; }
`;
}

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
  return `<div class="tablewrap">${cap ? `<div class="caption">${cap}</div>` : ''}<table${b.columns.length >= 6 ? ' class="wide"' : ''}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function blockHtml(b: Block, numberOf: (id: string) => number | null, theme: Theme): string {
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
      const cls = !b.ordered && b.style === 'checklist' ? ' class="checklist"' : '';
      return `<${tag}${cls}>${b.items.map((it) => `<li>${lab(it.claim)}${inline(it.text)}${sup(it.cites)}${originHtml(it)}</li>`).join('')}</${tag}>`;
    }
    case 'table':
      return tableHtml(b, citeMarker(b.cites, numberOf));
    case 'chart': {
      const cap = [labelChip(b.claim), b.caption ? inline(b.caption) : '', sup(b.cites)].filter(Boolean).join(' ') + originHtml(b);
      return `<figure>${cap ? `<figcaption class="caption">${cap}</figcaption>` : ''}${chartToSvg(b, 640, theme)}</figure>`;
    }
    case 'callout': {
      const title = b.tone === 'key_finding' ? 'Key finding' : b.tone === 'warning' ? 'Caution' : 'Note';
      return `<div class="callout ${b.tone}"><div class="ct">${title}</div>${lab(b.claim)}${inline(b.text)}${sup(b.cites)}${originHtml(b)}</div>`;
    }
    case 'pagebreak':
      return '<div class="pagebreak"></div>';
  }
}

/** Appended after the print stylesheet for on-screen reading (RenderHtmlOptions.screen). */
const SCREEN_CSS = `
body { padding: 20px 24px 40px; }
.doc { max-width: 8.4in; }
.cover { break-after: auto; padding-top: 0.15in; padding-bottom: 0.2in; margin-bottom: 0.2in; }
.cover.rule { padding-top: 0.3in; }
.toc { break-after: auto; }
.pagebreak { break-after: auto; margin: 0; }
.tablewrap { overflow-x: auto; }
`;

/**
 * Contents list threshold. Professional strategy plans of 15+ sections read without one; a contents list on
 * a short document only adds a near-empty page. Long documents still get it, inline after the cover.
 */
export const TOC_MIN_SECTIONS = 12;

export interface RenderHtmlOptions {
  /** Include a contents list (default: only long documents, TOC_MIN_SECTIONS+ top-level sections). It never forces a page of its own. */
  toc?: boolean;
  /**
   * On-screen reading (the Map's in-chat report pane) instead of print: same markup and theme, but the
   * page gets side padding and no forced page breaks after the cover and contents.
   */
  screen?: boolean;
}

export function renderHtml(stored: DocModel, opts: RenderHtmlOptions = {}): string {
  const model = clientCopy(stored);
  const theme = resolveTheme(model.theme);
  const { ordered, numberOf } = citationIndex(model);
  const showToc = opts.toc ?? model.sections.filter((s) => (s.level ?? 1) === 1).length >= TOC_MIN_SECTIONS;
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
    unverified.length ? `Statements marked <span class="label unverified">Unverified: no source</span> could not be traced to a source and are listed in the Unverified statements section.` : '',
  ].filter(Boolean).join(' ');

  // Cover. Both styles use ONLY the model's own metadata — nothing is generated for the cover.
  const brand = theme.brand;
  const card: string[] = [];
  if (model.preparedFor) card.push(`<dt>Prepared for</dt><dd>${escapeHtml(model.preparedFor)}</dd>`);
  if (typeof model.meta?.attention === 'string' && model.meta.attention.trim()) card.push(`<dt>Attention</dt><dd>${escapeHtml(model.meta.attention)}</dd>`);
  card.push(`<dt>Prepared by</dt><dd>${escapeHtml(brand.name)}</dd>`);
  if (model.subtitle) card.push(`<dt>What this is</dt><dd>${escapeHtml(model.subtitle)}</dd>`);
  card.push(`<dt>Date</dt><dd>${escapeHtml(formatDocDate(model.date))}</dd>`);
  if (ordered.length) card.push(`<dt>Sources</dt><dd>${ordered.length} cited source${ordered.length === 1 ? '' : 's'}</dd>`);
  const byline = [model.preparedFor ? `Prepared for ${escapeHtml(model.preparedFor)}` : '', escapeHtml(formatDocDate(model.date))].filter(Boolean).join(' · ');
  const cover = theme.cover === 'letterhead'
    ? `<section class="cover letterhead"><div class="lh"><div class="who"><span class="mark">${escapeHtml(brand.mark)}</span><div><div class="name">${escapeHtml(brand.name)}</div><div class="tag">${escapeHtml(brand.tagline)}</div></div></div><div class="contact">${brand.contactLines.map(escapeHtml).join('<br>')}</div></div><h1>${escapeHtml(keepDash(model.title))}</h1><p class="byline">${byline}</p><dl class="card">${card.join('')}</dl><div class="reading">${reading}</div></section>`
    : theme.cover === 'brand-band'
    ? `<section class="cover brand"><div class="brandband"><div class="who"><span class="mark">${escapeHtml(brand.mark)}</span><div><div class="name">${escapeHtml(brand.name)}</div><div class="tag">${escapeHtml(brand.tagline)}</div></div></div><div class="contact">${brand.contactLines.map(escapeHtml).join('<br>')}</div></div><h1>${escapeHtml(keepDash(model.title))}</h1>${model.subtitle ? `<p class="subtitle">${escapeHtml(model.subtitle)}</p>` : ''}<dl class="card">${card.join('')}</dl><div class="reading">${reading}</div></section>`
    : `<section class="cover rule"><div class="titleblock"><div class="kicker">Report</div><h1>${escapeHtml(keepDash(model.title))}</h1>${model.subtitle ? `<p class="subtitle">${escapeHtml(model.subtitle)}</p>` : ''}<dl>${meta.join('')}</dl></div><div class="reading">${reading}</div></section>`;

  // Contents numbers a section only when the body does (numbered-rule themes), with the SAME numbers
  // and from the same heading text; Unverified statements and Sources are unnumbered in the body, so
  // they are unnumbered here too (the old auto-numbered <ol> counted them and disagreed with the body).
  const numbered = theme.headingStyle === 'numbered-rule';
  let tocNo = 0;
  const toc = showToc
    ? `<section class="toc"><h2>Contents</h2><ol>${model.sections.filter((s) => (s.level ?? 1) === 1).map((s) => `<li>${numbered ? `<span class="n">${++tocNo}.</span>` : ''}${escapeHtml(keepDash(numbered ? stripHeadingNumber(s.heading) : s.heading))}</li>`).join('')}${unverified.length ? `<li>${numbered ? '<span class="n"></span>' : ''}Unverified statements</li>` : ''}${ordered.length ? `<li>${numbered ? '<span class="n"></span>' : ''}Sources</li>` : ''}</ol></section>`
    : '';

  let topNo = 0;
  const body = model.sections
    .map((s) => {
      const tag = s.level === 3 ? 'h4' : s.level === 2 ? 'h3' : 'h2';
      // 'numbered-rule' numbers the top-level body sections ("1. Executive summary").
      const num = tag === 'h2' && theme.headingStyle === 'numbered-rule' ? `<span class="num">${++topNo}.</span>` : '';
      const headingText = num ? stripHeadingNumber(s.heading) : s.heading;
      return `<section id="${escapeHtml(s.id)}"><${tag}>${num}${escapeHtml(keepDash(headingText))}</${tag}>${s.blocks.map((b) => blockHtml(b, numberOf, theme)).join('')}</section>`;
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

  return `<!doctype html><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="${DOC_HTML_CSP}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(keepDash(model.title))}</title><style>${themeCss(theme)}${opts.screen ? SCREEN_CSS : ''}</style></head><body><main class="doc">${cover}${toc}${body}${unverifiedSection}${sources}</main></body></html>`;
}
