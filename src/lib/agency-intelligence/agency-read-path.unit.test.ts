import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POTATO 0B — agency identity is NEVER a substring, at READ time.
 *
 * Measured live against the 557-row `agency_intelligence` table (2026-09-13),
 * the previous `agency_name.ilike.%${agencyName}%` predicate returned
 * CONFIDENTLY WRONG data:
 *   "VA"  -> 5 rows, ZERO of them Veterans Affairs (Preser-VA-tion, Na-VA-jo,
 *            Pri-VA-cy, O-VE-rseas Pri-VA-te Investment)
 *   "EPA" -> 16 agencies, ZERO of them EPA (every hit was "D-EPA-rtment of ...")
 * After the fix: VA -> 29 rows (all VA), EPA -> 36 (all EPA), and
 * Preservation/Navajo/Privacy -> 0.
 *
 * These tests assert the QUERY CONTRACT, so they fail if anyone reintroduces a
 * substring predicate. Proven by inject -> red -> revert.
 */

const captured: { eq: [string, string][]; in: [string, string[]][]; or: string[] } = { eq: [], in: [], or: [] };

function makeQuery() {
  const q: Record<string, unknown> = {};
  const chain = () => q;
  q.select = chain;
  q.order = chain;
  q.limit = async () => ({ data: [], error: null });
  q.gte = chain;
  q.eq = (col: string, val: string) => { captured.eq.push([col, val]); return q; };
  q.in = (col: string, vals: string[]) => { captured.in.push([col, vals]); return q; };
  q.or = (expr: string) => { captured.or.push(expr); return q; };
  return q;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => makeQuery() }),
}));

beforeEach(() => {
  captured.eq = []; captured.in = []; captured.or = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

describe('getAgencyIntelligence — query contract', () => {
  it.each([
    ['VA', 'Department of Veterans Affairs'],
    ['Veterans Affairs', 'Department of Veterans Affairs'],
    ['Department of Veterans Affairs', 'Department of Veterans Affairs'],
    // the normalizeAgencyKey() shape the Opportunity Map actually sends
    ['VETERANS AFFAIRS', 'Department of Veterans Affairs'],
    ['EPA', 'Environmental Protection Agency'],
    ['ENVIRONMENTAL PROTECTION', 'Environmental Protection Agency'],
    ['SSA', 'Social Security Administration'],
    ['HOMELAND SECURITY', 'Department of Homeland Security'],
  ])('%s resolves to an EXACT match on %s', async (input, canonical) => {
    const { getAgencyIntelligence } = await import('./index');
    await getAgencyIntelligence(input);
    expect(captured.eq).toContainEqual(['agency_name', canonical]);
    // the whole point: no substring predicate may be issued
    expect(captured.or).toHaveLength(0);
  });

  it.each(['Preservation', 'Navajo', 'Privacy', 'Services', 'Department', 'Ministry of Magic'])(
    '%s issues NO query at all (unresolved stays unresolved)',
    async (input) => {
      const { getAgencyIntelligence } = await import('./index');
      const rows = await getAgencyIntelligence(input);
      expect(rows).toEqual([]);
      expect(captured.eq).toHaveLength(0);
      expect(captured.or).toHaveLength(0);
    },
  );

  it('never emits an ilike predicate for agency identity', async () => {
    const { getAgencyIntelligence } = await import('./index');
    for (const q of ['VA', 'EPA', 'Preservation', 'Navajo']) await getAgencyIntelligence(q);
    expect(captured.or.join('|')).not.toMatch(/ilike/i);
  });
});

describe('getIntelligenceForBriefing — query contract', () => {
  it('resolves a list to canonical names and matches with IN, not ilike', async () => {
    const { getIntelligenceForBriefing } = await import('./index');
    await getIntelligenceForBriefing(['VA', 'EPA', 'Preservation']);
    expect(captured.in).toHaveLength(1);
    const [col, vals] = captured.in[0];
    expect(col).toBe('agency_name');
    expect(vals).toContain('Department of Veterans Affairs');
    expect(vals).toContain('Environmental Protection Agency');
    // the unresolvable one is DROPPED, never broadened
    expect(vals).not.toContain('Preservation');
    expect(captured.or).toHaveLength(0);
  });

  it('returns [] without querying when nothing resolves', async () => {
    const { getIntelligenceForBriefing } = await import('./index');
    const rows = await getIntelligenceForBriefing(['Preservation', 'Navajo']);
    expect(rows).toEqual([]);
    expect(captured.in).toHaveLength(0);
  });
});
