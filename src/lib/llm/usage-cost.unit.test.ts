import { describe, it, expect, vi } from 'vitest';
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
import { costOf } from './usage-cost';

const M = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 };

describe('costOf — every model Ask Mindy can route to is priced (unpriced = $0 = budget cap off)', () => {
  it.each([
    ['gpt-6.1-terra', 6.0],
    ['gpt-6-luna', 0.6],
    ['gpt-6.1-sol', 12.0],
    ['gpt-6-sol', 12.0],
    ['gpt-6-astra', 60.0],
    ['openai/gpt-oss-120b', 0.75],
    ['gpt-4o-mini', 0.75],
    ['gpt-4o', 12.5],
  ])('%s', (model, usd) => {
    expect(costOf(model, M)).toBeCloseTo(usd, 5);
  });

  it('the B2 release chain (terra primary, luna fallback, gpt-4o-mini over-budget) is never free', () => {
    for (const m of ['gpt-6.1-terra', 'gpt-6-luna', 'gpt-4o-mini']) expect(costOf(m, { prompt_tokens: 20_000, completion_tokens: 300 })).toBeGreaterThan(0);
  });
});
