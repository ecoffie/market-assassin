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
const bucketedChart: (txns: any[], label?: string, fixedWindow?: boolean) => string =
  new Function(`${harness}${extractFn('bucketedChart')}; return bucketedChart;`)();

describe('bucketedChart — ALWAYS by year, no quarters (Eric 2026-07-28)', () => {
  it('returns "" when fewer than 2 payouts (a single bar is not a trend)', () => {
    expect(bucketedChart([])).toBe('');
    expect(bucketedChart([{ obligation: 1e6, actionDate: '2026-01-01' }])).toBe('');
  });

  it('buckets by YEAR (never quarter), summing each year and labeling the $', () => {
    const html = bucketedChart([
      { obligation: 4e6, actionDate: '2024-01-12' },
      { obligation: 6e6, actionDate: '2024-08-01' }, // 2024 sums to $10.0M
      { obligation: 3e6, actionDate: '2025-05-01' }, // 2025
    ]);
    expect(html).not.toContain('By quarter');
    expect(html).not.toContain('Q1');
    expect(html).toContain('$10.0M'); // 2024 sum
    expect(html).toContain('$3.0M');  // 2025 sum
    expect(html).toContain('2024');
    expect(html).toContain('2025');
  });

  it('task-order chart (fixedWindow=false) trims to the LAST 5 years present', () => {
    const html = bucketedChart([
      { obligation: 4e6, actionDate: '2019-03-13' },
      { obligation: 1.7e6, actionDate: '2021-08-01' },
      { obligation: 2e6, actionDate: '2023-09-28' },
      { obligation: 5e6, actionDate: '2026-01-12' },
    ], 'x', false);
    expect(html).toContain('By year');
    expect(html).toContain('2026');
  });

  it('skips null / zero / non-numeric / undated rows', () => {
    const html = bucketedChart([
      { obligation: 4e6, actionDate: '2024-01-12' },
      { obligation: null, actionDate: '2024-02-13' },  // skipped
      { obligation: 0, actionDate: '2025-01-14' },     // skipped
      { obligation: 'n/a', actionDate: '2025-01-15' }, // skipped
      { obligation: 6e6, actionDate: null },           // undated → skipped
      { obligation: 5e6, actionDate: '2025-06-16' },
    ]);
    expect(html).not.toBe('');
    expect(html).toContain('2024');
    expect(html).toContain('2025');
  });
});

describe('bucketedChart fixedWindow=true — SAME 5 years for everyone, $0 shows $0', () => {
  it('renders exactly the current-year-back-4 window regardless of the data span', () => {
    const now = new Date().getFullYear();
    // Only two award years, both recent — the other window years must still appear as $0.
    const html = bucketedChart([
      { obligation: 5e6, actionDate: (now - 1) + '-03-01' },
      { obligation: 3e6, actionDate: now + '-02-01' },
    ], 'Award $ by year', true);
    for (let y = now - 4; y <= now; y++) expect(html, `year ${y} column`).toContain(String(y));
    expect(html).toContain('Last 5 years');
  });

  it('a year with no awards shows a $0 bar (the gap is the signal, not hidden)', () => {
    const now = new Date().getFullYear();
    const html = bucketedChart([
      { obligation: 5e6, actionDate: (now - 4) + '-03-01' }, // oldest window year
      { obligation: 3e6, actionDate: now + '-02-01' },       // current year — the 3 middle years are $0
    ], 'Award $ by year', true);
    expect(html).toContain('$0');            // the empty years are labeled $0
    expect(html).toContain('rc-bkbar-zero'); // and render as the faint baseline tick
  });
});
