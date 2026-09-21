/**
 * Tier-2 chat tools — behavior + COST-DISCIPLINE tests.
 * The cost tests are the point of this tier (the June-2026 $2,075 BQ spike):
 * a warm hit must be free (no rate-limit consumed, no live scan); a cold miss
 * must be gated per-turn and per-user; over-limit returns a note, not a scan.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeTier2Tools, TIER2_TOOL_DEFS, TIER2_TOOL_NAMES } from './tier2-tools';

// --- mock the BQ lib: track liveBq usage so we can assert cold vs warm ---
const bqCalls: Array<{ fn: string; liveBq: boolean; limit?: number }> = [];
let rollupWarm = false;          // when true, cache-only (liveBq=false) returns a profile
let capableWarm = false;
let forceMiss = false;
/** Cyrus repro: agencies warm, awards cold on Pass-1 — Pass-2 must still fill awards. */
let awardsWarmPass1 = true;
let agenciesWarmPass1 = true;
let yearlyWarmPass1 = true;
let setAsideWarmPass1 = true;
/** Warm-cached confirmed empty set-aside (not a miss) — must not cold-fill. */
let setAsideWarmEmpty = false;
/** When true, even live awards return [] and bqUnavailable marks the key. */
let awardsUnavailable = false;
const unavailableKeys = new Set<string>();

vi.mock('@/lib/bigquery/cache', () => ({
  bqUnavailable: (cacheKey: string, rowCount: number) =>
    rowCount === 0 && unavailableKeys.has(cacheKey),
}));

vi.mock('@/lib/awards-ingest/read-warehouse-coverage', () => ({
  loadAwardsWarehouseCoverage: vi.fn(async () => ({
    clocks: {
      sourceActionMax: '2026-09-18',
      acquiredAt: '2026-09-20T18:16:56.112Z',
      mergedAt: '2026-09-20T18:18:56.743Z',
      recipientsRebuiltAt: '2026-09-20T18:19:35.838Z',
    },
    lastBuilt: '2026-09-20',
    freshness: { status: 'healthy', sourceAgeDays: 3, runAgeDays: 0 },
  })),
}));

vi.mock('@/lib/bigquery/recipients', () => ({
  recipientSlug: (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  resolveCanonicalSlug: vi.fn(async () => null),
  getRollupOrSingleBySlug: vi.fn(async (_slug: string, liveBq = false) => {
    bqCalls.push({ fn: 'getRollupBySlug', liveBq });
    if (forceMiss) return null;
    if (!liveBq && !rollupWarm) return null;    // cache miss
    return { rollup_uei: 'UEI1', rollup_name: 'Leidos', child_ueis: ['UEI1'], city: 'Reston', state: 'VA', total_obligated: 5e9, award_count: 1200, distinct_agency_count: 40, first_action_date: '2008-01-01', last_action_date: '2026-06-01' };
  }),
  getRecipientByUei: vi.fn(async () => null),
  getRecentAwardsForRecipient: vi.fn(async (_ueis: string[], rollupUei: string, _limit = 5, liveBq = false) => {
    bqCalls.push({ fn: 'getRecentAwards', liveBq });
    const key = `rollup:${rollupUei}:recent-awards:5:v4-m`;
    if (awardsUnavailable) {
      unavailableKeys.add(key);
      return [];
    }
    if (!liveBq && !awardsWarmPass1) {
      // Mirror real cacheOnly miss → UNAVAILABLE mark.
      unavailableKeys.add(key);
      return [];
    }
    unavailableKeys.delete(key);
    return [{ award_id: 'A1', piid: 'X', mod_number: '0', obligation_amount: 1000, action_date: '2025-01-01', set_aside: '8(A) SOLE SOURCE' }];
  }),
  getTopAgenciesForRecipient: vi.fn(async (_ueis: string[], rollupUei: string, _limit = 5, liveBq = false) => {
    bqCalls.push({ fn: 'getTopAgencies', liveBq });
    const key = `rollup:${rollupUei}:top-agencies:5:v4-m`;
    if (!liveBq && !agenciesWarmPass1) {
      unavailableKeys.add(key);
      return [];
    }
    unavailableKeys.delete(key);
    return [{ awarding_agency: 'DoD', total_amount: 4e9, pct_of_total: 1 }];
  }),
  getYearlyTotalsForRecipient: vi.fn(async (_ueis: string[], rollupUei: string, liveBq = false) => {
    bqCalls.push({ fn: 'getYearlyTotals', liveBq });
    const key = `rollup:${rollupUei}:yearly-totals:v3-m`;
    if (!liveBq && !yearlyWarmPass1) {
      unavailableKeys.add(key);
      return [];
    }
    unavailableKeys.delete(key);
    return [
      { fiscal_year: 2025, total_obligated: 1e6, positive_obligations: 1e6, deobligations: 0, award_count: 10 },
    ];
  }),
  getSetAsideHistoryForRecipient: vi.fn(async (_ueis: string[], rollupUei: string, liveBq = false) => {
    bqCalls.push({ fn: 'getSetAsideHistory', liveBq });
    const key = `rollup:${rollupUei}:set-aside-history:v4-m`;
    if (setAsideWarmEmpty) {
      // Confirmed empty warm hit — do NOT mark unavailable.
      unavailableKeys.delete(key);
      return [];
    }
    if (!liveBq && !setAsideWarmPass1) {
      unavailableKeys.add(key);
      return [];
    }
    unavailableKeys.delete(key);
    return [{
      set_aside: '8(A) SOLE SOURCE',
      award_count: 2,
      last_action_fy: 2023,
      first_observed_positive_action_fy: 2019,
      total_obligated: 1_000_000,
      contributing_ueis: ['LEIDOSUEI0001'],
      supporting_actions: [{
        uei: 'LEIDOSUEI0001',
        award_id: 'CONT1',
        fiscal_year: 2023,
        obligation_amount: 500_000,
        action_date: '2023-01-15',
      }],
    }];
  }),
  findCapableSmallBusinesses: vi.fn(async ({ liveBq = false, limit }: { liveBq?: boolean; limit?: number }) => {
    bqCalls.push({ fn: 'findCapableSmallBusinesses', liveBq, limit });
    if (!liveBq && !capableWarm) return { rows: [], total: 0 };
    return { rows: [{ recipient_name: 'Acme', recipient_uei: 'U9', total_obligated: 2e6, award_count: 10, won_set_aside: true, match_reason: 'won this NAICS' }], total: 1 };
  }),
}));

const mockResolveName = vi.fn(async () => ({ status: 'none' as const, searched: '' }));
vi.mock('@/lib/contractor/name-resolution', () => ({
  resolveAwardCorpusByName: (q: string) => mockResolveName(q),
}));

// --- mock rate-limit: allow first N, then deny ---
let rlAllowed = true;
let rlCalls = 0;
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => { rlCalls++; return { allowed: rlAllowed, remaining: rlAllowed ? 5 : 0, limit: 12, resetAt: 0 }; }),
}));

beforeEach(() => {
  bqCalls.length = 0;
  rollupWarm = false;
  capableWarm = false;
  forceMiss = false;
  rlAllowed = true;
  rlCalls = 0;
  awardsWarmPass1 = true;
  agenciesWarmPass1 = true;
  yearlyWarmPass1 = true;
  setAsideWarmPass1 = true;
  setAsideWarmEmpty = false;
  awardsUnavailable = false;
  unavailableKeys.clear();
  mockResolveName.mockReset();
  mockResolveName.mockResolvedValue({ status: 'none', searched: '' });
});

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

describe('get_contractor_profile — award-corpus name resolution when the slug misses', () => {
  it('a family token is ambiguous, not a false miss, and is not auto-picked', async () => {
    forceMiss = true;
    mockResolveName.mockResolvedValue({
      status: 'ambiguous',
      match_count: 13,
      truncated: false,
      candidates: [
        { name: 'TANAQ SUPPORT SERVICES, LLC', uei: 'UM53UXL5QNF5', total_obligated: 261_903_825.7, award_count: 54 },
        { name: 'TANAQ MANAGEMENT SERVICES LLC', uei: 'WJ21VL51LDV4', total_obligated: 136_848_342.61, award_count: 20 },
      ],
      note: '13 award-holding recipients match "Tanaq". This tool will not pick one.',
    });
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('get_contractor_profile', { company_name: 'Tanaq' }) as {
      found: boolean; resolution?: string; match_count?: number; note?: string; candidates?: Array<{ uei: string }>;
    };
    expect(res.found).toBe(false);
    expect(res.resolution).toBe('ambiguous');
    expect(res.match_count).toBe(13);
    expect(res.candidates?.[0].uei).toBe('UM53UXL5QNF5');
    expect(res.note).toMatch(/will not pick one/);
    expect(res.note).not.toMatch(/couldn't find a federal contractor/i);
  });

  it('zero award-index rows are none_in_award_corpus, not a certification or existence claim', async () => {
    forceMiss = true;
    mockResolveName.mockResolvedValue({ status: 'none', searched: 'Tanaq Global Solutions LLC' });
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('get_contractor_profile', { company_name: 'Tanaq Global Solutions LLC' }) as {
      found: boolean; resolution?: string; note?: string;
    };
    expect(res.found).toBe(false);
    expect(res.resolution).toBe('none_in_award_corpus');
    expect(res.note).toMatch(/this dataset only/i);
    expect(res.note).toMatch(/does not prove/i);
    expect(res.note).not.toMatch(/couldn't find a federal contractor/i);
    expect(res.note).not.toMatch(/not certified/i);
  });

  it('a failed name search is lookup_failed, distinct from none', async () => {
    forceMiss = true;
    mockResolveName.mockResolvedValue({ status: 'degraded', detail: 'bq down' });
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('get_contractor_profile', { company_name: 'Tanaq' }) as {
      found: boolean; resolution?: string; error?: string;
    };
    expect(res.found).toBe(false);
    expect(res.resolution).toBe('lookup_failed');
    expect(res.error).toBe('lookup_failed');
  });
});

describe('get_contractor_profile — recent awards + set-aside honesty', () => {
  it('warm profile + warm enrichment: recent_awards present without live enrichment scans', async () => {
    rollupWarm = true;
    awardsWarmPass1 = true;
    agenciesWarmPass1 = true;
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('get_contractor_profile', { company_name: 'Leidos' }) as {
      found: boolean;
      enrichment_status: string;
      recent_awards: unknown[];
      historical_set_asides: {
        last_observed_action_fy_by_label: Record<string, number | null>;
        first_observed_positive_action_fy_by_label: Record<string, number | null>;
        note: string;
        coverage: string;
        scope: { kind: string; uei_count: number } | null;
        contributing_ueis_by_label: Record<string, string[]>;
        supporting_actions_by_label: Record<string, unknown[]>;
        deprecated: { last_fy_by_label: { status: string } };
      };
      coverage: {
        warehouse_max_action_date: string | null;
        coverage_complete_established: boolean;
        ingest: { freshness_status: string };
      };
    };
    expect(res.found).toBe(true);
    expect(res.enrichment_status).toBe('complete');
    expect(res.recent_awards.length).toBeGreaterThan(0);
    expect(bqCalls.some((c) => c.fn === 'getRecentAwards' && c.liveBq)).toBe(false);
    expect(res.historical_set_asides.last_observed_action_fy_by_label['8(A) SOLE SOURCE']).toBe(2023);
    expect(res.historical_set_asides.first_observed_positive_action_fy_by_label['8(A) SOLE SOURCE']).toBe(2019);
    expect(res.historical_set_asides.note).toMatch(/not derived from the capped recent_awards/i);
    expect(res.historical_set_asides.note).toMatch(/Award origin is not established/i);
    expect(res.historical_set_asides.note).toMatch(/UEI set/i);
    expect(res.historical_set_asides.coverage).toBe('complete');
    expect(res.historical_set_asides.scope).toEqual({ kind: 'profile_rollup', uei_count: 1 });
    expect(res.historical_set_asides.contributing_ueis_by_label['8(A) SOLE SOURCE']).toContain('LEIDOSUEI0001');
    expect(res.historical_set_asides.supporting_actions_by_label['8(A) SOLE SOURCE'].length).toBe(1);
    expect(res.historical_set_asides.deprecated.last_fy_by_label.status).toBe('deprecated');
    expect(res.historical_set_asides).not.toHaveProperty('award_origin_fy_by_label');
    expect(res.coverage.warehouse_max_action_date).toBe('2026-09-18');
    expect(res.coverage.coverage_complete_established).toBe(true);
    expect(res.coverage.ingest.freshness_status).toBe('healthy');
  });

  it('Cyrus path: warm agencies + cold awards still Pass-2 fills recent_awards', async () => {
    rollupWarm = true;
    awardsWarmPass1 = false;   // Pass-1 miss on awards key → unavailable
    agenciesWarmPass1 = true;  // Pass-1 hit on agencies — old gate would skip Pass-2
    yearlyWarmPass1 = true;
    setAsideWarmPass1 = true;
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('get_contractor_profile', { company_name: 'Leidos' }) as {
      enrichment_status: string;
      recent_awards: unknown[];
      top_agencies: unknown[];
    };
    expect(res.top_agencies.length).toBeGreaterThan(0);
    expect(bqCalls.some((c) => c.fn === 'getRecentAwards' && c.liveBq)).toBe(true);
    expect(bqCalls.some((c) => c.fn === 'getTopAgencies' && c.liveBq)).toBe(false);
    expect(res.recent_awards.length).toBeGreaterThan(0);
    expect(res.enrichment_status).toBe('complete');
  });

  it('failed awards retrieval is budget_limited — not complete empty zero', async () => {
    rollupWarm = true;
    awardsUnavailable = true;
    agenciesWarmPass1 = true;
    yearlyWarmPass1 = true;
    setAsideWarmPass1 = true;
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('get_contractor_profile', { company_name: 'Leidos' }) as {
      enrichment_status: string;
      recent_awards: unknown[];
      company: { award_count: number };
    };
    expect(res.company.award_count).toBeGreaterThan(0);
    expect(res.recent_awards).toEqual([]);
    expect(res.enrichment_status).toBe('budget_limited');
  });

  it('warm-empty set-aside with cold budget denied stays complete — does not cold-fill', async () => {
    rollupWarm = true;
    setAsideWarmEmpty = true; // confirmed empty warm hit
    rlAllowed = false;        // deny any cold enrichment budget
    const tools = makeTier2Tools('u@x.com');
    const res = await tools.execute('get_contractor_profile', { company_name: 'Leidos' }) as {
      enrichment_status: string;
      recent_awards: unknown[];
      historical_set_asides: { labels: string[]; coverage: string };
    };
    expect(res.recent_awards.length).toBeGreaterThan(0);
    expect(res.historical_set_asides.labels).toEqual([]);
    expect(res.historical_set_asides.coverage).toBe('complete');
    expect(res.enrichment_status).toBe('complete');
    expect(bqCalls.some((c) => c.fn === 'getSetAsideHistory' && c.liveBq)).toBe(false);
    expect(rlCalls).toBe(0); // warm path never touches rate limiter for enrichment
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

  // Reads a CACHED BQ rollup (the cold pass is budget-gated separately), so the
  // result count is free. The old hardcoded limit:8 threw away 84% of the lib's
  // own default; it's now caller-configurable, defaulting to 50, ceiling 200.
  it('defaults to a 50-row limit and clamps a caller-supplied limit to [1, 200]', async () => {
    const limitFor = async (limit: unknown) => {
      capableWarm = true; bqCalls.length = 0;
      const tools = makeTier2Tools('u@x.com');
      await tools.execute('find_capable_contractors', { naics: '541512', limit });
      return bqCalls.find((c) => c.fn === 'findCapableSmallBusinesses')?.limit;
    };
    expect(await limitFor(undefined)).toBe(50); // default — was a hardcoded 8
    expect(await limitFor(120)).toBe(120);      // honored within range
    expect(await limitFor(999)).toBe(200);      // clamped to the ceiling
    expect(await limitFor(0)).toBe(1);          // floored to at least 1
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
