/**
 * Unit test for the Awarded/Recompete task-order BAR-CHART-OVER-TIME data prep.
 *
 * The chart (added below the summary card, above the dated list in taskOrderStreamHTML)
 * turns the task-order TIME SERIES into plain-CSS bars — each bar = one task order,
 * positioned earliest→latest, height = obligation $ scaled to the max. The pure data-prep
 * fn `rcChartData(txns)` (in route.ts's injected drawer JS) must:
 *   - SKIP rows with a null / non-positive / non-numeric obligation (can't plot "—")
 *   - SKIP rows with no parseable action_date (can't place them on a time axis)
 *   - return NULL when fewer than 3 plottable bars remain (a 1–2-bar chart is noise)
 *   - sort chronologically and expose first/last dates + the max obligation
 *
 * We extract the function body straight out of route.ts and eval it (no DOM needed) so the
 * test tracks the SHIPPED source, not a copy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

// Pull `function rcChartData(txns){ ... }` out of the drawer JS string. The body is written as
// a normal JS function inside a template-literal block, so it evals directly.
function extractFn(name: string): string {
  const start = routeSrc.indexOf(`function ${name}(`);
  expect(start, `function ${name} must exist in route.ts`).toBeGreaterThan(-1);
  // Walk braces from the first '{' after the signature to find the matching close.
  const open = routeSrc.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < routeSrc.length; i++) {
    const c = routeSrc[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return routeSrc.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rcChartData: (txns: any[]) => any = new Function(`${extractFn('rcChartData')}; return rcChartData;`)();

describe('rcChartData — task-order-over-time bar prep', () => {
  it('returns null for fewer than 3 plottable task orders (a 1–2 bar chart is silly)', () => {
    expect(rcChartData([])).toBeNull();
    expect(rcChartData([{ obligation: 1e6, actionDate: '2026-01-01' }])).toBeNull();
    expect(rcChartData([
      { obligation: 1e6, actionDate: '2026-01-01' },
      { obligation: 2e6, actionDate: '2026-02-01' },
    ])).toBeNull();
  });

  it('builds a chart from 3+ dated, positive-$ orders (sorted, with first/last + max)', () => {
    const cd = rcChartData([
      { obligation: 4e6, actionDate: '2026-01-12' },
      { obligation: 12.4e6, actionDate: '2025-12-15' },
      { obligation: 3e6, actionDate: '2026-03-01' },
    ]);
    expect(cd).not.toBeNull();
    expect(cd.points).toHaveLength(3);
    // chronological: Dec 15 2025 → Jan 12 2026 → Mar 1 2026
    expect(cd.first).toBe('2025-12-15');
    expect(cd.last).toBe('2026-03-01');
    expect(cd.max).toBe(12.4e6);
    // sorted ascending by timestamp
    for (let i = 1; i < cd.points.length; i++) {
      expect(cd.points[i].ts).toBeGreaterThanOrEqual(cd.points[i - 1].ts);
    }
  });

  it('skips null / zero / non-numeric obligations (they stay in the list, not the chart)', () => {
    const cd = rcChartData([
      { obligation: 4e6, actionDate: '2026-01-12' },
      { obligation: null, actionDate: '2026-01-13' },   // "—" row → skipped
      { obligation: 0, actionDate: '2026-01-14' },      // zero → skipped
      { obligation: 'n/a', actionDate: '2026-01-15' },  // non-numeric → skipped
      { obligation: 5e6, actionDate: '2026-01-16' },
      { obligation: 6e6, actionDate: '2026-01-17' },
    ]);
    // 3 positive-$ rows survive → a chart of exactly 3 bars
    expect(cd).not.toBeNull();
    expect(cd.points).toHaveLength(3);
  });

  it('skips rows with no parseable action_date (cannot place on a time axis)', () => {
    const cd = rcChartData([
      { obligation: 4e6, actionDate: '2026-01-12' },
      { obligation: 5e6, actionDate: null },       // undated → skipped
      { obligation: 6e6, actionDate: '' },          // undated → skipped
      { obligation: 7e6, actionDate: 'not-a-date' },// unparseable → skipped
      { obligation: 8e6, actionDate: '2026-02-01' },
    ]);
    // only 2 dated positive-$ rows → below the 3-bar floor → null
    expect(cd).toBeNull();
  });
});
