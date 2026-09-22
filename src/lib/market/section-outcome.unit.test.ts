/**
 * P2 — a transient upstream failure must never be indistinguishable from
 * "the data says zero". Deterministic injection; does NOT depend on
 * reproducing the rare production timeout (0/54 in controlled runs).
 */
import { describe, it, expect } from 'vitest';
import { runSection, classifyFailure, classifySuccess, isGrounded, isFailed } from './section-outcome';

const timeout = () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; return e; };

describe('P2: failure and absence are different states', () => {
  it('a TIMEOUT is failed/unknown — never an established zero', async () => {
    const o = await runSection<number[]>(Promise.reject(timeout()));
    expect(o.status).toBe('failed');
    expect(o.value).toBeNull();
    expect(o.failure?.kind).toBe('timeout');
    expect(isGrounded(o)).toBe(false);
    expect(isFailed(o)).toBe(true);
  });

  it('a SUCCESSFUL empty result is an answer, not a failure', async () => {
    const o = await runSection<number[]>(Promise.resolve([]));
    expect(o.status).toBe('empty');
    expect(isFailed(o)).toBe(false);
  });

  it('the two are DISTINGUISHABLE — the whole point', async () => {
    const failed = await runSection<number[]>(Promise.reject(timeout()));
    const empty = await runSection<number[]>(Promise.resolve([]));
    // Both have no rows...
    expect(failed.value ?? []).toHaveLength(0);
    expect(empty.value).toHaveLength(0);
    // ...but they no longer look the same.
    expect(failed.status).not.toBe(empty.status);
  });

  it('usable evidence is ok and counts toward grounding', async () => {
    const o = await runSection(Promise.resolve([{ a: 1 }]));
    expect(o.status).toBe('ok');
    expect(isGrounded(o)).toBe(true);
  });

  it('classifies an upstream error distinctly from a timeout', async () => {
    const o = await runSection(Promise.reject(new Error('502 Bad Gateway')));
    expect(o.status).toBe('failed');
    expect(o.failure?.kind).toBe('upstream_error');
  });

  it('a custom evidence predicate decides ok vs empty', () => {
    expect(classifySuccess({ totalMarket: 0 }, (v) => v.totalMarket > 0)).toBe('empty');
    expect(classifySuccess({ totalMarket: 5 }, (v) => v.totalMarket > 0)).toBe('ok');
  });

  it('recognises the coverage deadline error shape', () => {
    const e = new Error('keywordCoverage deadline exceeded');
    e.name = 'CoverageDeadlineError';
    expect(classifyFailure(e)).toBe('timeout');
  });

  it('failure detail is retained for diagnostics', async () => {
    const o = await runSection(Promise.reject(new Error('BigQuery: quota exceeded')));
    expect(o.failure?.message).toContain('quota exceeded');
  });
});
