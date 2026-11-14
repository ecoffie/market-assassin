/**
 * Shared scope helpers for the Ask-Mindy-only BigQuery award aggregation tools
 * (get_buying_offices, get_vehicle_spend_mix).
 *
 * Every helper here exists so a caller's filter is either APPLIED or REPORTED as not applied,
 * never silently dropped (the P1-1 result contract). Inputs arrive from a model, so arrays,
 * comma lists and full state names are all accepted, and anything unrecognizable comes back in
 * `ignored` with a reason instead of widening the query.
 *
 * Fiscal-year partitions are the cost bound on `usaspending.awards` (PARTITION BY fiscal_year,
 * CLUSTER BY recipient): every query built from these helpers filters fiscal_year FIRST.
 */
import { normalizeStateCode } from '@/lib/utils/us-states';
import type { IgnoredArg } from '@/lib/mcp/result-contract';

/** Hard ceiling on a fiscal-year window. The dry-run byte guard is the real bound; this stops absurd input early. */
export const MAX_FY_SPAN = 6;

/** Bytes a single tool query may scan (the runtime ceiling in client.ts is 5 GiB; stay under it). */
export const TOOL_MAX_BYTES = Math.floor(4.5 * 1024 ** 3);

/** The latest COMPLETE federal fiscal year (FY N runs Oct 1 N-1 to Sep 30 N). */
export function latestCompleteFiscalYear(now: Date = new Date()): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1-12
  // On or after Oct 1, FY y+1 has started, so FY y is the latest complete one.
  return m >= 10 ? y : y - 1;
}

/** Federal fiscal year of an ISO date (YYYY-MM-DD). */
export function fiscalYearOfDate(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return mo >= 10 ? y + 1 : y;
}

function show(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > 80 ? `${s.slice(0, 77)}...` : String(s);
}

/** Accept a string (comma/space separated) or an array of strings; returns trimmed non-empty tokens. */
export function toTokens(raw: unknown, splitSpaces = true): string[] {
  const parts: string[] = [];
  const push = (s: string) => {
    const re = splitSpaces ? /[,;\s]+/ : /[,;]+/;
    for (const p of s.split(re)) {
      const t = p.trim();
      if (t) parts.push(t);
    }
  };
  if (typeof raw === 'string') push(raw);
  else if (Array.isArray(raw)) for (const x of raw) if (typeof x === 'string' || typeof x === 'number') push(String(x));
  return parts;
}

/** NAICS prefixes (2-6 digits). Invalid tokens are reported, never used. */
export function normalizeNaicsPrefixes(raw: unknown, arg = 'naics'): { codes: string[]; ignored: IgnoredArg[] } {
  const codes: string[] = [];
  const ignored: IgnoredArg[] = [];
  for (const t of toTokens(raw)) {
    if (/^\d{2,6}$/.test(t)) {
      if (!codes.includes(t)) codes.push(t);
    } else {
      ignored.push({ arg, value: show(t), reason: 'invalid_value', detail: 'NAICS must be 2-6 digits (a prefix is allowed)' });
    }
  }
  if (raw != null && typeof raw !== 'string' && !Array.isArray(raw)) {
    ignored.push({ arg, value: show(raw), reason: 'wrong_type', detail: 'expected a string or an array of strings' });
  }
  return { codes, ignored };
}

/** PSC prefixes (1-4 alphanumeric). Invalid tokens are reported, never used. */
export function normalizePscPrefixes(raw: unknown, arg = 'psc'): { codes: string[]; ignored: IgnoredArg[] } {
  const codes: string[] = [];
  const ignored: IgnoredArg[] = [];
  for (const t of toTokens(raw)) {
    const u = t.toUpperCase();
    if (/^[A-Z0-9]{1,4}$/.test(u)) {
      if (!codes.includes(u)) codes.push(u);
    } else {
      ignored.push({ arg, value: show(t), reason: 'invalid_value', detail: 'PSC must be 1-4 letters/digits (a prefix is allowed)' });
    }
  }
  return { codes, ignored };
}

/** One US state (code or full name) to its 2-letter code. */
export function normalizeStateArg(raw: unknown, arg = 'state'): { state: string | null; ignored: IgnoredArg[] } {
  if (raw == null || raw === '') return { state: null, ignored: [] };
  if (typeof raw !== 'string') {
    return { state: null, ignored: [{ arg, value: show(raw), reason: 'wrong_type', detail: 'expected one state as a string' }] };
  }
  const code = normalizeStateCode(raw);
  if (!code) return { state: null, ignored: [{ arg, value: show(raw), reason: 'invalid_value', detail: 'not a recognizable US state name or 2-letter code' }] };
  return { state: code, ignored: [] };
}

/**
 * City names as stored in `pop_city` (upper case, single-spaced). A trailing ", TN" or
 * " TN" state suffix is stripped. Commas split a string into several cities; spaces do not
 * (city names contain spaces).
 */
export function normalizeCities(...raws: unknown[]): string[] {
  const out: string[] = [];
  for (const raw of raws) {
    for (const t of toTokens(raw, false)) {
      // "Memphis, TN" splits into "Memphis" and "TN": a bare 2-letter state code is not a city.
      if (t.trim().length === 2 && normalizeStateCode(t.trim())) continue;
      const c = t
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .replace(/\s+[A-Z]{2}$/, (m) => (normalizeStateCode(m.trim()) ? '' : m))
        .replace(/[^A-Z0-9 .'-]/g, '')
        .trim();
      if (c && !out.includes(c)) out.push(c);
    }
  }
  return out;
}

export interface FyWindow {
  fy_from: number;
  fy_to: number;
  /** Exact action-date bounds when the caller gave dates (applied in addition to the FY partitions). */
  date_from: string | null;
  date_to: string | null;
  defaulted: boolean;
}

/**
 * Resolve the fiscal-year window. Dates win over fiscal years when both are given.
 * Default: the latest 3 complete fiscal years.
 */
export function resolveFyWindow(
  input: { fiscal_year?: unknown; fiscal_year_from?: unknown; fiscal_year_to?: unknown; date_from?: unknown; date_to?: unknown },
  now: Date = new Date(),
): { window: FyWindow; ignored: IgnoredArg[] } {
  const ignored: IgnoredArg[] = [];
  const latest = latestCompleteFiscalYear(now);
  const current = latest + 1;
  const asFy = (v: unknown, arg: string): number | null => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{4}$/.test(v.trim()) ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < 2015 || n > current) {
      ignored.push({ arg, value: show(v), reason: 'invalid_value', detail: `fiscal year must be 2015-${current}` });
      return null;
    }
    return n;
  };
  const asDate = (v: unknown, arg: string): string | null => {
    if (v == null || v === '') return null;
    if (typeof v !== 'string' || fiscalYearOfDate(v) == null) {
      ignored.push({ arg, value: show(v), reason: 'invalid_value', detail: 'expected YYYY-MM-DD' });
      return null;
    }
    return v.trim();
  };

  const dFrom = asDate(input.date_from, 'date_from');
  const dTo = asDate(input.date_to, 'date_to');
  const single = asFy(input.fiscal_year, 'fiscal_year');
  let from = asFy(input.fiscal_year_from, 'fiscal_year_from');
  let to = asFy(input.fiscal_year_to, 'fiscal_year_to');
  let defaulted = false;

  if (dFrom || dTo) {
    from = dFrom ? fiscalYearOfDate(dFrom) : null;
    to = dTo ? fiscalYearOfDate(dTo) : null;
    if (from == null) from = Math.max(2015, (to ?? current) - 2);
    if (to == null) to = current;
  } else if (single != null) {
    from = single;
    to = single;
  } else {
    if (from == null && to == null) defaulted = true;
    if (to == null) to = from != null ? Math.min(from + 2, current) : latest;
    if (from == null) from = to - 2;
  }
  from = Math.max(2015, from);
  to = Math.min(current, to);
  if (from > to) [from, to] = [to, from];
  if (to - from + 1 > MAX_FY_SPAN) {
    ignored.push({
      arg: 'fiscal_year_from',
      value: String(from),
      reason: 'unsupported_value',
      detail: `window capped at ${MAX_FY_SPAN} fiscal years; using FY${to - MAX_FY_SPAN + 1}-FY${to}`,
    });
    from = to - MAX_FY_SPAN + 1;
  }
  return { window: { fy_from: from, fy_to: to, date_from: dFrom, date_to: dTo, defaulted }, ignored };
}

/** SQL predicate text for the window (parameters: fyFrom, fyTo, dateFrom, dateTo). */
export function windowPredicate(w: FyWindow): string {
  const parts = ['fiscal_year BETWEEN @fyFrom AND @fyTo'];
  if (w.date_from) parts.push('action_date >= DATE(@dateFrom)');
  if (w.date_to) parts.push('action_date <= DATE(@dateTo)');
  return parts.join(' AND ');
}

export function windowParams(w: FyWindow): Record<string, unknown> {
  const p: Record<string, unknown> = { fyFrom: w.fy_from, fyTo: w.fy_to };
  if (w.date_from) p.dateFrom = w.date_from;
  if (w.date_to) p.dateTo = w.date_to;
  return p;
}

export function windowLabel(w: FyWindow): string {
  const fy = w.fy_from === w.fy_to ? `FY${w.fy_to}` : `FY${w.fy_from}-FY${w.fy_to}`;
  if (w.date_from || w.date_to) return `${w.date_from ?? '...'} to ${w.date_to ?? '...'} (${fy} partitions)`;
  return `${fy} (federal fiscal years, Oct 1 - Sep 30)`;
}

/** BigQuery DATE values arrive as { value: 'YYYY-MM-DD' } objects; strings pass through. */
export function bqDateString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (typeof v === 'object' && v && typeof (v as { value?: unknown }).value === 'string') return (v as { value: string }).value.slice(0, 10);
  return null;
}

export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
