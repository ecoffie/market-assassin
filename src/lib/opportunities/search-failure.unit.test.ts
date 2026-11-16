import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifySearchFailure, isStatementTimeout, SEARCH_TOO_LONG_MESSAGE } from './search-failure';

/**
 * Long searches (Agent 3, 2026-11-14; FIND-only port to main 2026-11-16): long paragraphs hit Postgres's statement timeout and
 * Map answered HTTP 500 with "canceling statement due to statement timeout". Safe handling only: a clear, actionable
 * failure, never an empty result. Gate A2 (the timeout itself) is NOT fixed by this.
 */
describe('classifySearchFailure', () => {
  it('a statement timeout (code 57014 or its message) is search_too_long, 503, actionable, and says it is not zero', () => {
    for (const e of [{ code: '57014', message: 'canceling statement due to statement timeout' }, new Error('canceling statement due to statement timeout')]) {
      expect(isStatementTimeout(e)).toBe(true);
      const f = classifySearchFailure(e);
      expect(f).toEqual({ code: 'search_too_long', message: SEARCH_TOO_LONG_MESSAGE, status: 503 });
    }
    expect(SEARCH_TOO_LONG_MESSAGE).toMatch(/not zero results/);
    expect(SEARCH_TOO_LONG_MESSAGE).toMatch(/Shorten/);
  });
  it('any other failure keeps its message and stays a 500', () => {
    expect(classifySearchFailure(new Error('connection reset'))).toEqual({ code: 'query_failed', message: 'connection reset', status: 500 });
  });
});

describe('wiring: FIND reports a timed-out Open-now search as unavailable, never zero', () => {
  const find = readFileSync(join(process.cwd(), 'src/lib/opportunities/find-opportunities.ts'), 'utf8');
  it('FIND uses the classifier on the Open-now window query', () => {
    expect(find).toContain("class: 'search_too_long'");
    expect(find).toContain('classifySearchFailure(error)');
  });
  it('behaviour: a statement timeout yields status unavailable, error class search_too_long, the actionable message, no count', async () => {
    const { findOpportunities } = await import('./find-opportunities');
    const timeout = { data: null, count: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    // Every query in this fake fails with a statement timeout; every builder method chains.
    const chain: any = new Proxy(function () {}, {
      get: (_t, k) => (k === 'then' ? (res: (v: unknown) => unknown) => res(timeout) : () => chain),
      apply: () => chain,
    });
    const client: any = { from: () => chain, rpc: () => chain };
    const r = await findOpportunities(
      { query: 'We clean commercial office buildings.', limit_per_horizon: 5, horizons: { open_now: true, coming_back: false, coming_soon: false } },
      { client },
    );
    const h = r.horizons.open_now;
    expect(h.status).toBe('unavailable');
    expect(h.matched_count).toBeNull();
    expect(h.error).toEqual({ class: 'search_too_long', message: SEARCH_TOO_LONG_MESSAGE });
    expect(JSON.stringify(h)).not.toContain('canceling statement');
  });
});
