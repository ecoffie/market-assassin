/**
 * Shared, format-neutral helpers for the renderers: cell formatting, inline emphasis parsing,
 * citation numbering and claim labels. Every renderer uses these so a DOCX and a PDF of the same
 * model say exactly the same thing.
 */
import type { Block, CellValue, ChartBlock, Claim, ColumnFormat, DocModel, DocSource, TableBlock } from './model';
import { labeledUnits } from './model';

/** A missing value is "Not available", never 0 (CLAUDE.md: unknown ≠ zero). */
export const NOT_AVAILABLE = 'Not available';

/**
 * Release-stage mark printed in every document's footer (PDF and Word): research documents launch to every
 * customer as a beta (Eric, 2026-11-27). Change or empty this one constant when the stage changes.
 */
export const DOC_STAGE_MARK = 'Beta';

export function formatCell(v: CellValue, format: ColumnFormat = 'text'): string {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return NOT_AVAILABLE;
  if (typeof v === 'string') return v;
  switch (format) {
    case 'usd':
      return formatUsd(v);
    case 'int':
      return Math.round(v).toLocaleString('en-US');
    case 'pct':
      return formatPct(v);
    default:
      return String(v);
  }
}

/**
 * Percent display. The model may store a share either way, so the magnitude decides:
 *   |v| <= 1  → a FRACTION   (0.284 → 28.4%, 1 → 100%)
 *   |v| >  1  → PERCENT POINTS (40.93 → 40.9%, 100 → 100%)
 * Live failure (Koamana Build report): share 40.93 with format 'pct' rendered as "4,093%".
 * Known ambiguity: a true value under 1 percentage point stored as points (0.5 meaning 0.5%) reads as
 * 50%; store such values as fractions (0.005). The tool description tells the model so.
 */
export function formatPct(v: number): string {
  const points = Math.abs(v) <= 1 ? v * 100 : v;
  return `${points.toFixed(1)}%`;
}

/** Drop a trailing ".0" / ".00" so $30.0M reads $30M and $1.50B reads $1.5B. */
const trimZeros = (x: string) => x.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');

const USD_TIERS: Array<[number, string]> = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];

/** Natural precision for a compact dollar figure: 2 decimals under 10 (of its unit), 1 under 100, 0 above. */
function usdNaturalDecimals(abs: number): number {
  for (const [div] of USD_TIERS) {
    if (abs >= div) {
      const n = abs / div;
      if (div === 1e3) return n >= 100 ? 0 : 1;
      return n >= 10 ? 1 : 2;
    }
  }
  return abs % 1 === 0 ? 0 : 2;
}

/**
 * Client-ready dollars: $1.93B · $412.5M · $5.25M · $850K · $12.5K · $31.40. Never a raw 412500000.
 * With `decimals`, every compact figure uses exactly that precision (one column, one precision).
 */
export function formatUsd(v: number, decimals?: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  for (const [div, unit] of USD_TIERS) {
    if (abs >= div) {
      const n = (abs / div).toFixed(decimals ?? usdNaturalDecimals(abs));
      return `${sign}$${decimals === undefined ? trimZeros(n) : n}${unit}`;
    }
  }
  return `${sign}$${abs.toFixed(abs % 1 === 0 ? 0 : 2)}`;
}

/** The one precision a set of compact dollar figures should share: the most any of them needs (max 2). */
export function usdColumnDecimals(values: Array<number | null | undefined>): number {
  let d = 0;
  for (const v of values) {
    if (typeof v !== 'number' || Math.abs(v) < 1e3) continue;
    const natural = trimZeros(formatUsd(v).replace(/[^\d.]/g, ''));
    d = Math.max(d, natural.includes('.') ? natural.split('.')[1].length : 0);
  }
  return Math.min(d, 2);
}

/** Format a whole table column consistently ($151.0M beside $412.5M, never $151M). */
export function formatColumn(values: CellValue[], format: ColumnFormat = 'text'): string[] {
  if (format !== 'usd') return values.map((v) => formatCell(v, format));
  const d = usdColumnDecimals(values.map((v) => (typeof v === 'number' ? v : null)));
  return values.map((v) => (typeof v === 'number' && Math.abs(v) >= 1e3 ? formatUsd(v, d) : formatCell(v, format)));
}

/** A chart value in the chart's declared format; with none, large numbers still get separators. */
export function formatChartValue(v: number, format?: 'usd' | 'int' | 'pct', usdDecimals?: number): string {
  if (format === 'usd') return formatUsd(v, usdDecimals);
  if (format === 'pct') return trimZeros(formatPct(v).slice(0, -1)) + '%';
  if (format === 'int' || Math.abs(v) >= 1e4) return Math.round(v).toLocaleString('en-US');
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/**
 * Prose safety net. A raw "$412500000" becomes "$412.5M". A bare 7+ digit run gets separators ONLY
 * when it is plainly a quantity — a quantity word right after it ("30000000 dollars", "1250000 square
 * feet") or a quantity lead-in before it ("a total of", "about", "roughly", "over") — and never when an
 * identifier word precedes it (DUNS, UEI, PIID, IDIQ, contract, order, number, no., #, ZIP, phone, tel,
 * call, account, ID) or it starts with 0. Identifiers are text, not numbers: "DUNS 080053272" must keep
 * its leading zero (A4 MED-1).
 */
const QUANTITY_AFTER = /^\s+(?:dollars|usd|obligations|people|persons|users|employees|staff|square feet|sq\.? ?ft|acres|units|hours|contracts|awards|records|transactions|visits|students|veterans|beneficiaries|patients|miles|gallons|pounds|tons)\b/i;
const QUANTITY_BEFORE = /(?:\btotal(?: of)?|\babout|\bapproximately|\broughly|\bover|\bnearly|\balmost|\bmore than|\bless than|\bfewer than|\bup to)\s+$/i;
const ID_BEFORE = /(?:\b(?:DUNS|UEI|PIID|IDIQ|CAGE|contract|order|number|no\.|account|acct|ID|ZIP(?:\+4)?|phone|tel|fax|call|notice|solicitation|ref(?:erence)?)|#)\s*:?\s*$/i;

export function formatProseNumbers(text: string): string {
  return text
    .replace(/\$(\d{4,})(?![\d,.]*\d)/g, (_m, d: string) => formatUsd(Number(d)))
    .replace(/(?<![\w$.,#-])([1-9]\d{6,})(?![\w.,-]*\d|[A-Za-z-])/g, (m, d: string, offset: number, whole: string) => {
      const before = whole.slice(Math.max(0, offset - 30), offset);
      const after = whole.slice(offset + m.length, offset + m.length + 30);
      if (ID_BEFORE.test(before)) return m;
      return QUANTITY_AFTER.test(after) || QUANTITY_BEFORE.test(before) ? Number(d).toLocaleString('en-US') : m;
    });
}

export type InlineRun = { text: string; bold?: boolean; italic?: boolean };

/** Parse the only inline emphasis the model allows: **bold** and _italic_. Everything else is literal. */
export function parseInline(raw: string): InlineRun[] {
  const text = formatProseNumbers(raw);
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

/**
 * The visible label a claim carries. Facts carry their citation instead of a word label; context
 * (text about the document itself) carries none. There is no "Estimate" label.
 */
export function claimLabel(claim: Claim | undefined): string | null {
  if (claim === 'assumption') return 'Planning assumption';
  if (claim === 'recommendation') return 'Recommendation';
  if (claim === 'unverified') return 'Unverified: no source';
  return null;
}

/**
 * Client copy carries no em dashes (Eric, 2026-11-27). Applied at RENDER time to a copy of the model, after
 * validation, so grounding, citations and the stored model are untouched. A spaced or unspaced em dash between
 * words becomes ", " in running text and ": " in a heading or title; a leading or trailing one is dropped; a
 * cell that is only a dash means "no value" and reads Not available. En dashes (ranges such as FY2024–FY2026)
 * are kept.
 */
export function noEmDash(text: string, mode: 'text' | 'heading' = 'text'): string {
  if (!text.includes('\u2014')) return text;
  if (/^\s*\u2014\s*$/.test(text)) return NOT_AVAILABLE;
  return text
    .replace(/^\s*\u2014\s*|\s*\u2014\s*$/g, '')
    .replace(/\s*\u2014\s*/g, mode === 'heading' ? ': ' : ', ')
    .replace(/([,:])\s*([,:.;])/g, '$2');
}

/** The model with noEmDash applied to every string a reader sees (renderers call this; the stored model is unchanged). */
export function clientCopy(model: DocModel): DocModel {
  const t = (s: string | undefined) => (typeof s === 'string' ? noEmDash(s) : s);
  const h = (s: string | undefined) => (typeof s === 'string' ? noEmDash(s, 'heading') : s);
  const cell = (v: CellValue) => (typeof v === 'string' ? noEmDash(v) : v);
  const block = (b: Block): Block => {
    switch (b.type) {
      case 'paragraph':
      case 'callout':
        return { ...b, text: noEmDash(b.text), origin: t(b.origin) };
      case 'bullets':
        return { ...b, items: b.items.map((it) => ({ ...it, text: noEmDash(it.text), origin: t(it.origin) })) };
      case 'table':
        return { ...b, caption: t(b.caption), origin: t(b.origin), columns: b.columns.map((c) => ({ ...c, label: noEmDash(c.label, 'heading') })), rows: b.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)]))) };
      case 'chart':
        return { ...b, caption: t(b.caption), origin: t(b.origin), xLabel: t(b.xLabel), yLabel: t(b.yLabel), series: b.series.map((se) => ({ ...se, name: noEmDash(se.name), points: se.points.map((pt) => ({ ...pt, x: noEmDash(pt.x) })) })) };
      default:
        return b;
    }
  };
  return {
    ...model,
    title: noEmDash(model.title, 'heading'),
    subtitle: t(model.subtitle),
    preparedFor: t(model.preparedFor),
    meta: model.meta ? { ...model.meta, attention: t(model.meta.attention) } : model.meta,
    sources: model.sources.map((s) => ({ ...s, label: noEmDash(s.label) })),
    sections: model.sections.map((s) => ({ ...s, heading: h(s.heading)!, blocks: s.blocks.map(block) })),
  };
}

/** The origin sentence an assumption renders after its text (null for every other claim). */
export function assumptionOrigin(u: { claim?: Claim; origin?: string }): string | null {
  return u.claim === 'assumption' && typeof u.origin === 'string' && u.origin.trim() ? u.origin.trim() : null;
}

/** A CSS-safe class for the label (the unverified label contains spaces and a dash). */
export function claimClass(claim: Claim | undefined): string {
  return claim === 'assumption' || claim === 'recommendation' || claim === 'unverified' ? claim : '';
}

/** Every statement labeled unverified, in document order, for the "Unverified statements" list. */
export function unverifiedStatements(model: DocModel): Array<{ section: string; text: string }> {
  const out: Array<{ section: string; text: string }> = [];
  for (const sec of model.sections) {
    for (const b of sec.blocks) {
      for (const u of labeledUnits(b)) if (u.claim === 'unverified') out.push({ section: sec.heading, text: u.text });
    }
  }
  return out;
}

/** Which claim labels appear anywhere in the model (drives the "How to read" note). */
export function claimsPresent(model: DocModel): Set<Claim> {
  const set = new Set<Claim>();
  for (const sec of model.sections) for (const b of sec.blocks) for (const u of labeledUnits(b)) if (u.claim) set.add(u.claim);
  return set;
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

/**
 * Does an adjacent table already show every value this chart plots? True when, for every series
 * point, some row has the point's category in a text cell and its value in a number cell. Used by
 * the DOCX renderer (which draws a chart as a data table) to avoid printing the same numbers twice.
 */
export function chartDuplicatesTable(chart: ChartBlock, table: TableBlock): boolean {
  return chart.series.every((s) => s.points.every((p) => table.rows.some((r) => {
    const vals = Object.values(r);
    return vals.some((v) => typeof v === 'string' && v.trim() === p.x.trim()) && vals.some((v) => typeof v === 'number' && v === p.y);
  })));
}

/** The chart at `i` duplicates the table directly before or after it in the same section. */
export function chartShownByAdjacentTable(blocks: Block[], i: number): boolean {
  const b = blocks[i];
  if (!b || b.type !== 'chart') return false;
  return [blocks[i - 1], blocks[i + 1]].some((n) => n?.type === 'table' && chartDuplicatesTable(b, n));
}

/**
 * Titles and headings: a spaced em/en dash stays attached to the word before it, so a wrapped title
 * never starts a line with "— Research Report" (A5, v5). The space before the dash becomes a
 * non-breaking space (U+00A0); text is otherwise unchanged.
 */
export function keepDash(text: string): string {
  return text.replace(/[ \t]+([—–])/g, ' $1');
}

/**
 * A heading the model already numbered ("1. Executive summary", "2) Market size") loses that prefix
 * where the renderer numbers top-level sections itself, so the page never reads "1. 1. Executive
 * summary" and the contents list never disagrees with the body.
 */
export function stripHeadingNumber(heading: string): string {
  const t = heading.replace(/^\s*\d{1,2}[.)]\s+(?=\S)/, '');
  return t.trim() ? t : heading;
}
