/**
 * Document text extraction — the ONE pipeline for user-supplied files.
 *
 * Moved verbatim from src/app/api/app/proposal/upload/route.ts (2026-11-17) so Ask Mindy chat
 * uploads and Proposal AI share the same parsers instead of growing a second pipeline. Behavior is
 * unchanged: PDF text layer via pdf-parse (no OCR), DOCX via mammoth, every XLSX sheet flattened to
 * CSV, TXT as UTF-8. Type is inferred from MIME or extension.
 *
 * Neutral module: nothing here may import Proposal AI business logic (src/lib/proposal/*).
 */

export type ExtractKind = 'pdf' | 'docx' | 'txt' | 'xlsx';

export type ExtractResult = {
  text: string;
  pageCount?: number;
};

export async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return { text: result.text || '', pageCount: result.total };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

export async function extractDocx(buffer: Buffer): Promise<ExtractResult> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return { text: result.value || '' };
}

// Pricing schedules are usually .xlsx (Eric: "we DID support xlsx, what
// changed?"). The xlsx lib is already a dependency; flatten every sheet to text
// (CSV per sheet) so pricing line items + CLINs become readable.
export async function extractXlsx(buffer: Buffer): Promise<ExtractResult> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) parts.push(`### Sheet: ${sheetName}\n${csv}`);
  }
  return { text: parts.join('\n\n') };
}

export function inferKind(name: string, mime: string): ExtractKind | null {
  const lower = name.toLowerCase();
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    return 'docx';
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel' ||
    lower.endsWith('.xlsx') || lower.endsWith('.xls')
  ) {
    return 'xlsx';
  }
  if (mime === 'text/plain' || lower.endsWith('.txt')) return 'txt';
  return null;
}

/** Extract text for an already-inferred kind. Throws on a parse failure (callers decide the response). */
export async function extractByKind(kind: ExtractKind, buffer: Buffer): Promise<ExtractResult> {
  if (kind === 'pdf') return extractPdf(buffer);
  if (kind === 'docx') return extractDocx(buffer);
  if (kind === 'xlsx') return extractXlsx(buffer);
  return { text: buffer.toString('utf-8') };
}
