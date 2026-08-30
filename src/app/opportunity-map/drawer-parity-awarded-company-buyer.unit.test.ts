/**
 * Zillow-parity Overview + value block for the three drawer datasets that lacked it — Awarded
 * (recompete), Companies, Government Buyers — replicating the pattern the open-opp drawer shipped
 * in PR #498 (activity row + freshness/source line) and PR #497 (M-Estimate price-at-top).
 *
 * Each new function lives in route.ts's injected client <script>. Extracted + eval'd here (same
 * technique as rc-traits.unit.test.ts) so the test tracks the SHIPPED source, not a copy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

function extractFn(name: string): string {
  const start = routeSrc.indexOf(`function ${name}(`);
  expect(start, `function ${name} must exist in route.ts`).toBeGreaterThan(-1);
  const open = routeSrc.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < routeSrc.length; i++) {
    const c = routeSrc[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return deEscape(routeSrc.slice(start, i + 1)); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// The drawer JS lives in a TS template literal, so a runtime `—` is written `\\u2014` in the
// raw source (the template emit halves the backslashes into the browser's <script>). De-escaping
// `\\` -> `\` here reproduces exactly what the browser runs.
function deEscape(s: string): string { return s.replace(/\\\\/g, '\\'); }

const esc = 'function esc(s){ return (s==null?"":String(s)).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]; }); }';

function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

// ── Awarded (Recompete) ──────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const recompeteActivitySec: (o: any, extra: any) => string =
  new Function(`${esc}${extractFn('recompeteActivitySec')}; return recompeteActivitySec;`)();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const recompeteFreshnessSec: (o: any) => string =
  new Function(`${esc}${extractFn('relTime')}${extractFn('recompeteFreshnessSec')}; return recompeteFreshnessSec;`)();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const recompeteValueTopHTML: (o: any) => string =
  // recompeteValueTopHTML now formats o.valueNum via fmtM (EXACT ceiling, not the rounded o.value
  // string) — so fmtM must be injected into the eval'd context alongside it.
  new Function(`${esc}${extractFn('fmtM')}${extractFn('recompeteValueTopHTML')}; return recompeteValueTopHTML;`)();

describe('Awarded/Recompete drawer — Zillow-parity Overview + value block', () => {
  it('activity row shows an expiry countdown from the real exp field', () => {
    const html = recompeteActivitySec({ exp: daysFromNow(180) }, {});
    expect(html).toContain('snapactivity');
    expect(html).toMatch(/Expires in \d+ months?/);
  });
  it('activity row shows "Expired" for a past exp, and omits the block entirely with no exp', () => {
    expect(recompeteActivitySec({ exp: daysFromNow(-10) }, {})).toContain('Expired');
    expect(recompeteActivitySec({ exp: '' }, {})).toBe('');
  });
  it('activity row appends a tracking count ONLY when >=2 (never fabricated)', () => {
    const withCount = recompeteActivitySec({ exp: daysFromNow(90) }, { trackingCount: 3 });
    expect(withCount).toContain('3 contractors tracking this');
    const noCount = recompeteActivitySec({ exp: daysFromNow(90) }, { trackingCount: 1 });
    expect(noCount).not.toContain('tracking this');
    const zeroCount = recompeteActivitySec({ exp: daysFromNow(90) }, { trackingCount: 0 });
    expect(zeroCount).not.toContain('tracking this');
  });
  it('freshness line cites USASpending + the real PIID, and includes "updated" only when synced is set', () => {
    const withSync = recompeteFreshnessSec({ sol: 'W912PL24C0001', synced: new Date().toISOString() });
    expect(withSync).toContain('snapfresh');
    expect(withSync).toContain('From USASpending award records');
    expect(withSync).toContain('PIID W912PL24C0001');
    expect(withSync).toMatch(/updated/);
    const noSync = recompeteFreshnessSec({ sol: 'W912PL24C0001', synced: null });
    expect(noSync).not.toMatch(/updated/);
    expect(noSync).not.toContain('Archived on SAM.gov'); // this is an award, not a SAM notice
  });
  it('value-top slot shows the real ceiling as a single headline number (no range/chart)', () => {
    const html = recompeteValueTopHTML({ value: '$4.2M' });
    expect(html).toContain('osec-value');
    expect(html).toContain('Contract value');
    expect(html).toContain('$4.2M');
    expect(html).not.toContain('vr-band'); // never a fabricated M-Estimate range for a real award
    expect(html).not.toContain('vrChart');
  });
  it('value-top slot is honest ("not disclosed") rather than fabricating a number', () => {
    const html = recompeteValueTopHTML({ value: '' });
    expect(html).toContain('osec-value');
    expect(html).toContain('Value not disclosed');
  });
  it('value-top shows the EXACT ceiling from valueNum, not the rounded o.value (Eric 2026-08-05 "don\'t round")', () => {
    // Real USASpending ceiling $575,284 must print in full sub-$1M — NOT the rounded "$575K" string.
    const html = recompeteValueTopHTML({ value: '$575K', valueNum: 575284 });
    expect(html).toContain('$575,284');   // exact, thousands-separated
    expect(html).not.toContain('$575K');  // the rounded string is gone when the raw number exists
    // >=$1M still abbreviates to $X.XM (same as the open drawer), from the raw number
    expect(recompeteValueTopHTML({ value: '$4M', valueNum: 4_236_900 })).toContain('$4.2M');
    // falls back to the pre-formatted string only when the raw number is absent
    expect(recompeteValueTopHTML({ value: '$4.2M' })).toContain('$4.2M');
  });
});

// ── Companies (Prime Contractors) ────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const companyMoney: (n: number) => string =
  new Function(`${extractFn('companyMoney')}; return companyMoney;`)();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const companyActivitySec: (c: any, extra: any) => string =
  new Function(`${esc}${extractFn('companyMoney')}${extractFn('relTime')}${extractFn('companyActivitySec')}; return companyActivitySec;`)();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const companyFreshnessSec: (c: any) => string =
  new Function(`${esc}${extractFn('relTime')}${extractFn('warehouseAsOfLabel')}${extractFn('companyFreshnessSec')}; return companyFreshnessSec;`)();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const companyValueTopHTML: (c: any) => string =
  new Function(`${esc}${extractFn('companyMoney')}${extractFn('companyValueTopHTML')}; return companyValueTopHTML;`)();

describe('companyMoney sanity (shared formatter used by the new blocks)', () => {
  it('formats real dollar totals', () => {
    expect(companyMoney(2_500_000)).toBe('$2.5M');
  });
});

describe('Companies drawer — Zillow-parity Overview + value block', () => {
  it('activity row shows "$X won across N awards"', () => {
    const html = companyActivitySec({ totalObligated: 2_500_000, awardCount: 7, recentAwards: [] }, {});
    expect(html).toContain('snapactivity');
    expect(html).toContain('$2.5M won across 7 awards');
  });
  it('activity row appends "most recent award <relTime>" only when a recentAwards date exists', () => {
    const withDate = companyActivitySec(
      { totalObligated: 1_000_000, awardCount: 2, recentAwards: [{ startDate: new Date().toISOString() }] }, {},
    );
    expect(withDate).toContain('most recent award');
    const noDate = companyActivitySec({ totalObligated: 1_000_000, awardCount: 2, recentAwards: [] }, {});
    expect(noDate).not.toContain('most recent award');
  });
  it('activity row appends a tracking count ONLY when >=2', () => {
    const html = companyActivitySec({ totalObligated: 1, awardCount: 1, recentAwards: [] }, { trackingCount: 5 });
    expect(html).toContain('5 contractors tracking this');
    const html2 = companyActivitySec({ totalObligated: 1, awardCount: 1, recentAwards: [] }, { trackingCount: 1 });
    expect(html2).not.toContain('tracking this');
  });
  it('freshness line cites BigQuery warehouse + the real UEI, with as-of when warehouseAsOf is set', () => {
    const html = companyFreshnessSec({
      uei: 'ABC123XYZ789',
      historySource: 'bigquery_normalized',
      warehouseAsOf: '2025-06-15T12:00:00.000Z',
    });
    expect(html).toContain('snapfresh');
    expect(html).toContain('BigQuery normalized warehouse');
    expect(html).toMatch(/As of Jun 15, 2025/);
    expect(html).toContain('UEI ABC123XYZ789');
    expect(html).not.toContain('From USASpending / BigQuery award history');
    expect(html).not.toMatch(/live USASpending/i);
  });
  it('value-top slot shows the real total won as a single headline number (no range/chart)', () => {
    const html = companyValueTopHTML({ totalObligated: 12_000_000 });
    expect(html).toContain('osec-value');
    expect(html).toContain('Total federal awards won');
    expect(html).toContain('$12.0M');
    expect(html).not.toContain('vr-band');
  });
  it('value-top adds a real "across N awards · M agencies" subline (Open-drawer parity)', () => {
    const html = companyValueTopHTML({ totalObligated: 12_000_000, awardCount: 7, distinctAgencyCount: 3 });
    expect(html).toContain('vr-sub');
    expect(html).toContain('across 7 awards');
    expect(html).toContain('3 agencies');
  });
  it('value-top slot is honest when the firm has no award history', () => {
    const html = companyValueTopHTML({ totalObligated: 0 });
    expect(html).toContain('No federal award history on file');
  });
});

// ── Government Buyers ────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buyerActivitySec: (b: any, extra: any) => string =
  new Function(`${esc}${extractFn('buyerActivitySec')}; return buyerActivitySec;`)();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buyerFreshnessSec: (b: any) => string =
  new Function(`${esc}${extractFn('buyerFreshnessSec')}; return buyerFreshnessSec;`)();

describe('Government Buyers drawer — Zillow-parity Overview (no value block — N/A for a person)', () => {
  it('activity row counts real open solicitations from opportunities[].active', () => {
    const html = buyerActivitySec(
      { opportunities: [{ active: true }, { active: true }, { active: false }], oppCount: 3 }, {},
    );
    expect(html).toContain('snapactivity');
    expect(html).toContain('Runs 2 open solicitations');
  });
  it('falls back to a total-on-record count when none are currently open, and omits when both are zero', () => {
    const fallback = buyerActivitySec({ opportunities: [{ active: false }], oppCount: 1 }, {});
    expect(fallback).toContain('1 solicitation');
    expect(fallback).toContain('on record');
    const empty = buyerActivitySec({ opportunities: [], oppCount: 0 }, {});
    expect(empty).toBe('');
  });
  it('activity row appends a tracking count ONLY when >=2', () => {
    const html = buyerActivitySec({ opportunities: [{ active: true }], oppCount: 1 }, { trackingCount: 4 });
    expect(html).toContain('4 contractors tracking this');
  });
  it('freshness line cites SAM.gov contact records + the real agency, with no fabricated "updated" clause', () => {
    const html = buyerFreshnessSec({ agency: 'Department of State' });
    expect(html).toContain('snapfresh');
    expect(html).toContain('From SAM.gov contact records');
    expect(html).toContain('Department of State');
    expect(html).not.toMatch(/updated/); // getBuyerDetail carries no per-contact sync timestamp
  });
});
