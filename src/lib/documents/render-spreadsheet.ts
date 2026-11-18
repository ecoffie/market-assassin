/**
 * DocModel → XLSX / CSV. Tables become sheets (or CSV rows); when there are no tables,
 * a Summary sheet carries section headings + paragraph text so a spreadsheet request
 * still produces a usable file.
 */
import type { DocModel, TableBlock } from './model';
import { formatColumn, fileBaseName } from './format';

export type SpreadsheetSheet = {
  name: string;
  headers: string[];
  rows: string[][];
};

const SHEET_NAME_MAX = 31;

/** Excel sheet names: no \ / ? * [ ], ≤31 chars, unique. */
export function safeSheetName(raw: string, used: Set<string>): string {
  let base = String(raw || 'Sheet')
    .replace(/[\\/?*[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SHEET_NAME_MAX) || 'Sheet';
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n++})`;
    name = `${base.slice(0, SHEET_NAME_MAX - suffix.length)}${suffix}`;
  }
  used.add(name.toLowerCase());
  return name;
}

function tableToSheet(t: TableBlock, sectionHeading: string, used: Set<string>): SpreadsheetSheet {
  const label = t.caption?.trim() || sectionHeading || t.id || 'Table';
  const headers = t.columns.map((c) => c.label || c.key);
  const cols = t.columns.map((c) => {
    const values = t.rows.map((r) => r[c.key] ?? null);
    return formatColumn(values, c.format ?? 'text');
  });
  const rows: string[][] = t.rows.map((_, i) => cols.map((col) => col[i] ?? ''));
  return { name: safeSheetName(label, used), headers, rows };
}

function summarySheet(model: DocModel, used: Set<string>): SpreadsheetSheet {
  const rows: string[][] = [];
  for (const sec of model.sections ?? []) {
    for (const b of sec.blocks ?? []) {
      if (b.type === 'paragraph' && b.text?.trim()) {
        rows.push([sec.heading || '', b.text.trim()]);
      } else if (b.type === 'bullets' && Array.isArray(b.items)) {
        for (const item of b.items) {
          const text = String(item?.text || '').trim();
          if (text) rows.push([sec.heading || '', text]);
        }
      } else if (b.type === 'callout' && b.text?.trim()) {
        rows.push([sec.heading || '', b.text.trim()]);
      }
    }
  }
  if (!rows.length) rows.push(['Document', model.title || 'Untitled']);
  return {
    name: safeSheetName('Summary', used),
    headers: ['Section', 'Text'],
    rows,
  };
}

/** Flatten a DocModel into spreadsheet sheets (tables first; Summary if none). */
export function sheetsFromDocModel(model: DocModel): SpreadsheetSheet[] {
  const used = new Set<string>();
  const sheets: SpreadsheetSheet[] = [];
  for (const sec of model.sections ?? []) {
    for (const b of sec.blocks ?? []) {
      if (b.type === 'table' && b.columns?.length) sheets.push(tableToSheet(b, sec.heading || '', used));
    }
  }
  if (!sheets.length) sheets.push(summarySheet(model, used));
  return sheets;
}

export function modelHasTables(model: DocModel): boolean {
  return (model.sections ?? []).some((sec) => (sec.blocks ?? []).some((b) => b.type === 'table' && (b.columns?.length ?? 0) > 0));
}

/** Whole-cell formatted number from formatColumn (e.g. -5, -$5, -$1.5M) — not a DDE/formula payload. */
const SAFE_LEADING_MINUS_NUMBER = /^-\$?[\d,]+(?:\.\d+)?[KMB%]?$/;

/**
 * Escape one CSV field (RFC 4180) and neutralize spreadsheet formula injection.
 * Cells that start with = + - @ TAB or CR become formulas in Excel when opened —
 * prefix with a single quote so they stay text. Only a whole-cell formatted number
 * that starts with `-` (or `-$`) is exempt; `-1+cmd|…` is not.
 */
export function csvEscape(v: string): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !SAFE_LEADING_MINUS_NUMBER.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function sheetsToCsv(sheets: SpreadsheetSheet[]): string {
  // One table → clean CSV. Multiple → sheet title rows separated by a blank line.
  const parts: string[] = [];
  for (const s of sheets) {
    if (sheets.length > 1) parts.push(csvEscape(s.name));
    parts.push(s.headers.map(csvEscape).join(','));
    for (const row of s.rows) parts.push(row.map((c) => csvEscape(String(c ?? ''))).join(','));
    if (sheets.length > 1) parts.push('');
  }
  return parts.join('\r\n');
}

export async function renderXlsx(model: DocModel): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const s of sheetsFromDocModel(model)) {
    const aoa = [s.headers, ...s.rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

export function renderCsv(model: DocModel): Buffer {
  return Buffer.from(sheetsToCsv(sheetsFromDocModel(model)), 'utf-8');
}

export function spreadsheetFilename(model: DocModel, ext: 'xlsx' | 'csv'): string {
  return `${fileBaseName(model.title)}.${ext}`;
}
