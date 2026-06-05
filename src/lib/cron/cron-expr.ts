/**
 * Tiny self-contained cron-expression evaluator. No heavy dependency
 * (the PRD asks to avoid one). Supports the standard 5 fields:
 *
 *   ┌─ minute (0-59)
 *   │ ┌─ hour (0-23)
 *   │ │ ┌─ day of month (1-31)
 *   │ │ │ ┌─ month (1-12)
 *   │ │ │ │ ┌─ day of week (0-6, Sun=0)
 *   * * * * *
 *
 * Each field supports: `*`, a number, a list `a,b,c`, a range `a-b`,
 * and a step `*​/n` or `a-b/n`. That covers everything our cron entries
 * use. Evaluation is in UTC — the dispatcher runs in UTC and so do all
 * our current vercel.json crons.
 *
 * We don't compute "next run". We answer one question per tick:
 * `isDue(expr, now)` — does this minute match the expression? The
 * dispatcher pairs that with a per-job last_run check so a job fires at
 * most once per matching minute even if a tick is retried.
 */

type FieldRange = { min: number; max: number };

const FIELDS: FieldRange[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 },  // day of week (Sun=0)
];

// Expand a single cron field into the set of matching integers.
function parseField(field: string, range: FieldRange): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    // step: "*/n" or "a-b/n" or "a/n"
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? parseInt(stepPart, 10) : 1;
    if (!Number.isFinite(step) || step < 1) throw new Error(`Bad step in cron field: ${part}`);

    let lo: number;
    let hi: number;
    if (rangePart === '*') {
      lo = range.min;
      hi = range.max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-').map((n) => parseInt(n, 10));
      lo = a;
      hi = b;
    } else {
      lo = parseInt(rangePart, 10);
      hi = stepPart ? range.max : lo; // "a/n" means from a to max stepping n
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      throw new Error(`Bad cron field: ${part}`);
    }
    for (let v = lo; v <= hi; v += step) {
      if (v >= range.min && v <= range.max) out.add(v);
    }
  }
  return out;
}

export interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

export function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields, got ${fields.length}: "${expr}"`);
  }
  return {
    minute: parseField(fields[0], FIELDS[0]),
    hour: parseField(fields[1], FIELDS[1]),
    dom: parseField(fields[2], FIELDS[2]),
    month: parseField(fields[3], FIELDS[3]),
    dow: parseField(fields[4], FIELDS[4]),
  };
}

/**
 * Does `date` (evaluated in UTC) match the cron expression for its minute?
 *
 * Standard cron day semantics: if BOTH day-of-month and day-of-week are
 * restricted (not `*`), the job runs when EITHER matches (OR). If only one
 * is restricted, only that one must match. We approximate "is restricted"
 * as "does not cover the full range".
 */
export function isDue(expr: string, date: Date): boolean {
  let p: ParsedCron;
  try {
    p = parseCron(expr);
  } catch {
    return false; // a malformed expression never fires (and is surfaced elsewhere)
  }
  const min = date.getUTCMinutes();
  const hr = date.getUTCHours();
  const dom = date.getUTCDate();
  const mon = date.getUTCMonth() + 1;
  const dow = date.getUTCDay();

  if (!p.minute.has(min)) return false;
  if (!p.hour.has(hr)) return false;
  if (!p.month.has(mon)) return false;

  const domRestricted = p.dom.size < FIELDS[2].max - FIELDS[2].min + 1;
  const dowRestricted = p.dow.size < FIELDS[4].max - FIELDS[4].min + 1;

  if (domRestricted && dowRestricted) {
    return p.dom.has(dom) || p.dow.has(dow);
  }
  if (domRestricted) return p.dom.has(dom);
  if (dowRestricted) return p.dow.has(dow);
  return true; // both wildcard
}

/** Validate an expression up front (used by the admin endpoint). */
export function validateCron(expr: string): { valid: boolean; error?: string } {
  try {
    parseCron(expr);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: (e as Error).message };
  }
}
