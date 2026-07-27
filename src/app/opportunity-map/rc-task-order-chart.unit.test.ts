/**
 * Unit test for the bucketed payout chart (`bucketedChart`) shared by the Awarded task-order
 * block AND the Company award-history block.
 *
 * Eric 2026-07-27: "condense over a time period so you can see the numbers." The old chart drew
 * one bar per payout (188 raw bars = an unreadable picket fence with no values). `bucketedChart`
 * SUMS obligations into time PERIODS (quarter when the span ≤3 years, else year) and labels the $
 * on each bar. It must:
 *   - SKIP rows with a null / non-positive / non-numeric obligation, and undated rows
 *   - return '' when fewer than 2 PERIODS result (a single bar isn't a trend)
 *   - bucket by quarter for a short span, by year for a multi-year span
 *   - render a real $ label per bucket (the readability fix)
 *
 * Extracted from route.ts and evaled with its `esc`/`mMoney` deps so the test tracks shipped source.
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
    else if (c === '}') { depth--; if (depth === 0) return routeSrc.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// bucketedChart depends on esc() and mMoney() — provide simple stand-ins so the pure logic runs.
const harness = `
  function esc(s){ return String(s==null?'':s); }
  function mMoney(v){ if(v==null||!isFinite(v)||v<=0)return ''; if(v>=1e9)return '$'+(v/1e9).toFixed(1)+'B'; if(v>=1e6)return '$'+(v/1e6).toFixed(1)+'M'; if(v>=1e3)return '$'+Math.round(v/1e3)+'K'; return '$'+Math.round(v); }
`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bucketedChart: (txns: any[], label?: string) => string =
  new Function(`${harness}${extractFn('bucketedChart')}; return bucketedChart;`)();

describe('bucketedChart — condensed, labeled payout chart', () => {
  it('returns "" when fewer than 2 periods result (a single bar is not a trend)', () => {
    expect(bucketedChart([])).toBe('');
    expect(bucketedChart([{ obligation: 1e6, actionDate: '2026-01-01' }])).toBe('');
    // Two payouts in the SAME quarter (both Q1 2026) → one bucket → still "".
    expect(bucketedChart([
      { obligation: 1e6, actionDate: '2026-01-05' },
      { obligation: 2e6, actionDate: '2026-03-20' },
    ])).toBe('');
  });

  it('buckets a short span by QUARTER and sums each period, labeling the $', () => {
    const html = bucketedChart([
      { obligation: 4e6, actionDate: '2026-01-12' }, // Q1 '26
      { obligation: 6e6, actionDate: '2026-02-01' }, // Q1 '26 → sums to $10.0M
      { obligation: 3e6, actionDate: '2026-05-01' }, // Q2 '26
    ]);
    expect(html).toContain('By quarter');
    expect(html).toContain('rc-bkchart');
    expect(html).toContain('$10.0M'); // Q1 sum labeled on the bar (the readability fix)
    expect(html).toContain('$3.0M');  // Q2 sum
  });

  it('buckets a multi-year span by YEAR', () => {
    const html = bucketedChart([
      { obligation: 4e6, actionDate: '2019-03-13' },
      { obligation: 1.7e6, actionDate: '2021-08-01' },
      { obligation: 2e6, actionDate: '2023-09-28' },
      { obligation: 5e6, actionDate: '2026-01-12' },
    ]);
    expect(html).toContain('By year');
    expect(html).toContain('2019');
    expect(html).toContain('2026');
  });

  it('skips null / zero / non-numeric obligations and undated rows', () => {
    const html = bucketedChart([
      { obligation: 4e6, actionDate: '2024-01-12' },   // Q1 '24
      { obligation: null, actionDate: '2024-02-13' },  // skipped
      { obligation: 0, actionDate: '2025-01-14' },     // skipped
      { obligation: 'n/a', actionDate: '2025-01-15' }, // skipped
      { obligation: 6e6, actionDate: null },           // undated → skipped
      { obligation: 5e6, actionDate: '2026-01-16' },   // Q1 '26
    ]);
    // Only the 2024 and 2026 rows survive → 2 buckets → a chart renders. Span ≤3yr → quarter labels.
    // (The apostrophe is the source's literal ’ escape — matched verbatim from the eval'd fn.)
    expect(html).not.toBe('');
    expect(html).toContain('Q1 \\u201924');
    expect(html).toContain('Q1 \\u201926');
  });
});
