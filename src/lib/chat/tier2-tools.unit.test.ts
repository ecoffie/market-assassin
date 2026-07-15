/**
 * Tier-2 chat tools — behavior + COST-DISCIPLINE tests.
 * The cost tests are the point of this tier (the June-2026 $2,075 BQ spike):
 * a warm hit must be free (no rate-limit consumed, no live scan); a cold miss
 * must be gated per-turn and per-user; over-limit returns a note, not a scan.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeTier2Tools, TIER2_TOOL_DEFS, TIER2_TOOL_NAMES } from './tier2-tools';

// --- mock the BQ lib: track liveBq usage so we can assert cold vs warm ---
const bqCalls: Array<{ fn: string; liveBq: boolean }> = [];
let rollupWarm = false;          // when true, cache-only (liveBq=false) returns a profile
let capableWarm = false;

vi.mock('@/lib/bigquery/recipients', () => ({
  recipientSlug: (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  resolveCanonicalSlug: vi.fn(async () => null),
  getRollupOrSingleBySlug: vi.fn(async (_slug: string, liveBq = false) => {
    bqCalls.push({ fn: 'getRollupBySlug', liveBq });
    if (!liveBq && !rollupWarm) return null;    // cache miss
    return { rollup_uei: 'UEI1', rollup_name: 'Leidos', child_ueis: ['UEI1'], city: 'Reston', state: 'VA', total_obligated: 5e9, award_count: 1200, distinct_agency_count: 40, first_action_date: '2008-01-01', last_action_date: '2026-06-01' };
  }),
  getRecentAwardsForRecipient: vi.fn(async (_ueis: string[], _rollupUei: string) => [{ piid: 'X', obligated: 1000 }]),
  getTopAgenciesForRecipient: vi.fn(async (_ueis: string[], _rollupUei: string) => [{ agency: 'DoD', total: 4e9 }]),
  findCapableSmallBusinesses: vi.fn(async ({ liveBq = false }: { liveBq?: boolean }) => {
    bqCalls.push({ fn: 'findCapableSmallBusinesses', liveBq });
    if (!liveBq && !capableWarm) return { rows: [], total: 0 };
    return { rows: [{ recipient_name: 'Acme', recipient_uei: 'U9', total_obligated: 2e6, award_count: 10, won_set_aside: true, match_reason: 'won this NAICS' }], total: 1 };
  }),
}));

// --- mock rate-limit: allow first N, then deny ---
let rlAllowed = true;
let rlCalls = 0;
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => { rlCalls++; return { allowed: rlAllowed, remaining: rlAllowed ? 5 : 0, limit: 12, resetAt: 0 }; }),
}));

beforeEach(() => { bqCalls.length = 0; rollupWarm = false; capableWarm = false; rlAllowed = true; rlCalls = 0; });

describe('Tier-2 tool definitions', () => {
  it('registers the Tier-2 contractor-intel tools', () => {
    expect([...TIER2_TOOL_NAMES].sort()).toEqual(['find_capable_contractors', 'get_contractor_profile']);
  });
  it('forbids extra properties on every tool', () => {
    for (const def of TIER2_TOOL_DEFS) expect(def.function.parameters.additionalProperties).toBe(false);
  });
});

describe('get_contractor_profile — cost discipline', () => {
  it('WARM cache hit: no live scan, no rate-limit consumed', async () => {
    rollupWarm = true;
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('get_contractor_profile', { company_name: 'Leidos' }) as { found: boolean };
    expect(res.found).toBe(true);
    expect(bqCalls.some((c) => c.fn === 'getRollupBySlug' && c.liveBq)).toBe(false); // never went live
    expect(rlCalls).toBe(0); // warm path never touches the rate limiter
  });

  it('COLD miss under budget: does ONE live scan after a rate-limit check', async () => {
    rollupWarm = false; rlAllowed = true;
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('get_contractor_profile', { company_name: 'Obscure Co' }) as { found: boolean };
    expect(rlCalls).toBe(1);
    expect(bqCalls.some((c) => c.fn === 'getRollupBySlug' && c.liveBq)).toBe(true); // went live once
    expect(res.found).toBe(true);
  });

  it('COLD miss OVER budget: returns a friendly note, NO live scan', async () => {
    rollupWarm = false; rlAllowed = false;
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('get_contractor_profile', { company_name: 'Obscure Co' }) as { ok: boolean; error: string; note: string };
    expect(res.ok).toBe(false);
    expect(res.error).toBe('rate_limited');
    expect(bqCalls.some((c) => c.liveBq)).toBe(false); // rate limit BLOCKED the scan
    expect(res.note).toMatch(/give it a few minutes|slow/i);
  });

  it('caps cold lookups per single turn (2nd distinct cold company in one turn is blocked)', async () => {
    rollupWarm = false; rlAllowed = true;
    const tools = makeTier2Tools('u@x.com');
    await tools.execute('get_contractor_profile', { company_name: 'Cold One' });   // cold #1 (allowed)
    await tools.execute('get_contractor_profile', { company_name: 'Cold Two' });   // cold #2 (allowed)
    const third = await tools.execute('get_contractor_profile', { company_name: 'Cold Three' }) as { error?: string };
    expect(third.error).toBe('rate_limited'); // per-turn cap (2) hit → no 3rd scan
  });

  it('missing company_name is rejected', async () => {
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('get_contractor_profile', {});
    expect(res.ok).toBe(false);
    expect(res.error).toBe('company_name_required');
  });
});

describe('find_capable_contractors', () => {
  it('warm hit returns firms without a live scan', async () => {
    capableWarm = true;
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('find_capable_contractors', { naics: '541512' }) as { count: number };
    expect(res.count).toBe(1);
    expect(bqCalls.some((c) => c.fn === 'findCapableSmallBusinesses' && c.liveBq)).toBe(false);
    expect(rlCalls).toBe(0);
  });

  it('requires naics or psc', async () => {
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('find_capable_contractors', {});
    expect(res.ok).toBe(false);
    expect(res.error).toBe('naics_or_psc_required');
  });

  it('cold miss over budget → note, no scan', async () => {
    capableWarm = false; rlAllowed = false;
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('find_capable_contractors', { naics: '999999' }) as { error: string };
    expect(res.error).toBe('rate_limited');
    expect(bqCalls.some((c) => c.fn === 'findCapableSmallBusinesses' && c.liveBq)).toBe(false);
  });
});

describe('execute — unknown tool', () => {
  it('never silently succeeds', async () => {
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('run_arbitrary_bq', {});
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/unknown_tool/);
  });
});
