/**
 * Monthly LLM spend: every row of the month is summed (paged past PostgREST's 1,000-row response cap), and admin,
 * staff and the internal team are never held to the monthly dollar limit (Eric, 2026-11-25).
 */
import { describe, it, expect, vi } from 'vitest';

const rows = vi.hoisted(() => ({ all: [] as Array<{ cost_usd: number }>, ranges: [] as Array<[number, number]> }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'gte', 'order']) q[m] = () => q;
      q.range = async (a: number, b: number) => { rows.ranges.push([a, b]); return { data: rows.all.slice(a, b + 1), error: null }; };
      q.insert = async () => ({ error: null });
      return q;
    },
  }),
}));

describe('getUserMonthSpend', () => {
  it('sums every row of the month, past the 1,000-row page (2,500 rows of $0.01 = $25)', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    rows.all = Array.from({ length: 2500 }, () => ({ cost_usd: 0.01 }));
    rows.ranges.length = 0;
    const { getUserMonthSpend } = await import('./usage-cost');
    expect(await getUserMonthSpend('heavy@example.com')).toBeCloseTo(25, 6);
    expect(rows.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
});

describe('isUserOverBudget', () => {
  it('a customer over the limit is over; admin, staff and the internal team never are', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    rows.all = Array.from({ length: 1500 }, () => ({ cost_usd: 0.02 })); // $30 > $15
    const { isUserOverBudget } = await import('./usage-cost');
    expect(await isUserOverBudget('customer@example.com')).toBe(true);
    expect(await isUserOverBudget('eric@govcongiants.com')).toBe(false);
    expect(await isUserOverBudget('evankoffdev@gmail.com')).toBe(false); // internal team
  });
});
