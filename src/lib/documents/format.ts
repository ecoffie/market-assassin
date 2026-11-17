/**
 * Shared, format-neutral helpers for the renderers: cell formatting, inline emphasis parsing,
 * citation numbering and claim labels. Every renderer uses these so a DOCX and a PDF of the same
 * model say exactly the same thing.
 */
import type { CellValue, Claim, ColumnFormat, DocModel, DocSource } from './model';
import { labeledUnits } from './model';

/** A missing value is "Not available", never 0 (CLAUDE.md: unknown ≠ zero). */
export const NOT_AVAILABLE = 'Not available';

export function formatCell(v: CellValue, format: ColumnFormat = 'text'): string {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return NOT_AVAILABLE;
  if (typeof v === 'string') return v;
  switch (format) {
    case 'usd': {
      const abs = Math.abs(v);
      const sign = v < 0 ? '-' : '';
      if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(abs >= 1e10 ? 1 : 2)}B`;
      if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
      if (abs >= 1e3) return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
      return `${sign}$${abs.toFixed(abs % 1 === 0 ? 0 : 2)}`;
    }
    case 'int':
      return Math.round(v).toLocaleString('en-US');
    case 'pct':
      // Values are fractions (0.284 → 28.4%).
      return `${(v * 100).toFixed(1)}%`;
    default:
      return String(v);
  }
}

export type InlineRun = { text: string; bold?: boolean; italic?: boolean };

/** Parse the only inline emphasis the model allows: **bold** and _italic_. Everything else is literal. */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const re = /(\*\*([^*]+)\*\*|(?<![\w])_([^_]+)_(?![\w]))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[2] !== undefined) runs.push({ text: m[2], bold: true });
    else runs.push({ text: m[3], italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length ? runs : [{ text }];
}

/**
 * Number sources in order of first citation; sources never cited follow, in model order. The
 * returned list is what the "Sources" section prints, and `numberOf` maps a source id to its [n].
 */
export function citationIndex(model: DocModel): { ordered: DocSource[]; numberOf: (id: string) => number | null } {
  const byId = new Map(model.sources.map((s) => [s.id, s]));
  const order: string[] = [];
  const seen = new Set<string>();
  for (const sec of model.sections) {
    for (const b of sec.blocks) {
      for (const u of labeledUnits(b)) {
        for (const c of u.cites ?? []) {
          if (byId.has(c) && !seen.has(c)) { seen.add(c); order.push(c); }
        }
      }
    }
  }
  for (const s of model.sources) if (!seen.has(s.id)) order.push(s.id);
  const ordered = order.map((id) => byId.get(id)!).filter(Boolean);
  const num = new Map(ordered.map((s, i) => [s.id, i + 1]));
  return { ordered, numberOf: (id) => num.get(id) ?? null };
}

/** "[1, 3]" for a block's cites, or '' when none resolve. */
export function citeMarker(cites: string[] | undefined, numberOf: (id: string) => number | null): string {
  const nums = Array.from(new Set((cites ?? []).map(numberOf).filter((n): n is number => n !== null))).sort((a, b) => a - b);
  return nums.length ? `[${nums.join(', ')}]` : '';
}

/** The visible label a claim carries. Facts carry their citation instead of a word label. */
export function claimLabel(claim: Claim | undefined): string | null {
  if (claim === 'estimate') return 'Estimate';
  if (claim === 'recommendation') return 'Recommendation';
  return null;
}

/** "17 November 2026" from YYYY-MM-DD, rendered in UTC so the date never shifts by time zone. */
export function formatDocDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(d);
}

/** A filesystem-safe base name for the downloaded file. */
export function fileBaseName(title: string): string {
  const base = title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return base || 'Mindy-document';
}
