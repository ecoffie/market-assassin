/**
 * Mindy's dedicated SBIR/STTR search is retired (src/lib/sbir/retired.ts). The AI briefing generator's
 * multisite fetch is an ACTIVE path (precompute-briefings calls it nightly), so the retired sbir_sttr
 * slice — NIH RePORTER award pages — must be excluded there, not just absent from today's window.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, vi } from 'vitest';

const calls: Array<[string, unknown[]]> = [];
function builder(): unknown {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'in', 'not', 'or', 'gte', 'lte', 'ilike', 'limit', 'range']) {
    b[m] = (...args: unknown[]) => { calls.push([m, args]); return b; };
  }
  b.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 });
  return b;
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => builder() }) }));

describe('multisite fetch — excludeOpportunityTypes', () => {
  it('applies NOT IN (sbir_sttr) inside the query when asked', async () => {
    const { fetchMultisiteOpportunities } = await import('./multisite');
    calls.length = 0;
    await fetchMultisiteOpportunities({ limit: 25, excludeOpportunityTypes: ['sbir_sttr'] });
    expect(calls).toContainEqual(['not', ['opportunity_type', 'in', '(sbir_sttr)']]);
  });

  it('adds no type exclusion when not asked (other callers unchanged)', async () => {
    const { fetchMultisiteOpportunities } = await import('./multisite');
    calls.length = 0;
    await fetchMultisiteOpportunities({ limit: 25 });
    expect(calls.some(([m, a]) => m === 'not' && a[0] === 'opportunity_type')).toBe(false);
  });

  it('the AI briefing generator requests the exclusion on its multisite fetch', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/briefings/delivery/ai-briefing-generator.ts'), 'utf8');
    const call = src.slice(src.indexOf('fetchMultisiteOpportunities({'), src.indexOf('fetchMultisiteOpportunities({') + 900);
    expect(call).toMatch(/excludeOpportunityTypes:\s*\['sbir_sttr'\]/);
  });
});
