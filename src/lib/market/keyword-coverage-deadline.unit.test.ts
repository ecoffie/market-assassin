/**
 * P1: keywordCoverage must honor AbortSignal — timed-out ≠ empty market.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CoverageDeadlineError, keywordCoverage } from './keyword-coverage';

afterEach(() => {
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
