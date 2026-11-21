/**
 * queryExpiringContracts descriptionTerms (2026-11-07): keyword evidence for the market report.
 * When a caller asks for keyword evidence and no phrase survives sanitizing, the query must match
 * NOTHING. Silently dropping the filter would return the unscoped market as the keyword's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ op: string; args: unknown[] }> = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'lte', 'gt', 'is', 'or', 'like', 'eq', 'gte', 'order', 'limit']) {
        chain[op] = (...args: unknown[]) => { calls.push({ op, args }); return chain; };
      }
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
      return chain;
    },
  }),
}));

import { queryExpiringContracts } from './query';

beforeEach(() => { calls.length = 0; });

describe('queryExpiringContracts descriptionTerms', () => {
  it('filters on the description phrase', async () => {
    await queryExpiringContracts({ descriptionTerms: ['risk management framework'] });
    expect(calls).toContainEqual({ op: 'or', args: ['description.ilike.%risk management framework%'] });
  });

  it('asked for evidence but no usable phrase → matches nothing, never the whole table', async () => {
    await queryExpiringContracts({ descriptionTerms: ['IT'] });
    expect(calls).toContainEqual({ op: 'eq', args: ['contract_id', '__no_keyword_evidence__'] });
    expect(calls.some((c) => c.op === 'or')).toBe(false);
  });

  it('no descriptionTerms → behaviour unchanged (no description filter)', async () => {
    await queryExpiringContracts({ naicsCodes: ['541512'] });
    expect(calls.some((c) => c.op === 'or' && String(c.args[0]).includes('description'))).toBe(false);
    expect(calls.some((c) => c.op === 'eq' && c.args[0] === 'contract_id')).toBe(false);
  });
});
