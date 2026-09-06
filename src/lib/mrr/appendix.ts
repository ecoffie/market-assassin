/**
 * Sourced Evidence Appendix.
 *
 * Generated from the SAME `RenderedCell` objects the document rendered — never
 * reconstructed from logs afterwards. That is the point: if provenance were
 * rebuilt later, the appendix could disagree with the document it certifies.
 *
 * Emits a standalone .docx built with `docx` (this is a NEW document, so the
 * builder is the right tool; only the MRR itself must preserve Ralph's template).
 *
 * Pagination (LibreOffice / Word scar): adjacent tables with no separating
 * paragraph are merged into one continuing table. The first table's `tblHeader`
 * then repeats on later pages (wrong caption, duplicate column headers), and a
 * caption/header can be stranded at the bottom of a page without a body row.
 * Each physical page pack is therefore one independent table — caption +
 * five-column header + at least one body row — closed before the next pack, with
 * a document-level page-break paragraph between packs.
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, TableLayoutType, PageOrientation, convertInchesToTwip,
  PageBreak,
} from 'docx';
import { writeFileSync } from 'node:fs';
import type { RenderedCell } from './grounding';
import type { ToolCall } from './mindy-client';
import { PROTOTYPE_BANNER } from './docx-fill';

const BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
  left: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
  right: { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
  insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
};

export const APPENDIX_PAGE_WIDTH_TWIP = 12240;
export const APPENDIX_PAGE_HEIGHT_TWIP = 15840;
export const APPENDIX_MARGIN_TWIP = convertInchesToTwip(0.75);
export const APPENDIX_TABLE_WIDTH_DXA = 9360;
export const APPENDIX_PRINTABLE_HEIGHT_TWIP =
  APPENDIX_PAGE_HEIGHT_TWIP - 2 * APPENDIX_MARGIN_TWIP;
export const APPENDIX_PRINTABLE_WIDTH_TWIP =
  APPENDIX_PAGE_WIDTH_TWIP - 2 * APPENDIX_MARGIN_TWIP;

/**
 * Worst-case 8pt Times glyph advance. Larger → fewer chars/line → taller
 * estimates → fewer rows packed into a table. LibreOffice wrap is wider than
 * Word's 8pt average (~80 twip).
 */
export const APPENDIX_CHAR_WIDTH_TWIP = 130;
/** Conservative single-line pitch (LibreOffice has measured taller than Word's 240). */
export const APPENDIX_LINE_HEIGHT_TWIP = 360;
export const APPENDIX_CELL_PAD_TWIP = 100;
/** Borders, page-break paragraph, and LibreOffice row-pitch slack. */
export const APPENDIX_PAGE_SAFETY_TWIP = 2400;
export const APPENDIX_PAGE_TABLE_BUDGET_TWIP =
  APPENDIX_PRINTABLE_HEIGHT_TWIP - APPENDIX_PAGE_SAFETY_TWIP;

export const APPENDIX_FIELD_HEADERS = [
  'Field',
  'State',
  'Rendered value',
  'Source',
  'Retrieved (UTC)',
] as const;

export const APPENDIX_FIELD_COL_WIDTHS = [2059, 1123, 2434, 2059, 1685] as const;
export const APPENDIX_QUERY_HEADERS = ['Tool', 'Parameters', 'Outcome', 'Retrieved (UTC)'] as const;
export const APPENDIX_QUERY_COL_WIDTHS = [2246, 4306, 1123, 1685] as const;
export const APPENDIX_CHECK_HEADERS = ['Check', 'Result', 'Detail'] as const;
export const APPENDIX_CHECK_COL_WIDTHS = [3182, 1123, 5055] as const;

const CELL_H_PAD = 160;

export function appendixInnerWidth(colWidthDxa: number): number {
  return Math.max(1, colWidthDxa - CELL_H_PAD);
}

export function appendixCharsPerLine(colWidthDxa: number): number {
  return Math.max(1, Math.floor(appendixInnerWidth(colWidthDxa) / APPENDIX_CHAR_WIDTH_TWIP));
}

export function estimateWrappedLines(text: string, colWidthDxa: number): number {
  const cols = appendixCharsPerLine(colWidthDxa);
  if (text.length === 0) return 1;
  let lines = 0;
  for (const para of text.split('\n')) {
    lines += Math.max(1, Math.ceil(para.length / cols));
  }
  return lines;
}

export function estimateRowHeightTwip(
  cellTexts: readonly string[],
  colWidths: readonly number[],
): number {
  let lines = 1;
  for (let i = 0; i < cellTexts.length; i++) {
    const width = colWidths[i] ?? colWidths[colWidths.length - 1] ?? APPENDIX_TABLE_WIDTH_DXA;
    lines = Math.max(lines, estimateWrappedLines(cellTexts[i] ?? '', width));
  }
  return lines * APPENDIX_LINE_HEIGHT_TWIP + APPENDIX_CELL_PAD_TWIP;
}

export function appendixHeaderRowHeightTwip(
  headers: readonly string[] = APPENDIX_FIELD_HEADERS,
  widths: readonly number[] = APPENDIX_FIELD_COL_WIDTHS,
): number {
  return estimateRowHeightTwip(headers, widths);
}

/** Worst-case group caption used when the final "N of M" is not yet known. */
export const APPENDIX_WORST_CAPTION = 'Rendered fields group 99 (99 of 99)';

export function estimateCaptionRowHeightTwip(caption: string): number {
  return estimateRowHeightTwip([caption], [APPENDIX_TABLE_WIDTH_DXA]);
}

export function appendixTableChromeHeightTwip(
  caption: string,
  headers: readonly string[] = APPENDIX_FIELD_HEADERS,
  widths: readonly number[] = APPENDIX_FIELD_COL_WIDTHS,
): number {
  return estimateCaptionRowHeightTwip(caption) + appendixHeaderRowHeightTwip(headers, widths);
}

export function appendixSafeBodyRowBudgetTwip(
  headers: readonly string[] = APPENDIX_FIELD_HEADERS,
  widths: readonly number[] = APPENDIX_FIELD_COL_WIDTHS,
  caption: string = APPENDIX_WORST_CAPTION,
): number {
  return APPENDIX_PAGE_TABLE_BUDGET_TWIP - appendixTableChromeHeightTwip(caption, headers, widths);
}

export function estimateTableChunkHeightTwip(
  caption: string,
  headers: readonly string[],
  widths: readonly number[],
  bodyRows: readonly (readonly string[])[],
): number {
  let height = appendixTableChromeHeightTwip(caption, headers, widths);
  for (const row of bodyRows) {
    height += estimateRowHeightTwip(row, widths);
  }
  return height;
}

function computeSafeContentChars(
  colWidthDxa: number,
  headers: readonly string[],
  widths: readonly number[],
): number {
  const budget = appendixSafeBodyRowBudgetTwip(headers, widths);
  const lines = Math.max(
    1,
    Math.floor((budget - APPENDIX_CELL_PAD_TWIP) / APPENDIX_LINE_HEIGHT_TWIP),
  );
  return lines * appendixCharsPerLine(colWidthDxa);
}

/** Max characters allowed in one cantSplit evidence-value cell. */
export const APPENDIX_SAFE_CONTENT_CHARS = computeSafeContentChars(
  APPENDIX_FIELD_COL_WIDTHS[2],
  APPENDIX_FIELD_HEADERS,
  APPENDIX_FIELD_COL_WIDTHS,
);

export const APPENDIX_SAFE_PROSE_CHARS = computeSafeContentChars(
  APPENDIX_TABLE_WIDTH_DXA,
  APPENDIX_FIELD_HEADERS,
  [APPENDIX_TABLE_WIDTH_DXA],
);

export const APPENDIX_SAFE_ROW_HEIGHT_TWIP = appendixSafeBodyRowBudgetTwip();

export function isEffortsToLocateLabel(label: string): boolean {
  return /efforts to locate sources/i.test(label);
}

/**
 * Lossless split. `chunks.join('') === text`. Prefers a whitespace cut in the
 * second half of the window; otherwise hard-splits so a long token still fits.
 */
export function chunkEvidenceText(text: string, maxChars: number): string[] {
  if (maxChars < 1) throw new Error('appendix content budget must be positive');
  if (text.length === 0) return [''];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = maxChars;
    const space = rest.lastIndexOf(' ', maxChars);
    if (space >= Math.floor(maxChars * 0.5)) cut = space;
    if (cut < 1) cut = maxChars;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  chunks.push(rest);
  return chunks;
}

export function chunkTextToFitHeight(
  text: string,
  colWidthDxa: number,
  maxHeightTwip: number,
): string[] {
  const fits = (piece: string) =>
    estimateRowHeightTwip([piece], [colWidthDxa]) <= maxHeightTwip;
  if (fits(text)) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    if (fits(rest)) {
      chunks.push(rest);
      break;
    }
    let lo = 1;
    let hi = rest.length;
    let best = 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(rest.slice(0, mid))) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    let cut = best;
    if (best < rest.length) {
      const space = rest.lastIndexOf(' ', best);
      if (space >= Math.floor(best * 0.5) && space >= 1) cut = space;
    }
    if (cut < 1) cut = Math.min(rest.length, 1);
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return chunks;
}

export interface AppendixFieldRow {
  label: string;
  continued: boolean;
  state: string;
  value: string;
  source: string;
  retrievedAt: string;
}

function continuedLabel(label: string): string {
  return /\(continued\)\s*$/.test(label) ? label : `${label} (continued)`;
}

function splitFieldRow(row: AppendixFieldRow, maxHeightTwip: number): AppendixFieldRow[] {
  const height = estimateRowHeightTwip(fieldRowTexts(row), APPENDIX_FIELD_COL_WIDTHS);
  if (height <= maxHeightTwip) return [row];

  const candidates: Array<{ key: 'label' | 'value' | 'source'; width: number; text: string }> = [
    { key: 'value', width: APPENDIX_FIELD_COL_WIDTHS[2], text: row.value },
    { key: 'source', width: APPENDIX_FIELD_COL_WIDTHS[3], text: row.source },
    { key: 'label', width: APPENDIX_FIELD_COL_WIDTHS[0], text: row.label },
  ];
  candidates.sort((a, b) => b.text.length - a.text.length);
  const target = candidates.find((c) => c.text.length > 1);
  if (!target) return [row];

  let chunks = chunkTextToFitHeight(target.text, target.width, maxHeightTwip);
  if (chunks.length < 2) {
    const mid = Math.max(1, Math.floor(target.text.length / 2));
    const space = target.text.lastIndexOf(' ', mid);
    const cut = space >= 1 ? space : mid;
    chunks = [target.text.slice(0, cut), target.text.slice(cut)];
  }
  if (chunks.some((piece) => piece.length === 0) || chunks.join('') !== target.text) {
    chunks = [target.text.slice(0, 1), target.text.slice(1)].filter((piece) => piece.length > 0);
  }

  const out: AppendixFieldRow[] = [];
  for (const [index, piece] of chunks.entries()) {
    const next: AppendixFieldRow = {
      ...row,
      [target.key]: piece,
      label: index === 0 ? row.label : continuedLabel(row.label),
      continued: row.continued || index > 0,
    };
    out.push(...splitFieldRow(next, maxHeightTwip));
  }
  return out;
}

export function expandRenderedField(
  cell: Pick<RenderedCell, 'label' | 'state' | 'text' | 'evidence'>,
  maxHeightTwip: number = APPENDIX_SAFE_ROW_HEIGHT_TWIP,
): AppendixFieldRow[] {
  const ev = cell.evidence[0];
  return splitFieldRow({
    label: cell.label,
    continued: false,
    state: STATE_LABEL[cell.state],
    value: cell.text,
    source: ev?.source ?? '—',
    retrievedAt: ev?.retrievedAt ?? '—',
  }, maxHeightTwip);
}

export function fieldRowTexts(row: AppendixFieldRow): string[] {
  return [row.label, row.state, row.value, row.source, row.retrievedAt];
}

export function groupRowsToPageTables<T>(
  rows: T[],
  rowHeight: (row: T) => number,
  headerHeight: number,
  budgetTwip: number = APPENDIX_PAGE_TABLE_BUDGET_TWIP,
): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let used = headerHeight;
  const flush = () => {
    if (current.length === 0) return;
    groups.push(current);
    current = [];
    used = headerHeight;
  };
  for (const row of rows) {
    const height = rowHeight(row);
    if (current.length > 0 && used + height > budgetTwip) flush();
    current.push(row);
    used += height;
  }
  flush();
  return groups;
}

function p(text: string, opts: {
  bold?: boolean;
  size?: number;
  after?: number;
  pageBreakBefore?: boolean;
  keepNext?: boolean;
} = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 100 },
    pageBreakBefore: opts.pageBreakBefore,
    keepNext: opts.keepNext,
    children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 20, font: 'Times New Roman' })],
  });
}

/**
 * @param width column width in DXA twips (1/20 pt). ABSOLUTE, not percentage:
 * a percentage width emits no usable `w:tcW`, so a fixed-layout renderer collapses
 * every column into one. The page body is ~9360 twips wide at 0.75in margins.
 */
function c(text: string, width: number, bold = false) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({ children: [new TextRun({ text, bold, size: 16, font: 'Times New Roman' })] })],
  });
}

function headerRow(labels: readonly string[], widths: readonly number[]): TableRow {
  return new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: labels.map((label, i) => c(label, widths[i]!, true)),
  });
}

function captionHeaderRow(caption: string, columnCount: number): TableRow {
  return new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: [
      new TableCell({
        width: { size: APPENDIX_TABLE_WIDTH_DXA, type: WidthType.DXA },
        columnSpan: columnCount,
        margins: { top: 40, bottom: 40, left: 80, right: 80 },
        children: [new Paragraph({
          spacing: { after: 0, before: 0 },
          children: [new TextRun({ text: caption, bold: true, size: 16, font: 'Times New Roman' })],
        })],
      }),
    ],
  });
}

function bodyRow(texts: readonly string[], widths: readonly number[]): TableRow {
  return new TableRow({
    cantSplit: true,
    children: texts.map((text, i) => c(text, widths[i]!, false)),
  });
}

/** Document-level page break so LibreOffice cannot merge adjacent tables. */
export function appendixPageBreakParagraph(): Paragraph {
  return new Paragraph({
    spacing: { before: 0, after: 0 },
    children: [new PageBreak()],
  });
}

function makeTable(widths: readonly number[], rows: TableRow[]): Table {
  return new Table({
    width: { size: APPENDIX_TABLE_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: [...widths],
    layout: TableLayoutType.FIXED,
    borders: BORDERS,
    rows,
  });
}

export interface AppendixInput {
  requirementTitle: string;
  solicitationNumber?: string;
  noticeId?: string;
  generatedAt: string;
  runId: string;
  cells: RenderedCell[];
  calls: ToolCall[];
  /** The rejected predecessor candidate, preserved for review. */
  rejectedCandidate?: { source?: string; checks: Array<{ name: string; passed: boolean; detail: string }>; candidate?: Record<string, unknown> };
  limitations: string[];
}

const STATE_LABEL: Record<RenderedCell['state'], string> = {
  value: 'Sourced value',
  true_zero: 'Measured zero',
  unknown: 'Unknown / insufficient evidence',
  degraded: 'Degraded',
};

function pushFieldTables(
  children: Array<Paragraph | Table>,
  rows: AppendixFieldRow[],
  caption: string,
): void {
  if (rows.length === 0) return;
  const chrome = appendixTableChromeHeightTwip(APPENDIX_WORST_CAPTION, APPENDIX_FIELD_HEADERS, APPENDIX_FIELD_COL_WIDTHS);
  const packs = groupRowsToPageTables(
    rows,
    (row) => estimateRowHeightTwip(fieldRowTexts(row), APPENDIX_FIELD_COL_WIDTHS),
    chrome,
  ).filter((group) => group.length > 0);
  packs.forEach((group, index) => {
    const part = index + 1;
    const title = packs.length > 1 ? `${caption} (${part} of ${packs.length})` : caption;
    children.push(appendixPageBreakParagraph());
    const tableRows: TableRow[] = [
      captionHeaderRow(title, APPENDIX_FIELD_COL_WIDTHS.length),
      headerRow(APPENDIX_FIELD_HEADERS, APPENDIX_FIELD_COL_WIDTHS),
    ];
    for (const row of group) {
      tableRows.push(bodyRow(fieldRowTexts(row), APPENDIX_FIELD_COL_WIDTHS));
    }
    children.push(makeTable(APPENDIX_FIELD_COL_WIDTHS, tableRows));
  });
}

function pushEffortsBlock(
  children: Array<Paragraph | Table>,
  cell: RenderedCell,
): void {
  const ev = cell.evidence[0];
  const state = STATE_LABEL[cell.state];
  const source = ev?.source ?? '—';
  const retrievedAt = ev?.retrievedAt ?? '—';
  const chunks = chunkTextToFitHeight(
    cell.text,
    APPENDIX_TABLE_WIDTH_DXA,
    APPENDIX_PAGE_TABLE_BUDGET_TWIP - 4 * (APPENDIX_LINE_HEIGHT_TWIP + 100),
  );
  chunks.forEach((chunk, index) => {
    const title = index === 0
      ? cell.label
      : `${cell.label} (continued)`;
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_3,
      pageBreakBefore: true,
      spacing: { after: 120 },
      children: [new TextRun({ text: title, font: 'Times New Roman', bold: true, size: 22 })],
    }));
    children.push(p(`State: ${state}`, { after: 40 }));
    children.push(p(`Source: ${source}`, { after: 40 }));
    children.push(p(`Retrieved (UTC): ${retrievedAt}`, { after: 40 }));
    children.push(p('Rendered value:', { bold: true, after: 40 }));
    children.push(p(chunk, { after: 160, size: 20 }));
  });
}

function pushPagedTable<T>(
  children: Array<Paragraph | Table>,
  items: T[],
  headers: readonly string[],
  widths: readonly number[],
  textsOf: (item: T) => string[],
  caption: string,
  pageBreakFirst = true,
): void {
  if (items.length === 0) return;
  const chrome = appendixTableChromeHeightTwip(APPENDIX_WORST_CAPTION, headers, widths);
  const bodyBudget = appendixSafeBodyRowBudgetTwip(headers, widths);
  const expanded: string[][] = [];
  for (const item of items) {
    const texts = textsOf(item);
    const valueIndex = texts.reduce((best, t, i) => (t.length > texts[best]!.length ? i : best), 0);
    const chunks = chunkTextToFitHeight(texts[valueIndex]!, widths[valueIndex]!, bodyBudget);
    chunks.forEach((chunk, index) => {
      const next = [...texts];
      next[valueIndex] = chunk;
      if (index > 0 && headers[0]) {
        next[0] = `${texts[0]} (continued)`;
      }
      expanded.push(next);
    });
  }
  const packs = groupRowsToPageTables(
    expanded,
    (row) => estimateRowHeightTwip(row, widths),
    chrome,
  ).filter((group) => group.length > 0);
  packs.forEach((group, index) => {
    const title = packs.length > 1 ? `${caption} (${index + 1} of ${packs.length})` : caption;
    if (pageBreakFirst || index > 0) {
      children.push(appendixPageBreakParagraph());
    }
    const tableRows: TableRow[] = [
      captionHeaderRow(title, widths.length),
      headerRow(headers, widths),
    ];
    for (const row of group) {
      tableRows.push(bodyRow(row, widths));
    }
    children.push(makeTable(widths, tableRows));
  });
}

export function buildAppendixDoc(input: AppendixInput): Document {
  const children: Array<Paragraph | Table> = [];

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Sourced Evidence Appendix', font: 'Times New Roman', bold: true, size: 30 })] }));
  children.push(p(PROTOTYPE_BANNER, { bold: true }));
  children.push(p(`Requirement: ${input.requirementTitle}`));
  if (input.solicitationNumber) children.push(p(`Solicitation: ${input.solicitationNumber}`));
  if (input.noticeId) children.push(p(`SAM notice ID: ${input.noticeId}`));
  children.push(p(`Run ID: ${input.runId}`));
  children.push(p(`Generated: ${input.generatedAt}`, { after: 240 }));

  children.push(p(
    'Every value rendered in the accompanying Market Research Report appears below with its source, ' +
    'retrieval time, and the exact query used. Fields recorded as Unknown, Degraded, or Measured zero are ' +
    'listed with the same provenance so that missing, failed, and genuinely-zero results remain distinguishable.',
    { after: 240 },
  ));

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: '1. Rendered fields', font: 'Times New Roman', bold: true, size: 24 })] }));

  let pending: AppendixFieldRow[] = [];
  let fieldPart = 0;
  const flushPending = () => {
    if (pending.length === 0) return;
    fieldPart += 1;
    pushFieldTables(children, pending, `Rendered fields group ${fieldPart}`);
    pending = [];
  };
  for (const cell of input.cells) {
    if (isEffortsToLocateLabel(cell.label)) {
      flushPending();
      pushEffortsBlock(children, cell);
      continue;
    }
    pending.push(...expandRenderedField(cell));
  }
  flushPending();

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    pageBreakBefore: true,
    keepNext: true,
    spacing: { before: 80, after: 80 },
    children: [new TextRun({ text: '2. Queries executed', font: 'Times New Roman', bold: true, size: 24 })],
  }));
  children.push(p('Every Mindy tool call made during this run, with its exact parameters and outcome.', {
    after: 160,
    keepNext: true,
  }));
  pushPagedTable(
    children,
    input.calls,
    APPENDIX_QUERY_HEADERS,
    APPENDIX_QUERY_COL_WIDTHS,
    (call) => [
      call.tool,
      JSON.stringify(call.args),
      call.ok ? 'returned' : `failed: ${call.error ?? 'unknown error'}`,
      call.evidence.retrievedAt,
    ],
    'Queries executed',
    false,
  );

  if (input.rejectedCandidate) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      pageBreakBefore: true,
      keepNext: true,
      spacing: { before: 80, after: 80 },
      children: [new TextRun({ text: '3. Predecessor candidate not accepted', font: 'Times New Roman', bold: true, size: 24 })],
    }));
    children.push(p(
      'The following award was returned by ' + (input.rejectedCandidate.source ?? 'a predecessor lookup') +
      ' but did not satisfy the consistency checks required to render it as a predecessor. It is preserved here for reviewer judgement and is NOT asserted as the incumbent.',
      { after: 160, keepNext: true },
    ));
    const cand = input.rejectedCandidate.candidate ?? {};
    for (const k of ['recipientName', 'awardId', 'awardingSubAgency', 'awardingAgency', 'naicsCode', 'matchConfidence', 'usaSpendingUrl']) {
      if (cand[k] !== undefined && cand[k] !== null) children.push(p(`${k}: ${String(cand[k])}`, { after: 40, keepNext: true }));
    }
    pushPagedTable(
      children,
      input.rejectedCandidate.checks,
      APPENDIX_CHECK_HEADERS,
      APPENDIX_CHECK_COL_WIDTHS,
      (ck) => [ck.name, ck.passed ? 'PASS' : 'FAIL', ck.detail],
      'Predecessor checks',
      false,
    );
  }

  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    pageBreakBefore: true,
    spacing: { before: 80 },
    children: [new TextRun({ text: '4. Known limitations', font: 'Times New Roman', bold: true, size: 24 })],
  }));
  for (const l of input.limitations) children.push(p(`• ${l}`, { after: 60 }));

  return new Document({
    sections: [{
      properties: {
        page: {
          size: { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11), orientation: PageOrientation.PORTRAIT },
          margin: {
            top: convertInchesToTwip(0.75), bottom: convertInchesToTwip(0.75),
            left: convertInchesToTwip(0.75), right: convertInchesToTwip(0.75),
          },
        },
      },
      children,
    }],
  });
}

export async function writeAppendix(input: AppendixInput, outPath: string): Promise<void> {
  const buf = await Packer.toBuffer(buildAppendixDoc(input));
  writeFileSync(outPath, buf);
}
