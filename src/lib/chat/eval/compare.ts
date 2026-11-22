/**
 * Before/after comparison of two graded Ask Mindy regression runs (scripts/ask-mindy-baseline.mts summary.json
 * rows). Release rule (Agent 4, 2026-11-22): every PR that changes answers attaches this table, and a regression on
 * any scenario blocks release.
 *
 * Order: pass > partial > fail. A scenario that is graded before but missing after is a regression (it cannot
 * be silently dropped). A scenario new in the after run is listed, never counted as an improvement.
 */
export type Verdict = 'pass' | 'partial' | 'fail';
export interface GradeRow { id: string; verdict: Verdict; failures?: string[]; partials?: string[] }
export type Change = 'improved' | 'regressed' | 'same' | 'new' | 'missing';

export interface ComparedRow { id: string; before: Verdict | null; after: Verdict | null; change: Change }
export interface Comparison { rows: ComparedRow[]; regressions: string[]; table: string; summary: string }

const RANK: Readonly<Record<Verdict, number>> = { fail: 0, partial: 1, pass: 2 };

function byId(rows: readonly GradeRow[]): Map<string, Verdict> {
  const m = new Map<string, Verdict>();
  for (const r of rows) if (r && typeof r.id === 'string' && r.verdict in RANK) m.set(r.id, r.verdict);
  return m;
}

/** Natural order for scenario ids like R2 < R10. */
function idOrder(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

export function compareRuns(before: readonly GradeRow[], after: readonly GradeRow[]): Comparison {
  const b = byId(before);
  const a = byId(after);
  const ids = [...new Set([...b.keys(), ...a.keys()])].sort(idOrder);
  const rows: ComparedRow[] = ids.map((id) => {
    const bv = b.get(id) ?? null;
    const av = a.get(id) ?? null;
    let change: Change;
    if (bv && !av) change = 'missing';
    else if (!bv && av) change = 'new';
    else if (RANK[av as Verdict] > RANK[bv as Verdict]) change = 'improved';
    else if (RANK[av as Verdict] < RANK[bv as Verdict]) change = 'regressed';
    else change = 'same';
    return { id, before: bv, after: av, change };
  });
  const regressions = rows.filter((r) => r.change === 'regressed' || r.change === 'missing').map((r) => r.id);
  const count = (m: Map<string, Verdict>, v: Verdict) => [...m.values()].filter((x) => x === v).length;
  const line = (m: Map<string, Verdict>) => `${count(m, 'pass')} pass, ${count(m, 'partial')} partial, ${count(m, 'fail')} fail`;
  const summary = `before: ${line(b)} · after: ${line(a)} · ${regressions.length ? `REGRESSED: ${regressions.join(', ')} (blocks release)` : 'no regressions'}`;
  const table = [
    '| Scenario | Before | After | Change |',
    '| --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.id} | ${r.before ?? '—'} | ${r.after ?? '—'} | ${r.change === 'regressed' || r.change === 'missing' ? `**${r.change}**` : r.change} |`),
  ].join('\n');
  return { rows, regressions, table, summary };
}
