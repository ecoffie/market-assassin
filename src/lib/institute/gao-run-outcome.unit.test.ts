import { describe, expect, it } from 'vitest';
import {
  decideGaoRunOutcome, GaoRunIssues, MAX_MESSAGES_PER_CATEGORY, MAX_REASON_CHARS, type GaoRunFacts,
} from './gao-run-outcome';

const clean: GaoRunFacts = {
  partial: false, failed: 0, blocked: 0, reconcileFailed: 0, sourceDown: 0,
  evidenceInserted: 3, freshnessStatus: 'current',
};

describe('decideGaoRunOutcome — one decision, no disagreement', () => {
  it('a clean run is success/200/advanced and verified', () => {
    expect(decideGaoRunOutcome(clean)).toEqual({
      verifiedComplete: true, outcome: 'success', success: true, status: 'advanced', httpStatus: 200,
    });
  });

  it('a budget-cut (partial) run is NOT success — the 2026-11 defect', () => {
    const d = decideGaoRunOutcome({ ...clean, partial: true });
    expect(d.verifiedComplete).toBe(false);
    expect(d.outcome).toBe('partial');
    expect(d.success).toBe(false);
    expect(d.status).toBe('degraded');
    expect(d.httpStatus).toBe(503); // cronOutcomeHttpStatus('partial')
  });

  it.each([
    ['failed', { failed: 1 }],
    ['blocked', { blocked: 1 }],
    ['reconcileFailed', { reconcileFailed: 1 }],
    ['sourceDown', { sourceDown: 1 }],
  ])('%s alone makes the run partial, never success', (_n, patch) => {
    const d = decideGaoRunOutcome({ ...clean, ...patch });
    expect(d).toMatchObject({ verifiedComplete: false, outcome: 'partial', success: false, status: 'degraded' });
  });

  it('success flag always equals outcome === success', () => {
    for (const partial of [false, true]) for (const failed of [0, 2]) {
      const d = decideGaoRunOutcome({ ...clean, partial, failed });
      expect(d.success).toBe(d.outcome === 'success');
      expect(d.verifiedComplete).toBe(d.success);
    }
  });

  it('a clean quiet run keeps upstream_quiet / no_new_evidence', () => {
    expect(decideGaoRunOutcome({ ...clean, evidenceInserted: 0, freshnessStatus: 'upstream_quiet' }).status).toBe('upstream_quiet');
    expect(decideGaoRunOutcome({ ...clean, evidenceInserted: 0 }).status).toBe('no_new_evidence');
  });
});

describe('GaoRunIssues — concise reason with counts + first messages', () => {
  it('null when nothing went wrong', () => {
    expect(new GaoRunIssues().summary()).toBeNull();
  });

  it('exact counts, first N distinct messages, stable category order', () => {
    const i = new GaoRunIssues();
    for (let n = 0; n < 5; n++) i.add('ingest_failed', `GAO-26-${n}: insert failed`);
    i.add('ingest_failed', 'GAO-26-0: insert failed'); // duplicate message: counted, not repeated
    i.add('reconcile_failed', 'reconcileUnresolvedGaoAgencies: timeout');
    i.add('budget', 'GAO RSS cut at 10/25 after 240000ms budget');
    expect(i.count('ingest_failed')).toBe(6);
    const s = i.summary()!;
    expect(s).toBe(
      'budget=1 [GAO RSS cut at 10/25 after 240000ms budget]; '
      + 'ingest_failed=6 [GAO-26-0: insert failed | GAO-26-1: insert failed]; '
      + 'reconcile_failed=1 [reconcileUnresolvedGaoAgencies: timeout]',
    );
    expect(s.match(/GAO-26-/g)).toHaveLength(MAX_MESSAGES_PER_CATEGORY);
  });

  it('never exceeds the reason budget', () => {
    const i = new GaoRunIssues();
    const cats = ['source_down', 'budget', 'ingest_failed', 'held_lookup_failed', 'reconcile_failed', 'blocked'] as const;
    for (const c of cats) { i.add(c, 'x'.repeat(500)); i.add(c, 'y'.repeat(500)); }
    expect(i.summary()!.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
  });
});
