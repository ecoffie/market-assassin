/**
 * DocModel → DOCX with the `docx` builder (already a runtime dependency). Pure JS, in-process,
 * no browser.
 *
 * Professional defaults: named heading styles (navigable in Word's outline), a cover block, a
 * contents list, header with the title, footer with "Page X of Y", bordered tables whose header row
 * repeats across pages, number columns right-aligned, "Not available" for missing values, visible
 * Estimate/Recommendation labels, [n] citations resolving to a numbered Sources section.
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
import { citationIndex, citeMarker, claimLabel, formatCell, formatDocDate, parseInline } from './format';

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

function labelRun(claim: string | undefined): TextRun[] {
  const l = claimLabel(claim as never);
  if (!l) return [];
  const color = l === 'Estimate' ? '92400E' : '166534';
  const fill = l === 'Estimate' ? 'FEF3C7' : 'DCFCE7';
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

/** Fixed column widths: text columns get twice the share of number columns. */
function columnWidths(columns: TableColumn[]): number[] {
  const weights = columns.map((c) => (isNumCol(c) ? 1 : 2));
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.floor((CONTENT_DXA * w) / total));
  widths[widths.length - 1] += CONTENT_DXA - widths.reduce((a, b) => a + b, 0);
  return widths;
}

function table(columns: TableColumn[], rows: TableBlock['rows']): Table {
  const widths = columnWidths(columns);
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

function caption(text: string | undefined, claim: string | undefined, cites: string[] | undefined, numberOf: Numberer, prefix?: string): Paragraph | null {
  if (!text && !claimLabel(claim as never) && !citeMarker(cites, numberOf) && !prefix) return null;
  return new Paragraph({
    style: 'Caption',
    children: [
      ...labelRun(claim),
      ...(prefix ? [new TextRun({ font: FONT, text: prefix, italics: true, size: 17, color: MUTED })] : []),
      ...(text ? runs(text, { size: 17, color: MUTED }) : []),
      ...citeRun(cites, numberOf),
    ],
  });
}

function chartAsTable(b: ChartBlock): Table {
  const columns: TableColumn[] = [{ key: 'x', label: 'Category' }, ...b.series.map((s, i) => ({ key: `s${i}`, label: s.name, align: 'right' as const }))];
  const rows = b.series[0].points.map((p, pi) => {
    const row: Record<string, string | number | null> = { x: p.x };
    b.series.forEach((s, si) => { row[`s${si}`] = s.points[pi]?.y ?? null; });
    return row;
  });
  return table(columns, rows);
}

function blockToDocx(b: Block, numberOf: Numberer): (Paragraph | Table)[] {
  switch (b.type) {
    case 'paragraph':
      return [new Paragraph({ style: 'Body', children: [...labelRun(b.claim), ...runs(b.text), ...citeRun(b.cites, numberOf)] })];
    case 'bullets':
      return b.items.map((it) => new Paragraph({
        style: 'Body',
        numbering: { reference: b.ordered ? 'mindy-numbers' : 'mindy-bullets', level: 0 },
        children: [...labelRun(it.claim), ...runs(it.text), ...citeRun(it.cites, numberOf)],
      }));
    case 'table': {
      const cap = caption(b.caption, b.claim, b.cites, numberOf);
      return [table(b.columns, b.rows), ...(cap ? [cap] : [])];
    }
    case 'chart': {
      const cap = caption(b.caption, b.claim, b.cites, numberOf, 'Chart data. ');
      return [chartAsTable(b), ...(cap ? [cap] : [])];
    }
    case 'callout': {
      const title = b.tone === 'key_finding' ? 'KEY FINDING' : b.tone === 'warning' ? 'CAUTION' : 'NOTE';
      const fill = b.tone === 'warning' ? 'FFFBEB' : b.tone === 'key_finding' ? 'F0FDFA' : 'EEF2FF';
      const bar = b.tone === 'warning' ? 'B45309' : b.tone === 'key_finding' ? '0F766E' : NAVY;
      const border = { left: { style: BorderStyle.SINGLE, size: 24, color: bar, space: 8 } };
      return [
        new Paragraph({ border, shading: { type: ShadingType.CLEAR, color: 'auto', fill }, spacing: { before: 120, after: 0 }, children: [new TextRun({ font: FONT, text: title, bold: true, size: 15, color: '374151' })] }),
        new Paragraph({ border, shading: { type: ShadingType.CLEAR, color: 'auto', fill }, spacing: { after: 160 }, children: [...labelRun(b.claim), ...runs(b.text), ...citeRun(b.cites, numberOf)] }),
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
  const json = JSON.stringify(model.sections);
  const reading = [
    'How to read this document. Facts carry a numbered citation like [1] that points to the Sources section.',
    json.includes('"claim":"estimate"') ? 'Statements marked ESTIMATE are projections or inferences, not recorded facts.' : '',
    json.includes('"claim":"recommendation"') ? 'Statements marked RECOMMENDATION are suggested actions.' : '',
  ].filter(Boolean).join(' ');
  children.push(new Paragraph({ spacing: { before: 600 }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F9FAFB' }, children: [new TextRun({ font: FONT, text: reading, size: 17, color: '374151' })] }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Contents
  if (showToc) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ font: FONT, text: 'Contents' })] }));
    const tops = model.sections.filter((s) => (s.level ?? 1) === 1).map((s) => s.heading);
    if (ordered.length) tops.push('Sources');
    tops.forEach((h) => children.push(new Paragraph({ style: 'Body', numbering: { reference: 'mindy-numbers-toc', level: 0 }, children: [new TextRun({ font: FONT, size: 21, text: h })] })));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  // Body
  for (const s of model.sections) {
    const heading = s.level === 3 ? HeadingLevel.HEADING_3 : s.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1;
    children.push(new Paragraph({ heading, children: [new TextRun({ font: FONT, text: s.heading })] }));
    for (const b of s.blocks) children.push(...blockToDocx(b, numberOf));
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
      default: { document: { run: { font: FONT, size: 21, color: INK } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: FONT, size: 56, bold: true, color: '111827' }, paragraph: { spacing: { after: 160 } } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Body', quickFormat: true, run: { font: FONT, size: 32, bold: true, color: NAVY }, paragraph: { spacing: { before: 360, after: 140 }, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C7D2FE', space: 4 } } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Body', quickFormat: true, run: { font: FONT, size: 25, bold: true, color: '111827' }, paragraph: { spacing: { before: 280, after: 100 }, keepNext: true } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Body', quickFormat: true, run: { font: FONT, size: 22, bold: true, color: '111827' }, paragraph: { spacing: { before: 220, after: 80 }, keepNext: true } },
        { id: 'Body', name: 'Body', basedOn: 'Normal', run: { font: FONT, size: 21 }, paragraph: { spacing: { after: 140, line: 288 } } },
        { id: 'Caption', name: 'Caption', basedOn: 'Normal', run: { font: FONT, size: 17, color: MUTED }, paragraph: { spacing: { before: 60, after: 220 } } },
      ],
    },
    numbering: {
      config: [
        { reference: 'mindy-bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }] },
        { reference: 'mindy-numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 300 } } } }] },
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
