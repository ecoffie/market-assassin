/**
 * Sourced Evidence Appendix.
 *
 * Generated from the SAME `RenderedCell` objects the document rendered — never
 * reconstructed from logs afterwards. That is the point: if provenance were
 * rebuilt later, the appendix could disagree with the document it certifies.
 *
 * Emits a standalone .docx built with `docx` (this is a NEW document, so the
 * builder is the right tool; only the MRR itself must preserve Ralph's template).
 */
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, TableLayoutType, PageOrientation, convertInchesToTwip,
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

function p(text: string, opts: { bold?: boolean; size?: number; after?: number } = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 100 },
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

export interface AppendixInput {
  requirementTitle: string;
  solicitationNumber?: string;
  noticeId?: string;
  generatedAt: string;
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

export function buildAppendixDoc(input: AppendixInput): Document {
  const children: Array<Paragraph | Table> = [];

  children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Sourced Evidence Appendix', font: 'Times New Roman', bold: true, size: 30 })] }));
  children.push(p(PROTOTYPE_BANNER, { bold: true }));
  children.push(p(`Requirement: ${input.requirementTitle}`));
  if (input.solicitationNumber) children.push(p(`Solicitation: ${input.solicitationNumber}`));
  if (input.noticeId) children.push(p(`SAM notice ID: ${input.noticeId}`));
  children.push(p(`Generated: ${input.generatedAt}`, { after: 240 }));

  children.push(p(
    'Every value rendered in the accompanying Market Research Report appears below with its source, ' +
    'retrieval time, and the exact query used. Fields recorded as Unknown, Degraded, or Measured zero are ' +
    'listed with the same provenance so that missing, failed, and genuinely-zero results remain distinguishable.',
    { after: 240 },
  ));

  // ---- 1. field-level evidence (chunked so every continuation page gets a full header) ----
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: '1. Rendered fields', font: 'Times New Roman', bold: true, size: 24 })] }));
  const FIELD_CHUNK = 40;
  for (let offset = 0; offset < input.cells.length; offset += FIELD_CHUNK) {
    const chunk = input.cells.slice(offset, offset + FIELD_CHUNK);
    const part = Math.floor(offset / FIELD_CHUNK) + 1;
    const parts = Math.ceil(input.cells.length / FIELD_CHUNK);
    if (parts > 1) {
      children.push(p(`Rendered fields (${part} of ${parts})`, { bold: true, after: 80 }));
    }
    const rows: TableRow[] = [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: [
          c('Field', 2059, true),
          c('State', 1123, true),
          c('Rendered value', 2434, true),
          c('Source', 2059, true),
          c('Retrieved (UTC)', 1685, true),
        ],
      }),
    ];
    for (const cell of chunk) {
      const ev = cell.evidence[0];
      rows.push(new TableRow({
        cantSplit: true,
        children: [
          c(cell.label, 2059),
          c(STATE_LABEL[cell.state], 1123),
          c(cell.text, 2434),
          c(ev?.source ?? '—', 2059),
          c(ev?.retrievedAt ?? '—', 1685),
        ],
      }));
    }
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      borders: BORDERS,
      rows,
    }));
  }

  // ---- 2. exact queries ----
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 320 }, children: [new TextRun({ text: '2. Queries executed', font: 'Times New Roman', bold: true, size: 24 })] }));
  children.push(p('Every Mindy tool call made during this run, with its exact parameters and outcome.', { after: 160 }));
  const qrows: TableRow[] = [
    new TableRow({ tableHeader: true, cantSplit: true, children: [c('Tool', 2246, true), c('Parameters', 4306, true), c('Outcome', 1123, true), c('Retrieved (UTC)', 1685, true)] }),
  ];
  for (const call of input.calls) {
    qrows.push(new TableRow({
      cantSplit: true,
      children: [
        c(call.tool, 2246),
        c(JSON.stringify(call.args), 4306),
        c(call.ok ? 'returned' : `failed: ${call.error ?? 'unknown error'}`, 1123),
        c(call.evidence.retrievedAt, 1685),
      ],
    }));
  }
  children.push(new Table({ width: { size: 9360, type: WidthType.DXA }, layout: TableLayoutType.FIXED, borders: BORDERS, rows: qrows }));

  // ---- 3. rejected predecessor candidate ----
  if (input.rejectedCandidate) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 320 }, children: [new TextRun({ text: '3. Predecessor candidate not accepted', font: 'Times New Roman', bold: true, size: 24 })] }));
    children.push(p(
      'The following award was returned by ' + (input.rejectedCandidate.source ?? 'a predecessor lookup') +
      ' but did not satisfy the consistency checks required to render it as a predecessor. It is preserved here for reviewer judgement and is NOT asserted as the incumbent.',
      { after: 160 },
    ));
    const cand = input.rejectedCandidate.candidate ?? {};
    for (const k of ['recipientName', 'awardId', 'awardingSubAgency', 'awardingAgency', 'naicsCode', 'matchConfidence', 'usaSpendingUrl']) {
      if (cand[k] !== undefined && cand[k] !== null) children.push(p(`${k}: ${String(cand[k])}`, { after: 40 }));
    }
    const crows: TableRow[] = [new TableRow({ tableHeader: true, cantSplit: true, children: [c('Check', 3182, true), c('Result', 1123, true), c('Detail', 5054, true)] })];
    for (const ck of input.rejectedCandidate.checks) {
      crows.push(new TableRow({ cantSplit: true, children: [c(ck.name, 3182), c(ck.passed ? 'PASS' : 'FAIL', 1123), c(ck.detail, 5054)] }));
    }
    children.push(new Table({ width: { size: 9360, type: WidthType.DXA }, layout: TableLayoutType.FIXED, borders: BORDERS, rows: crows }));
  }

  // ---- 4. limitations ----
  children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 320 }, children: [new TextRun({ text: '4. Known limitations', font: 'Times New Roman', bold: true, size: 24 })] }));
  for (const l of input.limitations) children.push(p(`• ${l}`, { after: 60 }));

  // US LETTER, explicitly. The `docx` builder defaults to A4, which is why the
  // LibreOffice render came back A4 — a US government contract file is Letter.
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
