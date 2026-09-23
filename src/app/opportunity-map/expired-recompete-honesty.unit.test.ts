/**
 * Expired recompete honesty (Eric 2026-07-27, the NRWA case): a contract past its period-of-performance
 * end already recompeted — its follow-on is (or soon will be) awarded, so it's a dead lead, not a live
 * "get ahead of the rebid" target. Two fixes:
 *  1) the Recompetes view FILTERS OUT past-expiry rows. Since Phase C2 (2026-09-22) this is canonical Recompete
 *     policy (the discovery plan's `gte today`), shared with MCP; the ?includePast opt-in is retired;
 *  2) any expired row that surfaces elsewhere reads "Expired" + shows the YEAR, never "Recompete now"/
 *     "Expiring now" (which the same-year year-strip would have hidden).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapsRecompeteRequest } from '@/lib/recompete/maps-recompete-discovery';

const tmpl = readFileSync(join(__dirname, 'template.html'), 'utf8');
const route = readFileSync(join(__dirname, '../api/app/recompete-map/route.ts'), 'utf8');

function extractFn(src: string, name: string) {
  const s = src.indexOf(`function ${name}(`); const o = src.indexOf('{', s); let d = 0;
  for (let i = o; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return src.slice(s, i + 1); } }
  throw new Error(name + ' not found');
}
const TODAY = new Date(2026, 6, 27, 12, 0, 0);
const shortDate = new Function('TODAY', extractFn(tmpl, 'shortDate') + ';return shortDate;')(TODAY);
const dueDate = (o: any) => o.exp;
const fmtDays = new Function('TODAY', 'dueDate', extractFn(tmpl, 'daysOut') + extractFn(tmpl, 'fmtDays') + ';return fmtDays;')(TODAY, dueDate);
const daysOut = new Function('TODAY', 'dueDate', extractFn(tmpl, 'daysOut') + ';return daysOut;')(TODAY, dueDate);

describe('shortDate — year shown when it matters, compact only for future same-year', () => {
  it('a PAST date always shows its year (an expired contract cannot read as this-year-and-fine)', () => {
    expect(shortDate('2026-04-30')).toBe('Apr 30, 2026'); // NRWA — expired, same year, year MUST show
  });
  it('a future same-year date is compact (no year)', () => {
    expect(shortDate('2026-09-05')).toBe('Sep 5');
  });
  it('a different-year date always shows the year', () => {
    expect(shortDate('2027-04-30')).toBe('Apr 30, 2027');
    expect(shortDate('2030-12-31')).toBe('Dec 31, 2030');
  });
});

describe('fmtDays — an expired recompete reads "Expired", never a live window', () => {
  it('past end date → "Expired" (not "Expiring now"/"Recompete now")', () => {
    const pill = fmtDays(daysOut({ exp: '2026-04-30' }), true);
    expect(pill.t).toBe('Expired');
    expect(pill.t).not.toBe('Expiring now');
    expect(pill.t).not.toContain('Recompete');
  });
  it('upcoming (<=90d) → "Expiring soon"; still-running → "Active — subcontract"', () => {
    expect(fmtDays(daysOut({ exp: '2026-08-20' }), true).t).toBe('Expiring soon');
    expect(fmtDays(daysOut({ exp: '2028-01-01' }), true).t).toBe('Active — subcontract');
  });
});

describe('recompete-map never shows past-expiry contracts (canonical Recompete policy)', () => {
  it('the plan the route executes always bounds PoP end at today — ?includePast no longer widens it', () => {
    const ctx = { today: '2026-09-22', fiscalYear: 2026 };
    for (const params of [{}, { includePast: '1' }, { q: 'janitorial', includePast: '1' }] as Array<Record<string, string>>) {
      const ops = mapsRecompeteRequest((k) => params[k] ?? null, { ctx }).plan.horizons.recompete.ops;
      expect(ops).toContainEqual({ op: 'gte', col: 'period_of_performance_current_end', val: '2026-09-22' });
    }
    expect(route).not.toMatch(/p\.get\('includePast'\)/);
    expect(route).toContain('mapsRecompeteRequest(');
  });
});
