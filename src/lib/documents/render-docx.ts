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
import { assumptionOrigin, chartShownByAdjacentTable, citationIndex, citeMarker, claimLabel, claimsPresent, formatCell, formatChartValue, formatDocDate, parseInline, unverifiedStatements } from './format';

const NAVY = '1E3A8A';
const INK = '1F2937';
const MUTED = '6B7280';
const FONT = 'Calibri';
/** Letter 8.5in minus 0.85in margins each side, in twentieths of a point (DXA). */
const CONTENT_DXA = 9792;

type Numberer = (id: string) => number | null;

function runs(text: string, base: { size?: number; color?: string } = {}): TextRun[] {
  return parseInline(text).map((r) => new TextRun({ font: FONT, size: 21, text: r.text, bold: r.bold, italics: r.italic, ...base }));
}

function originRun(u: { claim?: string; origin?: string }, size = 21): TextRun[] {
  const o = assumptionOrigin(u as never);
  return o ? [new TextRun({ font: FONT, size, text: ` ${o}`, italics: true, color: MUTED })] : [];
}

function labelRun(claim: string | undefined): TextRun[] {
  const l = claimLabel(claim as never);
  if (!l) return [];
  const color = claim === 'assumption' ? '92400E' : claim === 'unverified' ? '991B1B' : '166534';
  const fill = claim === 'assumption' ? 'FEF3C7' : claim === 'unverified' ? 'FEE2E2' : 'DCFCE7';
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

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' };

function headerCell(text: string, right: boolean, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: NAVY },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    borders: { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER },
    children: [new Paragraph({ alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ font: FONT, text, bold: true, color: 'FFFFFF', size: 18 })] })],
  });
}

function bodyCell(text: string, opts: { right: boolean; na: boolean; zebra: boolean; width: number }): TableCell {
  return new TableCell({
    width: { size: opts.width, type: WidthType.DXA },
    shading: opts.zebra ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F8FAFC' } : undefined,
    margins: { top: 50, bottom: 50, left: 100, right: 100 },
    borders: { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER },
    children: [new Paragraph({
      alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [new TextRun({ font: FONT, text, size: 18, italics: opts.na, color: opts.na ? '9CA3AF' : INK })],
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
    const longest = Math.max(c.label.length, ...rows.map((r) => formatCell(r[c.key] ?? null, c.format).length));
    return isNumCol(c) ? Math.min(Math.max(longest, 8), 16) : Math.min(Math.max(longest, 6), 42);
  });
  const total = want.reduce((a, b) => a + b, 0);
  const widths = want.map((w) => Math.floor((CONTENT_DXA * w) / total));
  widths[widths.length - 1] += CONTENT_DXA - widths.reduce((a, b) => a + b, 0);
  return widths;
}

function table(columns: TableColumn[], rows: TableBlock['rows']): Table {
  const widths = columnWidths(columns, rows);
  return new Table({
    width: { size: CONTENT_DXA, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: columns.map((c, ci) => headerCell(c.label, isNumCol(c), widths[ci])) }),
      ...rows.map((r, i) => new TableRow({
        cantSplit: true,
        children: columns.map((c, ci) => {
          const v = r[c.key] ?? null;
          return bodyCell(formatCell(v, c.format), { right: isNumCol(c), na: v === null, zebra: i % 2 === 1, width: widths[ci] });
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
  const rows = b.series[0].points.map((p, pi) => {
    const row: Record<string, string | number | null> = { x: p.x };
    b.series.forEach((s, si) => { const y = s.points[pi]?.y; row[`s${si}`] = y === undefined || y === null ? null : formatChartValue(y, b.valueFormat); });
    return row;
  });
  return table(columns, rows);
}

function blockToDocx(b: Block, numberOf: Numberer, shownByAdjacentTable = false): (Paragraph | Table)[] {
  switch (b.type) {
    case 'paragraph':
      return [new Paragraph({ style: 'Body', children: [...labelRun(b.claim), ...runs(b.text), ...citeRun(b.cites, numberOf), ...originRun(b)] })];
    case 'bullets':
      return b.items.map((it) => new Paragraph({
        style: 'Body',
        numbering: { reference: b.ordered ? 'mindy-numbers' : 'mindy-bullets', level: 0 },
        children: [...labelRun(it.claim), ...runs(it.text), ...citeRun(it.cites, numberOf), ...originRun(it)],
      }));
    case 'table': {
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
      const fill = b.tone === 'warning' ? 'FFFBEB' : b.tone === 'key_finding' ? 'F0FDFA' : 'EEF2FF';
      const bar = b.tone === 'warning' ? 'B45309' : b.tone === 'key_finding' ? '0F766E' : NAVY;
      const border = { left: { style: BorderStyle.SINGLE, size: 24, color: bar, space: 8 } };
      return [
        new Paragraph({ border, shading: { type: ShadingType.CLEAR, color: 'auto', fill }, spacing: { before: 120, after: 0 }, children: [new TextRun({ font: FONT, text: title, bold: true, size: 15, color: '374151' })] }),
        new Paragraph({ border, shading: { type: ShadingType.CLEAR, color: 'auto', fill }, spacing: { after: 160 }, children: [...labelRun(b.claim), ...runs(b.text), ...citeRun(b.cites, numberOf), ...originRun(b)] }),
      ];
    }
    case 'pagebreak':
      return [new Paragraph({ children: [new PageBreak()] })];
  }
}

export function buildDocx(model: DocModel): Document {
  const { ordered, numberOf } = citationIndex(model);
  const showToc = model.sections.length >= 4;
  const children: (Paragraph | Table)[] = [];

  // Cover
  children.push(new Paragraph({ spacing: { before: 2400, after: 120 }, children: [new TextRun({ font: FONT, text: 'REPORT', bold: true, size: 18, color: NAVY, characterSpacing: 40 })] }));
  children.push(new Paragraph({ style: 'Title', children: [new TextRun({ font: FONT, size: 56, bold: true, color: '111827', text: model.title })] }));
  if (model.subtitle) children.push(new Paragraph({ spacing: { after: 360 }, children: [new TextRun({ font: FONT, text: model.subtitle, size: 26, color: '4B5563' })] }));
  // Cover metadata as a borderless two-column table (tab stops render inconsistently across viewers).
  const meta: Array<[string, string]> = [];
  if (model.preparedFor) meta.push(['Prepared for', model.preparedFor]);
  meta.push(['Date', formatDocDate(model.date)]);
  meta.push(['Prepared with', 'Mindy']);
  if (ordered.length) meta.push(['Sources', `${ordered.length} cited source${ordered.length === 1 ? '' : 's'}`]);
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const noBorders = { top: none, bottom: none, left: none, right: none };
  children.push(new Table({
    width: { size: 6800, type: WidthType.DXA },
    columnWidths: [2000, 4800],
    borders: { ...noBorders, insideHorizontal: none, insideVertical: none },
    rows: meta.map(([k, v]) => new TableRow({
      children: [
        new TableCell({ borders: noBorders, width: { size: 2000, type: WidthType.DXA }, children: [new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ font: FONT, text: k, color: MUTED, size: 20 })] })] }),
        new TableCell({ borders: noBorders, width: { size: 4800, type: WidthType.DXA }, children: [new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ font: FONT, text: v, size: 20 })] })] }),
      ],
    })),
  }));
  const present = claimsPresent(model);
  const unverified = unverifiedStatements(model);
  const reading = [
    'How to read this document. Facts carry a numbered citation like [1] that points to the Sources section.',
    present.has('assumption') ? 'Statements marked PLANNING ASSUMPTION are premises stated for this analysis, not recorded facts; each says where it comes from. Check them before relying on them.' : '',
    present.has('recommendation') ? 'Statements marked RECOMMENDATION are suggested actions.' : '',
    unverified.length ? 'Statements marked UNVERIFIED — NO SOURCE could not be traced to a source and are listed in the Unverified statements section.' : '',
  ].filter(Boolean).join(' ');
  children.push(new Paragraph({ spacing: { before: 600 }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F9FAFB' }, children: [new TextRun({ font: FONT, text: reading, size: 17, color: '374151' })] }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Contents
  if (showToc) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ font: FONT, text: 'Contents' })] }));
    const tops = model.sections.filter((s) => (s.level ?? 1) === 1).map((s) => s.heading);
    if (unverified.length) tops.push('Unverified statements');
    if (ordered.length) tops.push('Sources');
    tops.forEach((h) => children.push(new Paragraph({ style: 'Body', numbering: { reference: 'mindy-numbers-toc', level: 0 }, children: [new TextRun({ font: FONT, size: 21, text: h })] })));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  // Body
  for (const s of model.sections) {
    const heading = s.level === 3 ? HeadingLevel.HEADING_3 : s.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1;
    children.push(new Paragraph({ heading, children: [new TextRun({ font: FONT, text: s.heading })] }));
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
      if (src.recordId) parts.push(new TextRun({ font: FONT, text: ` (${src.recordId})`, size: 18, color: MUTED }));
      if (src.retrievedAt) parts.push(new TextRun({ font: FONT, text: ` Retrieved ${src.retrievedAt}.`, size: 18, color: MUTED }));
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
        title: { run: { font: FONT, size: 56, bold: true, color: '111827' }, paragraph: { spacing: { after: 160 } } },
        heading1: { run: { font: FONT, size: 32, bold: true, color: NAVY }, paragraph: { spacing: { before: 360, after: 140 }, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C7D2FE', space: 4 } } } },
        heading2: { run: { font: FONT, size: 25, bold: true, color: '111827' }, paragraph: { spacing: { before: 280, after: 100 }, keepNext: true } },
        heading3: { run: { font: FONT, size: 22, bold: true, color: '111827' }, paragraph: { spacing: { before: 220, after: 80 }, keepNext: true } },
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
        { reference: 'mindy-numbers-toc', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 300 } } } }] },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1300, right: 1224, bottom: 1300, left: 1224 } } },
      headers: { default: new Header({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_DXA }], children: [new TextRun({ font: FONT, text: model.title.length > 90 ? `${model.title.slice(0, 89)}…` : model.title, ...headerFooterRun }), new TextRun({ font: FONT, text: '\tPrepared with Mindy', ...headerFooterRun })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ font: FONT, children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], ...headerFooterRun })] })] }) },
      children,
    }],
  });
}

export async function renderDocx(model: DocModel): Promise<Buffer> {
  return Packer.toBuffer(buildDocx(model));
}
