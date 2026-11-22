import { describe, expect, it } from 'vitest';
import { compareRuns, type GradeRow } from './compare';

// The fixture's official 2026-11-13 baseline (f03700fd), as graded rows.
const OFFICIAL: GradeRow[] = [
  { id: 'R1', verdict: 'fail' }, { id: 'R2', verdict: 'fail' }, { id: 'R3', verdict: 'pass' }, { id: 'R4', verdict: 'fail' },
  { id: 'R5', verdict: 'fail' }, { id: 'R6', verdict: 'fail' }, { id: 'R7', verdict: 'partial' }, { id: 'R8', verdict: 'partial' },
  { id: 'R9', verdict: 'fail' }, { id: 'R10', verdict: 'fail' },
];

describe('compareRuns', () => {
  it('identical runs: no regressions, all "same", natural id order (R2 before R10)', () => {
    const c = compareRuns(OFFICIAL, OFFICIAL);
    expect(c.regressions).toEqual([]);
    expect(c.rows.every((r) => r.change === 'same')).toBe(true);
    expect(c.rows.map((r) => r.id)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10']);
    expect(c.summary).toBe('before: 1 pass, 2 partial, 7 fail · after: 1 pass, 2 partial, 7 fail · no regressions');
  });

  it('pass > partial > fail: an improvement is not a regression; any drop is', () => {
    const after = OFFICIAL.map((r) => (r.id === 'R1' ? { ...r, verdict: 'pass' as const } : r.id === 'R3' ? { ...r, verdict: 'partial' as const } : r));
    const c = compareRuns(OFFICIAL, after);
    expect(c.rows.find((r) => r.id === 'R1')?.change).toBe('improved');
    expect(c.rows.find((r) => r.id === 'R3')?.change).toBe('regressed');
    expect(c.regressions).toEqual(['R3']);
    expect(c.summary).toMatch(/REGRESSED: R3 \(blocks release\)$/);
  });

  it('a scenario dropped from the after run is a regression; a new one is listed but not a pass credit', () => {
    const c = compareRuns(OFFICIAL, [...OFFICIAL.filter((r) => r.id !== 'R7'), { id: 'R11', verdict: 'pass' }]);
    expect(c.rows.find((r) => r.id === 'R7')).toMatchObject({ change: 'missing', after: null });
    expect(c.rows.find((r) => r.id === 'R11')).toMatchObject({ change: 'new', before: null });
    expect(c.regressions).toEqual(['R7']);
  });

  it('renders a markdown table with regressions in bold', () => {
    const c = compareRuns([{ id: 'R1', verdict: 'pass' }], [{ id: 'R1', verdict: 'fail' }]);
    expect(c.table).toBe('| Scenario | Before | After | Change |\n| --- | --- | --- | --- |\n| R1 | pass | fail | **regressed** |');
  });

  it('ignores malformed rows rather than crashing or counting them', () => {
    const c = compareRuns([{ id: 'R1', verdict: 'pass' }, { id: 'R2', verdict: 'maybe' as never }], [{ id: 'R1', verdict: 'pass' }]);
    expect(c.rows.map((r) => r.id)).toEqual(['R1']);
    expect(c.regressions).toEqual([]);
  });
});
