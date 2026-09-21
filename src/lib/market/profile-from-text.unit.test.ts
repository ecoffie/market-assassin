/**
 * V1 identity boundary: keyword coverage must not become company NAICS.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/llm/call-llm', () => ({
  callLLM: vi.fn(async () => ({ text: JSON.stringify({ industry: 'hvac' }) })),
}));

vi.mock('@/lib/market/semantic-keywords', () => ({
  deriveSemanticKeywords: vi.fn(async () => ['hvac', 'hvac maintenance']),
}));

vi.mock('@/lib/market/keyword-coverage', () => ({
  queryKeywordCoverage: vi.fn(),
  deriveCoverageKeywords: vi.fn(() => ['hvac', 'mechanical']),
}));

import { callLLM } from '@/lib/llm/call-llm';
import { queryKeywordCoverage } from '@/lib/market/keyword-coverage';
import { buildProfileFromText } from './profile-from-text';

function foundCoverage(partial: {
  keyword: string;
  totalMarket: number;
  naicsCount: number;
  coverageCodes: string[];
  topCodePct: number;
  allNaics: { code: string; name: string; amount: number; pct: number }[];
}) {
  return {
    status: 'MARKET_EVIDENCE_FOUND' as const,
    degraded: false,
    coverage: {
      keyword: partial.keyword,
      totalMarket: partial.totalMarket,
      naicsCount: partial.naicsCount,
      allNaics: partial.allNaics,
      coverageCodes: partial.coverageCodes,
      coveragePct: 0.9,
      topCodePct: partial.topCodePct,
      leadCodePct: partial.topCodePct,
      naicsIdentityStatus: 'NOT_ESTABLISHED' as const,
      pscCount: 1,
      topPsc: { code: 'J041', name: 'Maint HVAC' },
      topPscPct: 0.1,
      topPscList: [],
      pinnedPscCodes: null,
      transactionCount: 100,
      uniqueAwardCount: 50,
      fiscalYear: 2025,
      evidenceStatus: 'MARKET_EVIDENCE_FOUND' as const,
    },
  };
}

describe('buildProfileFromText identity boundary', () => {
  beforeEach(() => {
    vi.mocked(queryKeywordCoverage).mockReset();
    vi.mocked(callLLM).mockResolvedValue({ text: JSON.stringify({ industry: 'hvac' }) } as never);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: [{ name: 'Department of Veterans Affairs', amount: 1e6 }] }),
    })));
  });

  it('does not promote coverageCandidates into company naics (HVAC → 236220 lead)', async () => {
    vi.mocked(queryKeywordCoverage).mockResolvedValue(
      foundCoverage({
        keyword: 'hvac',
        totalMarket: 1.26e9,
        naicsCount: 40,
        coverageCodes: ['236220', '238220', '238210'],
        topCodePct: 0.52,
        allNaics: [
          { code: '236220', name: 'Commercial Building', amount: 6.5e8, pct: 0.52 },
          { code: '238220', name: 'Plumbing / HVAC', amount: 3e8, pct: 0.24 },
        ],
      }) as Awaited<ReturnType<typeof queryKeywordCoverage>>,
    );

    const profile = await buildProfileFromText('I do HVAC work.');
    expect(profile).not.toBeNull();
    expect(profile!.naics).toEqual([]);
    expect(profile!.coverageCandidates).toEqual(['236220', '238220', '238210']);
    expect(profile!.industryPhrase).toContain('hvac');
    expect(profile!.totalMarket).toBe(1.26e9);
  });

  it('does not invent company NAICS for drones when coverage leads 336411', async () => {
    vi.mocked(callLLM).mockResolvedValue({ text: JSON.stringify({ industry: 'drones' }) } as never);
    vi.mocked(queryKeywordCoverage).mockResolvedValue(
      foundCoverage({
        keyword: 'drones',
        totalMarket: 9e7,
        naicsCount: 12,
        coverageCodes: ['336411', '336413'],
        topCodePct: 0.64,
        allNaics: [{ code: '336411', name: 'Aircraft Mfg', amount: 5.7e7, pct: 0.64 }],
      }) as Awaited<ReturnType<typeof queryKeywordCoverage>>,
    );

    const profile = await buildProfileFromText('I build drones.');
    expect(profile!.naics).toEqual([]);
    expect(profile!.coverageCandidates[0]).toBe('336411');
  });

  it('returns null for nonsense (no invented market identity)', async () => {
    const profile = await buildProfileFromText('asdfqwer zxcvbnm');
    expect(profile).toBeNull();
  });
});
