/**
 * DocModel → DOCX with the `docx` builder (already a runtime dependency). Pure JS, in-process,
 * no browser.
 *
 * Professional defaults: named heading styles (navigable in Word's outline), a cover block, a
 * contents list, header with the title, footer with "Page X of Y", bordered tables whose header row
 * repeats across pages, number columns right-aligned, "Not available" for missing values, visible
 * Planning assumption (with its origin) / Recommendation / "Unverified — no source" labels, [n] citations resolving to a numbered Sources section.
 *
 * Charts: v1 renders a chart as its data table under the caption ("Chart data"). A vector chart in
 * Word needs an SVG plus a PNG fallback, which needs a rasterizer; that is a follow-up. The PDF
 * renderer draws the chart.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from 'docx';
import type { Block, ChartBlock, DocModel, TableBlock, TableColumn } from './model';
import { resolveTheme, type Theme } from './theme';
import { assumptionOrigin, clientCopy, publicRecordId, DOC_STAGE_MARK, keepDash, stripHeadingNumber, chartShownByAdjacentTable, citationIndex, citeMarker, claimLabel, claimsPresent, formatColumn, formatChartValue, formatDocDate, usdColumnDecimals, parseInline, unverifiedStatements } from './format';
import { extractCapability, isCapabilityStatement, type CapEntry, type CapField } from './capability-statement';
import { TOC_MIN_SECTIONS } from './render-html';

// The document's theme (theme.ts), resolved once per buildDocx call (which is synchronous). Every
// color and the font below come from it — nothing is hard-coded in this renderer.
let T: Theme = resolveTheme(undefined);
let NAVY = T.colors.accent;
let INK = T.colors.ink;
let MUTED = T.colors.muted;
let FONT = T.fonts.docx;
function useTheme(t: Theme) {
  T = t; NAVY = t.colors.accent; INK = t.colors.ink; MUTED = t.colors.muted; FONT = t.fonts.docx;
}
/** Letter 8.5in minus 0.85in margins each side, in twentieths of a point (DXA). */
const CONTENT_DXA = 9792;

type Numberer = (id: string) => number | null;

function runs(text: string, base: { size?: number; color?: string } = {}): TextRun[] {
  return parseInline(text).map((r) => new TextRun({ font: FONT, size: 21, text: r.text, bold: r.bold, italics: r.italic, ...(r.italic && !base.color ? { color: NAVY } : {}), ...base }));
}

function originRun(u: { claim?: string; origin?: string }, size = 21): TextRun[] {
  const o = assumptionOrigin(u as never);
  return o ? [new TextRun({ font: FONT, size, text: ` ${o}`, italics: true, color: MUTED })] : [];
}

function labelRun(claim: string | undefined): TextRun[] {
  const l = claimLabel(claim as never);
  if (!l) return [];
  const k = T.colors;
  const color = claim === 'assumption' ? k.assumption.text : claim === 'unverified' ? k.unverified.text : k.recommendation.text;
  const fill = claim === 'assumption' ? k.assumption.fill : claim === 'unverified' ? k.unverified.fill : k.recommendation.fill;
  return [
    new TextRun({ font: FONT, text: ` ${l.toUpperCase()} `, bold: true, size: 15, color, shading: { type: ShadingType.CLEAR, color: 'auto', fill } }),
    new TextRun({ font: FONT, size: 21, text: ' ' }),
  ];
}

function citeRun(cites: string[] | undefined, numberOf: Numberer): TextRun[] {
  const m = citeMarker(cites, numberOf);
  return m ? [new TextRun({ font: FONT, text: m, superScript: true, color: NAVY })] : [];
}

const isNumCol = (c: TableColumn) => c.align === 'right' || ['usd', 'int', 'pct'].includes(c.format ?? '');

const cellRule = () => ({ style: BorderStyle.SINGLE, size: 4, color: T.colors.rule });
const noRule = () => ({ style: BorderStyle.NONE, size: 0, color: T.colors.white });

function headerCell(text: string, right: boolean, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: T.colors.tableHeaderBg },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    borders: { top: noRule(), bottom: noRule(), left: noRule(), right: noRule() },
    children: [new Paragraph({ alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ font: FONT, text, bold: true, allCaps: T.table.uppercaseHeader, color: T.colors.tableHeaderFg, size: T.table.uppercaseHeader ? 16 : 18 })] })],
  });
}

function bodyCell(text: string, opts: { right: boolean; na: boolean; zebra: boolean; width: number; first?: boolean }): TableCell {
  const lead = !!opts.first && T.table.boldFirstColumn && !opts.na;
  return new TableCell({
    width: { size: opts.width, type: WidthType.DXA },
    shading: opts.zebra ? { type: ShadingType.CLEAR, color: 'auto', fill: T.colors.rowFill } : undefined,
    margins: { top: 50, bottom: 50, left: 100, right: 100 },
    borders: { top: noRule(), bottom: cellRule(), left: noRule(), right: noRule() },
    children: [new Paragraph({
      alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [new TextRun({ font: FONT, text, size: 18, bold: lead, italics: opts.na, color: opts.na ? T.colors.na : lead ? NAVY : INK })],
    })],
  });
}

/**
 * Content-aware column widths: each column gets room for its longest cell (header included, capped so
 * one long value cannot starve the rest), so a vendor name does not wrap while a 7-character dollar
 * figure does not hog a third of the page. Number columns keep a floor so they never wrap.
 */
function columnWidths(columns: TableColumn[], rows: TableBlock['rows']): number[] {
  const want = columns.map((c) => {
    const longest = Math.max(c.label.length, ...formatColumn(rows.map((r) => r[c.key] ?? null), c.format).map((x) => x.length));
    return isNumCol(c) ? Math.min(Math.max(longest, 8), 16) : Math.min(Math.max(longest, 6), 42);
  });
  const total = want.reduce((a, b) => a + b, 0);
  const widths = want.map((w) => Math.floor((CONTENT_DXA * w) / total));
  widths[widths.length - 1] += CONTENT_DXA - widths.reduce((a, b) => a + b, 0);
  return widths;
}

function table(columns: TableColumn[], rows: TableBlock['rows']): Table {
  const widths = columnWidths(columns, rows);
  const cells = columns.map((c) => formatColumn(rows.map((r) => r[c.key] ?? null), c.format));
  return new Table({
    width: { size: CONTENT_DXA, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: columns.map((c, ci) => headerCell(c.label, isNumCol(c), widths[ci])) }),
      ...rows.map((r, i) => new TableRow({
        cantSplit: true,
        children: columns.map((c, ci) => {
          const v = r[c.key] ?? null;
          return bodyCell(cells[ci][i], { right: isNumCol(c), na: v === null, zebra: i % 2 === 1, width: widths[ci], first: ci === 0 });
        }),
      })),
    ],
  });
}

function caption(text: string | undefined, claim: string | undefined, cites: string[] | undefined, numberOf: Numberer, prefix?: string, origin?: string): Paragraph | null {
  if (!text && !claimLabel(claim as never) && !citeMarker(cites, numberOf) && !prefix) return null;
  return new Paragraph({
    style: 'Caption',
    keepNext: true,
    children: [
      ...labelRun(claim),
      ...(prefix ? [new TextRun({ font: FONT, text: prefix, italics: true, size: 17, color: MUTED })] : []),
      ...(text ? runs(text, { size: 17, color: MUTED }) : []),
      ...citeRun(cites, numberOf),
      ...originRun({ claim, origin }, 17),
    ],
  });
}

/** Space after a table (the caption now sits above it). */
function spacer(): Paragraph {
  return new Paragraph({ spacing: { before: 0, after: 160 }, children: [] });
}

function chartAsTable(b: ChartBlock): Table {
  // One compact, formatted table: axis titles become headers, values read like the rest of the
  // document ($30M, 1,234), never raw (30000000).
  const valueHeader = (name: string) => (b.yLabel && b.series.length === 1 ? `${name} (${b.yLabel})` : name);
  const columns: TableColumn[] = [{ key: 'x', label: b.xLabel || 'Category' }, ...b.series.map((s, i) => ({ key: `s${i}`, label: valueHeader(s.name), align: 'right' as const }))];
  const usdDecimals = usdColumnDecimals(b.series.flatMap((s) => s.points.map((p) => p.y)));
  const rows = b.series[0].points.map((p, pi) => {
    const row: Record<string, string | number | null> = { x: p.x };
    b.series.forEach((s, si) => { const y = s.points[pi]?.y; row[`s${si}`] = y === undefined || y === null ? null : formatChartValue(y, b.valueFormat, usdDecimals); });
    return row;
  });
  return table(columns, rows);
}

function blockToDocx(b: Block, numberOf: Numberer, shownByAdjacentTable = false): (Paragraph | Table)[] {
  switch (b.type) {
    case 'paragraph':
      return [new Paragraph({ style: 'Body', children: [...labelRun(b.claim), ...runs(b.text), ...citeRun(b.cites, numberOf), ...originRun(b)] })];
    case 'bullets':
      // A checklist reads as empty boxes in Word too (a ballot-box glyph instead of the bullet).
      if (!b.ordered && b.style === 'checklist') {
        return b.items.map((it) => new Paragraph({
          style: 'Body',
          indent: { left: 360, hanging: 300 },
          children: [new TextRun({ font: FONT, text: '\u2610  ' }), ...labelRun(it.claim), ...runs(it.text), ...citeRun(it.cites, numberOf), ...originRun(it)],
        }));
      }
      return b.items.map((it) => new Paragraph({
        style: 'Body',
        numbering: { reference: b.ordered ? 'mindy-numbers' : 'mindy-bullets', level: 0 },
        children: [...labelRun(it.claim), ...runs(it.text), ...citeRun(it.cites, numberOf), ...originRun(it)],
      }));
    case 'table': {
      // A citation-only caption rides on the last header cell (never a stray "[3]" line above the table).
      const marker = citeMarker(b.cites, numberOf);
      const citeOnly = !!marker && !b.caption && !claimLabel(b.claim) && !assumptionOrigin(b);
      if (citeOnly) {
        const cols = b.columns.map((c, i) => (i === b.columns.length - 1 ? { ...c, label: `${c.label} ${marker}` } : c));
        return [table(cols, b.rows), spacer()];
      }
      const cap = caption(b.caption, b.claim, b.cites, numberOf, undefined, b.origin);
      return [...(cap ? [cap] : []), table(b.columns, b.rows), spacer()];
    }
    case 'chart': {
      // Word has no native chart here, so a chart is its data. When the adjacent table already shows
      // every value, printing it again is duplication: omit it (the table carries the information).
      if (shownByAdjacentTable) return [];
      const cap = caption(b.caption, b.claim, b.cites, numberOf, undefined, b.origin);
      return [...(cap ? [cap] : []), chartAsTable(b), spacer()];
    }
    case 'callout': {
      const title = b.tone === 'key_finding' ? 'KEY FINDING' : b.tone === 'warning' ? 'CAUTION' : 'NOTE';
      const warn = b.tone === 'warning';
      const key = b.tone === 'key_finding';
      const pal = warn ? T.colors.caution : key ? T.colors.keyMessage : T.colors.note;
      const fill = pal.fill;
      const border = { left: { style: BorderStyle.SINGLE, size: 24, color: pal.border, space: 8 } };
      const bodyRuns = warn
        ? parseInline(b.text).map((r) => new TextRun({ font: FONT, size: 21, text: r.text, bold: true, italics: r.italic, color: pal.text }))
        : runs(b.text, key ? { size: 23, color: pal.text } : { color: pal.text });
      return [
        new Paragraph({ border, shading: { type: ShadingType.CLEAR, color: 'auto', fill }, spacing: { before: 120, after: 0 }, children: [new TextRun({ font: FONT, text: title, bold: true, size: 15, color: warn ? pal.text : NAVY })] }),
        new Paragraph({ border, shading: { type: ShadingType.CLEAR, color: 'auto', fill }, spacing: { after: 160 }, children: [...labelRun(b.claim), ...bodyRuns, ...citeRun(b.cites, numberOf), ...originRun(b)] }),
      ];
    }
    case 'pagebreak':
      return [new Paragraph({ children: [new PageBreak()] })];
  }
}

export function buildDocx(stored: DocModel): Document {
  const model = clientCopy(stored);
  useTheme(resolveTheme(model.theme));
  if (isCapabilityStatement(model)) return buildCapabilityDocx(model);
  const { ordered, numberOf } = citationIndex(model);
  // Same rule as the PDF (render-html.ts): a contents list only for long documents, and never a page of its own.
  const showToc = model.sections.filter((s) => (s.level ?? 1) === 1).length >= TOC_MIN_SECTIONS;
  const children: (Paragraph | Table)[] = [];

  // Cover. Built ONLY from the model's own metadata — nothing is generated for the cover.
  const none = { style: BorderStyle.NONE, size: 0, color: T.colors.white };
  const noBorders = { top: none, bottom: none, left: none, right: none };
  const kvTable = (rows: Array<[string, string]>, keyColor: string, valueColor: string, boxed: boolean) => {
    const edge = boxed ? { style: BorderStyle.SINGLE, size: 6, color: T.colors.rule } : none;
    const box = { top: edge, bottom: edge, left: edge, right: edge };
    return new Table({
      width: { size: boxed ? CONTENT_DXA : 6800, type: WidthType.DXA },
      columnWidths: boxed ? [2400, CONTENT_DXA - 2400] : [2000, 4800],
      borders: { ...box, insideHorizontal: none, insideVertical: none },
      rows: rows.map(([k, v]) => new TableRow({
        children: [
          new TableCell({ borders: noBorders, margins: boxed ? { left: 160, top: 40, bottom: 40 } : undefined, width: { size: boxed ? 2400 : 2000, type: WidthType.DXA }, children: [new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ font: FONT, text: k, bold: boxed, color: keyColor, size: 20 })] })] }),
          new TableCell({ borders: noBorders, margins: boxed ? { right: 160, top: 40, bottom: 40 } : undefined, width: { size: boxed ? CONTENT_DXA - 2400 : 4800, type: WidthType.DXA }, children: [new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ font: FONT, text: v, size: 20, color: valueColor })] })] }),
        ],
      })),
    });
  };
  if (T.cover === 'brand-band' || T.cover === 'letterhead') {
    // Brand header band: solid accent fill in Word (no gradients there), mark + tagline + contact lines.
    const brand = T.brand;
    const fill = { type: ShadingType.CLEAR, color: 'auto', fill: NAVY };
    children.push(new Table({
      width: { size: CONTENT_DXA, type: WidthType.DXA },
      columnWidths: [6000, CONTENT_DXA - 6000],
      borders: { ...noBorders, insideHorizontal: none, insideVertical: none },
      rows: [new TableRow({ children: [
        new TableCell({ borders: noBorders, shading: fill, margins: { top: 180, bottom: 180, left: 240 }, width: { size: 6000, type: WidthType.DXA }, children: [
          new Paragraph({ children: [new TextRun({ font: FONT, text: ` ${brand.mark} `, bold: true, size: 30, color: NAVY, shading: { type: ShadingType.CLEAR, color: 'auto', fill: T.colors.white } }), new TextRun({ font: FONT, text: `  ${brand.name}`, bold: true, size: 26, color: T.colors.white })] }),
          new Paragraph({ children: [new TextRun({ font: FONT, text: brand.tagline, bold: true, size: 15, color: T.colors.white, characterSpacing: 30 })] }),
        ] }),
        new TableCell({ borders: noBorders, shading: fill, margins: { top: 180, bottom: 180, right: 240 }, width: { size: CONTENT_DXA - 6000, type: WidthType.DXA }, children: brand.contactLines.map((l) => new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ font: FONT, text: l, size: 17, color: T.colors.white })] })) }),
      ] })],
    }));
    children.push(new Paragraph({ spacing: { before: 600, after: 0 }, children: [] }));
    children.push(new Paragraph({ style: 'Title', children: [new TextRun({ font: FONT, size: 56, bold: true, color: T.colors.title, text: keepDash(model.title) })] }));
    if (model.subtitle) children.push(new Paragraph({ spacing: { after: 300 }, children: [new TextRun({ font: FONT, text: model.subtitle, size: 26, color: T.colors.meta })] }));
    const card: Array<[string, string]> = [];
    if (model.preparedFor) card.push(['Prepared for', model.preparedFor]);
    if (typeof model.meta?.attention === 'string' && model.meta.attention.trim()) card.push(['Attention', model.meta.attention]);
    card.push(['Prepared by', brand.name]);
    if (model.subtitle) card.push(['What this is', model.subtitle]);
    // No document date on the cover (Eric, 2026-11-27).
    if (ordered.length) card.push(['Sources', `${ordered.length} cited source${ordered.length === 1 ? '' : 's'}`]);
    children.push(kvTable(card, NAVY, INK, true));
  } else {
    children.push(new Paragraph({ spacing: { before: 2400, after: 120 }, children: [new TextRun({ font: FONT, text: 'REPORT', bold: true, size: 18, color: T.colors.accent2, characterSpacing: 40 })] }));
    children.push(new Paragraph({ style: 'Title', children: [new TextRun({ font: FONT, size: 56, bold: true, color: T.colors.title, text: keepDash(model.title) })] }));
    if (model.subtitle) children.push(new Paragraph({ spacing: { after: 360 }, children: [new TextRun({ font: FONT, text: model.subtitle, size: 26, color: T.colors.meta })] }));
    const meta: Array<[string, string]> = [];
    if (model.preparedFor) meta.push(['Prepared for', model.preparedFor]);
    meta.push(['Prepared with', T.brand.name]);
    if (ordered.length) meta.push(['Sources', `${ordered.length} cited source${ordered.length === 1 ? '' : 's'}`]);
    children.push(kvTable(meta, T.colors.meta, T.colors.meta, false));
    // Thin accent rule closing the title block.
    children.push(new Paragraph({ spacing: { before: 240, after: 0 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: T.colors.accent2, space: 1 } }, children: [] }));
  }
  const present = claimsPresent(model);
  const unverified = unverifiedStatements(model);
  const reading = [
    'How to read this document. Facts carry a numbered citation like [1] that points to the Sources section.',
    present.has('assumption') ? 'Statements marked PLANNING ASSUMPTION are premises stated for this analysis, not recorded facts; each says where it comes from. Check them before relying on them.' : '',
    present.has('recommendation') ? 'Statements marked RECOMMENDATION are suggested actions.' : '',
    unverified.length ? 'Statements marked UNVERIFIED: NO SOURCE could not be traced to a source and are listed in the Unverified statements section.' : '',
  ].filter(Boolean).join(' ');
  children.push(new Paragraph({ spacing: { before: 240, after: 240 }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: T.colors.panelBg }, children: [new TextRun({ font: FONT, text: reading, size: 17, color: T.colors.meta })] }));
  // The cover flows into the first section (no cover-alone page), as in the PDF.

  // Contents
  if (showToc) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ font: FONT, text: 'Contents' })] }));
    // Numbered only when the body numbers its sections (numbered-rule), with the same numbers; Unverified
    // statements and Sources are unnumbered in the body, so they are unnumbered here too.
    const numberedToc = T.headingStyle === 'numbered-rule';
    let tocNo = 0;
    const tops: Array<{ n: number | null; text: string }> = model.sections.filter((s) => (s.level ?? 1) === 1)
      .map((s) => ({ n: numberedToc ? ++tocNo : null, text: keepDash(numberedToc ? stripHeadingNumber(s.heading) : s.heading) }));
    if (unverified.length) tops.push({ n: null, text: 'Unverified statements' });
    if (ordered.length) tops.push({ n: null, text: 'Sources' });
    tops.forEach((h) => children.push(new Paragraph({
      style: 'Body',
      indent: numberedToc ? { left: 400, hanging: 400 } : undefined,
      children: [new TextRun({ font: FONT, size: 21, text: h.n === null ? (numberedToc ? `\t${h.text}` : h.text) : `${h.n}.\t${h.text}` })],
      tabStops: numberedToc ? [{ type: TabStopType.LEFT, position: 400 }] : undefined,
    })));
  }

  // Body
  let topNo = 0;
  for (const s of model.sections) {
    const heading = s.level === 3 ? HeadingLevel.HEADING_3 : s.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1;
    // 'numbered-rule' numbers the top-level body sections ("1. Executive summary").
    const label = heading === HeadingLevel.HEADING_1 && T.headingStyle === 'numbered-rule' ? `${++topNo}. ${stripHeadingNumber(s.heading)}` : s.heading;
    children.push(new Paragraph({ heading, children: [new TextRun({ font: FONT, text: keepDash(label) })] }));
    s.blocks.forEach((b, i) => children.push(...blockToDocx(b, numberOf, chartShownByAdjacentTable(s.blocks, i))));
  }

  // Unverified statements
  if (unverified.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ font: FONT, text: 'Unverified statements' })] }));
    children.push(new Paragraph({ style: 'Body', children: [new TextRun({ font: FONT, size: 21, text: 'These statements appear in the document without a source. Verify each one before relying on it.' })] }));
    unverified.forEach((u) => children.push(new Paragraph({
      style: 'Body',
      numbering: { reference: 'mindy-numbers-unverified', level: 0 },
      children: [new TextRun({ font: FONT, size: 21, text: `${u.section}: `, color: MUTED }), ...runs(u.text)],
    })));
  }

  // Sources
  if (ordered.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ font: FONT, text: 'Sources' })] }));
    ordered.forEach((src, i) => {
      const parts: TextRun[] = [new TextRun({ font: FONT, text: `[${i + 1}] `, bold: true, size: 18, color: NAVY }), new TextRun({ font: FONT, text: src.label, size: 18 })];
      const rid = publicRecordId(src);
      if (rid) parts.push(new TextRun({ font: FONT, text: ` (${rid})`, size: 18, color: MUTED }));
      // No retrieval (data-freshness) date in client copy (Eric, 2026-11-27); retrievedAt stays in the stored model.
      if (src.url) parts.push(new TextRun({ font: FONT, text: ` ${src.url}`, size: 18, color: MUTED }));
      children.push(new Paragraph({ spacing: { after: 80 }, indent: { left: 360, hanging: 360 }, children: parts }));
    });
  }

  const headerFooterRun = { size: 15, color: MUTED };
  return new Document({
    creator: 'Mindy',
    title: model.title,
    description: model.subtitle,
    styles: {
      // Title and Heading1–3 are BUILT-IN docx styles. Customize them through `default`, never by
      // re-declaring their ids in paragraphStyles — that emits duplicate w:styleId entries, which
      // MS Word may repair or reject (review, 2026-11-17).
      default: {
        document: { run: { font: FONT, size: 21, color: INK } },
        title: { run: { font: FONT, size: 56, bold: true, color: T.colors.title }, paragraph: { spacing: { after: 160 } } },
        heading1: T.headingStyle === 'band'
          // Full-width band: accent fill, white uppercase text.
          ? { run: { font: FONT, size: 24, bold: true, color: T.colors.white, allCaps: true, characterSpacing: 20 }, paragraph: { spacing: { before: 360, after: 160 }, keepNext: true, shading: { type: ShadingType.CLEAR, color: 'auto', fill: NAVY } } }
          // Numbered accent heading with a thin rule.
          : { run: { font: FONT, size: 30, bold: true, color: NAVY }, paragraph: { spacing: { before: 360, after: 140 }, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: T.colors.rule, space: 4 } } } },
        heading2: { run: { font: FONT, size: 25, bold: true, color: NAVY }, paragraph: { spacing: { before: 280, after: 100 }, keepNext: true } },
        heading3: { run: { font: FONT, size: 22, bold: true, color: NAVY }, paragraph: { spacing: { before: 220, after: 80 }, keepNext: true } },
      },
      paragraphStyles: [
        { id: 'Body', name: 'Body', basedOn: 'Normal', run: { font: FONT, size: 21 }, paragraph: { spacing: { after: 140, line: 288 } } },
        { id: 'Caption', name: 'Caption', basedOn: 'Normal', run: { font: FONT, size: 17, color: MUTED }, paragraph: { spacing: { before: 160, after: 80 }, keepNext: true } },
      ],
    },
    numbering: {
      config: [
        { reference: 'mindy-bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }] },
        { reference: 'mindy-numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 300 } } } }] },
        { reference: 'mindy-numbers-unverified', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 300 } } } }] },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1300, right: 1224, bottom: 1300, left: 1224 } } },
      headers: { default: new Header({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_DXA }], children: [new TextRun({ font: FONT, text: keepDash(model.title.length > 90 ? `${model.title.slice(0, 89)}…` : model.title), ...headerFooterRun }), new TextRun({ font: FONT, text: '\tPrepared with Mindy', ...headerFooterRun })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ font: FONT, children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES, ...(DOC_STAGE_MARK ? [`  \u00b7  ${DOC_STAGE_MARK}`] : [])], ...headerFooterRun })] })] }) },
      children,
    }],
  });
}

/**
 * The capability statement in Word, editable with the same structure as the PDF: a shaded header band (name,
 * value statement), then a two-column table: Core Competencies / Past Performance / Differentiators on the left,
 * a shaded Company Data + Point of Contact box on the right, then the provenance line. One page at 0.5in margins.
 */
function buildCapabilityDocx(model: DocModel): Document {
  const cap = extractCapability(model);
  const WHITE = T.colors.white;
  const NONE = { style: BorderStyle.NONE, size: 0, color: WHITE };
  const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE };
  const PAGE_DXA = 12240 - 2 * 720;
  const LEFT_DXA = Math.round(PAGE_DXA * 0.61);
  const RIGHT_DXA = PAGE_DXA - LEFT_DXA - 200;
  const accent2 = T.colors.accent2;
  const heading = (text: string) => new Paragraph({ spacing: { before: 140, after: 60 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: accent2, space: 2 } }, children: [new TextRun({ font: FONT, text: text.toUpperCase(), bold: true, size: 17, color: NAVY, characterSpacing: 20 })] });
  const bullet = (e: CapEntry) => new Paragraph({ numbering: { reference: 'mindy-bullets', level: 0 }, spacing: { after: 40 }, children: e.lead
    ? [new TextRun({ font: FONT, text: e.lead, bold: true, size: 18 }), ...(e.text ? [new TextRun({ font: FONT, text: ` \u00b7 ${e.text}`, size: 18 })] : [])]
    : runs(e.text, { size: 18 }) });
  const section = (title: string, items: CapEntry[]) => (items.length ? [heading(title), ...items.map(bullet)] : []);
  const fields = (title: string, list: CapField[]) => (list.length ? [
    new Paragraph({ spacing: { before: 60, after: 40 }, children: [new TextRun({ font: FONT, text: title.toUpperCase(), bold: true, size: 17, color: NAVY, characterSpacing: 20 })] }),
    ...list.flatMap((f) => [
      ...(f.label ? [new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ font: FONT, text: f.label.toUpperCase(), bold: true, size: 14, color: MUTED })] })] : []),
      new Paragraph({ spacing: { before: f.label ? 0 : 50, after: 20 }, children: [new TextRun({ font: FONT, text: f.value, bold: true, size: 18 })] }),
    ]),
  ] : []);
  const left = [
    ...cap.overview.map((p) => new Paragraph({ spacing: { after: 120 }, children: runs(p, { size: 20 }) })),
    ...section('Core Competencies', cap.competencies),
    ...section('Past Performance', cap.pastPerformance),
    ...section('Differentiators', cap.differentiators),
    ...cap.other.flatMap((o) => section(o.heading, o.items)),
  ];
  const right = [...fields('Company Data', cap.companyData), ...fields('Point of Contact', cap.contact)];
  const children: (Paragraph | Table)[] = [
    new Table({
      width: { size: PAGE_DXA, type: WidthType.DXA }, columnWidths: [PAGE_DXA], borders: { ...noBorders, insideHorizontal: NONE, insideVertical: NONE },
      rows: [new TableRow({ children: [new TableCell({ borders: noBorders, shading: { type: ShadingType.CLEAR, color: 'auto', fill: NAVY }, margins: { top: 180, bottom: 180, left: 240, right: 240 }, width: { size: PAGE_DXA, type: WidthType.DXA }, children: [
        new Paragraph({ children: [new TextRun({ font: FONT, text: 'CAPABILITY STATEMENT', bold: true, size: 14, color: WHITE, characterSpacing: 30 })] }),
        new Paragraph({ spacing: { before: 40, after: 40 }, children: [new TextRun({ font: FONT, text: cap.name, bold: true, size: 36, color: WHITE })] }),
        ...(cap.tagline ? [new Paragraph({ children: [new TextRun({ font: FONT, text: cap.tagline, size: 20, color: WHITE })] })] : []),
      ] })] })],
    }),
    new Paragraph({ spacing: { after: 120 }, children: [] }),
    new Table({
      width: { size: PAGE_DXA, type: WidthType.DXA }, columnWidths: [LEFT_DXA, 200, RIGHT_DXA], borders: { ...noBorders, insideHorizontal: NONE, insideVertical: NONE },
      rows: [new TableRow({ children: [
        new TableCell({ borders: noBorders, width: { size: LEFT_DXA, type: WidthType.DXA }, children: left.length ? left : [new Paragraph({ children: [] })] }),
        new TableCell({ borders: noBorders, width: { size: 200, type: WidthType.DXA }, children: [new Paragraph({ children: [] })] }),
        new TableCell({ borders: { ...noBorders, left: { style: BorderStyle.SINGLE, size: 18, color: NAVY } }, shading: right.length ? { type: ShadingType.CLEAR, color: 'auto', fill: T.colors.rowFill } : undefined, margins: { top: 160, bottom: 160, left: 200, right: 200 }, width: { size: RIGHT_DXA, type: WidthType.DXA }, children: right.length ? right : [new Paragraph({ children: [] })] }),
      ] })],
    }),
    ...(cap.footer ? [new Paragraph({ spacing: { before: 200 }, border: { top: { style: BorderStyle.SINGLE, size: 4, color: T.colors.rule, space: 4 } }, children: [new TextRun({ font: FONT, text: cap.footer, size: 14, color: MUTED })] })] : []),
  ];
  return new Document({
    creator: 'Mindy',
    title: model.title,
    numbering: { config: [{ reference: 'mindy-bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 300, hanging: 220 } } } }] }] },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, children }],
  });
}

export async function renderDocx(model: DocModel): Promise<Buffer> {
  return Packer.toBuffer(buildDocx(model));
}
