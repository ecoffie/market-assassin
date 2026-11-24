/**
 * FIND replay gate. Agent 4 (2026-11-24): the old gate passed ANY change on a fixture named in the Phase B list
 * (janitorial Coming soon 59 → 70 exited 0), and never checked fixtures that exist only in the new snapshot.
 */
import { describe, it, expect } from 'vitest';
import { diffReplaySnapshots, horizonSignature, classificationTemplate, type ReplaySnapshot, type ReplayClassification } from './replay-diff';

const h = (matched: number, ids: string[], status = 'grounded', evidence: unknown = { DIRECT: ids.length }) => ({ status, matched_count: matched, evidence_counts: evidence, items: ids.map((id) => ({ id })) });
const snap = (cs: ReturnType<typeof h>): ReplaySnapshot => ({ janitorial: { horizons: { open_now: h(116, ['a', 'b']), coming_back: h(12, ['r1']), coming_soon: cs } } });

describe('diffReplaySnapshots', () => {
  const before = snap(h(59, ['f1', 'f2']));
  const after = snap(h(70, ['f1', 'f3']));

  it('a 59 → 70 change on a fixture with an old, unrelated classification FAILS (the reported bug)', () => {
    // A Phase-B-style note for janitorial that classified a DIFFERENT change (Open re-rank), not this one.
    const stale: ReplayClassification = { janitorial: { open_now: { cls: 'intentional_canonical_change', why: 'Open re-ranked', before: horizonSignature(h(116, ['b', 'a']))!, after: horizonSignature(h(116, ['a', 'b']))! } } };
    const r = diffReplaySnapshots(before, after, stale);
    expect(r.pass).toBe(false);
    expect(r.unexplained).toBe(1);
    expect(r.changes[0]).toMatchObject({ fixture: 'janitorial', horizon: 'coming_soon', verdict: 'unexplained', why: 'no classification for this fixture + horizon' });
  });

  it('a classification for the right horizon but a different before → after signature FAILS', () => {
    const wrong: ReplayClassification = { janitorial: { coming_soon: { cls: 'bug_correction', why: 'forecast aliases', before: horizonSignature(h(59, ['f1', 'f2']))!, after: horizonSignature(h(66, ['f1', 'f3']))! } } };
    const r = diffReplaySnapshots(before, after, wrong);
    expect(r.pass).toBe(false);
    expect(r.changes[0].why).toMatch(/differs from the classified before → after signature/);
  });

  it('an exact classification for this comparison explains the change; unexplained count 0', () => {
    const exact: ReplayClassification = { janitorial: { coming_soon: { cls: 'bug_correction', why: 'forecast aliases', before: horizonSignature(h(59, ['f1', 'f2']))!, after: horizonSignature(h(70, ['f1', 'f3']))! } } };
    const r = diffReplaySnapshots(before, after, exact);
    expect(r).toMatchObject({ pass: true, unexplained: 0, regressions: 0 });
    expect(r.changes).toEqual([expect.objectContaining({ verdict: 'explained', cls: 'bug_correction' })]);
  });

  it('a change classified as an unexpected regression fails the gate', () => {
    const reg: ReplayClassification = { janitorial: { coming_soon: { cls: 'unexpected_regression', why: 'lost rows', before: horizonSignature(h(59, ['f1', 'f2']))!, after: horizonSignature(h(70, ['f1', 'f3']))! } } };
    expect(diffReplaySnapshots(before, after, reg)).toMatchObject({ pass: false, regressions: 1 });
  });

  it('a same-count re-order and an evidence-label change are both changes (top-N order and evidence are in the signature)', () => {
    expect(diffReplaySnapshots(snap(h(59, ['f1', 'f2'])), snap(h(59, ['f2', 'f1'])), {}).unexplained).toBe(1);
    expect(diffReplaySnapshots(snap(h(59, ['f1'], 'grounded', { DIRECT: 1 })), snap(h(59, ['f1'], 'grounded', { WEAK: 1 })), {}).unexplained).toBe(1);
    expect(diffReplaySnapshots(before, before, {})).toMatchObject({ pass: true, changes: [] });
  });

  it('a fixture that exists only in the new snapshot (or only the old) FAILS', () => {
    const added = { ...after, 'new fixture': { horizons: { open_now: h(1, ['x']), coming_back: h(0, []), coming_soon: h(0, []) } } };
    const r = diffReplaySnapshots(after, added, {});
    expect(r.changes).toEqual([expect.objectContaining({ fixture: 'new fixture', verdict: 'unexplained', why: 'fixture exists only in the new snapshot' })]);
    expect(diffReplaySnapshots(added, after, {}).changes[0].why).toBe('fixture missing from the new snapshot');
  });

  it('no classification file at all: every change is unexplained', () => {
    expect(diffReplaySnapshots(before, after, {})).toMatchObject({ pass: false, unexplained: 1 });
  });

  it('the template carries the exact observed signatures, so a reviewer only fills cls + why', () => {
    const r = diffReplaySnapshots(before, after, {});
    const tpl = classificationTemplate(r);
    expect(tpl.janitorial?.coming_soon?.before).toEqual(horizonSignature(h(59, ['f1', 'f2'])));
    expect(tpl.janitorial?.coming_soon?.after).toEqual(horizonSignature(h(70, ['f1', 'f3'])));
    // a filled template (cls changed from the default regression) explains the change
    tpl.janitorial!.coming_soon!.cls = 'bug_correction';
    expect(diffReplaySnapshots(before, after, tpl).pass).toBe(true);
  });
});
