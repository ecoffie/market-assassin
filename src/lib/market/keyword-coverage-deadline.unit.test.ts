/**
 * P1: keywordCoverage must honor AbortSignal — timed-out ≠ empty market.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CoverageDeadlineError, keywordCoverage } from './keyword-coverage';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('keywordCoverage deadline', () => {
  it('throws CoverageDeadlineError when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(keywordCoverage('cnc machining', 0.9, { signal: ac.signal })).rejects.toBeInstanceOf(
      CoverageDeadlineError,
    );
  });

  it('throws CoverageDeadlineError when USASpending fetch is aborted mid-flight', async () => {
    const ac = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            // hang forever if no signal — test would fail the budget assertion
            return;
          }
          if (signal.aborted) {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            return;
          }
          signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        });
      }),
    );

    const p = keywordCoverage('precision cnc machining titanium', 0.9, {
      signal: ac.signal,
      perFetchMs: 60_000,
    });
    setTimeout(() => ac.abort(), 30);
    await expect(p).rejects.toBeInstanceOf(CoverageDeadlineError);
  });

  it('does not treat AbortError as an empty market (null)', async () => {
    const ac = new AbortController();
    ac.abort();
    let resolvedNull = false;
    try {
      const v = await keywordCoverage('drones', 0.9, { signal: ac.signal });
      resolvedNull = v === null;
    } catch (err) {
      expect(err).toBeInstanceOf(CoverageDeadlineError);
      expect(resolvedNull).toBe(false);
      return;
    }
    expect.fail('expected CoverageDeadlineError, got null/value');
  });
});
