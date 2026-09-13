import { describe, expect, it } from 'vitest';
import { resolveBusiness } from './resolve-business';
import { FOLLOW_UP_PROMPT } from './types';
import type { CompanyKeywordsToolResult } from '@/mcp/tools/company-keywords';
import type { KeywordCoverageToolResult } from '@/mcp/tools/keyword-coverage';

function deriveOk(keywords: string[]): CompanyKeywordsToolResult {
  return {
    keywords,
    _meta: {
      grounded: keywords.length > 0,
      degraded: false,
      ranked: true,
      keyword_count: keywords.length,
      input_chars: 40,
    },
  };
}

function deriveEmpty(): CompanyKeywordsToolResult {
  return {
    keywords: [],
    _meta: { grounded: false, degraded: false, ranked: false, keyword_count: 0, input_chars: 20 },
  };
}

function deriveDegraded(): CompanyKeywordsToolResult {
  return {
    keywords: [],
    _meta: { grounded: false, degraded: true, ranked: false, keyword_count: 0, input_chars: 40 },
  };
}

function coverageOk(keyword: string, naics: string[]): KeywordCoverageToolResult {
  return {
    queried: { keyword, coverage_target: 0.9 },
    coverage: {
      keyword,
      totalMarket: 1_000_000,
      naicsCount: naics.length,
      allNaics: naics.map((code, i) => ({ code, name: `NAICS ${code}`, amount: 1000, pct: 1 / naics.length })),
      coverageCodes: naics,
      coveragePct: 0.9,
      topCodePct: 0.5,
      leadCodePct: 0.5,
      pscCount: 1,
      topPsc: { code: 'S201', name: 'Housekeeping and Janitorial Services' },
      topPscPct: 0.8,
      topPscList: [{ code: 'S201', name: 'Housekeeping and Janitorial Services', amount: 800, pct: 0.8 }],
      pinnedPscCodes: null,
    },
    _meta: { grounded: true, degraded: false, naics_count: naics.length, total_market: 1_000_000 },
  };
}

function coverageMiss(keyword: string): KeywordCoverageToolResult {
  return {
    queried: { keyword, coverage_target: 0.9 },
    coverage: null,
    _meta: { grounded: false, degraded: false, naics_count: 0, total_market: 0 },
  };
}

function coverageDegraded(keyword: string): KeywordCoverageToolResult {
  return {
    queried: { keyword, coverage_target: 0.9 },
    coverage: null,
    _meta: { grounded: false, degraded: true, naics_count: 0, total_market: 0 },
  };
}

describe('resolveBusiness', () => {
  it('composes derive → coverage into structured codes without asking for NAICS', async () => {
    const resolved = await resolveBusiness(
      { description: 'I clean office buildings' },
      {
        deriveKeywords: async () => deriveOk(['janitorial services', 'office cleaning', 'janitorial services']),
        getCoverage: async ({ keyword }) => coverageOk(keyword, ['561720', '561720', '561210']),
      },
    );
    expect(resolved.state).toBe('structured');
    expect(resolved.searchKeyword).toBe('cleaning');
    expect(resolved.naicsCodes).toEqual({ status: 'known', items: ['561720', '561210'] });
    expect(resolved.primaryNaics).toBe('561720');
    expect(resolved.psc?.name).toBe('Housekeeping and Janitorial Services');
    expect(resolved.contextLabel).toBeNull();
    expect(resolved.followUpPrompt).toBeNull();
  });

  it('asks a plain-English follow-up on the first unclassifiable description', async () => {
    const resolved = await resolveBusiness(
      { description: 'I do stuff' },
      { deriveKeywords: async () => deriveEmpty(), getCoverage: async () => coverageMiss('x') },
    );
    expect(resolved.state).toBe('need_followup');
    expect(resolved.followUpPrompt).toBe(FOLLOW_UP_PROMPT);
    expect(resolved.searchKeyword).toBeNull();
    expect(resolved.naicsCodes).toEqual({ status: 'known', items: [] });
  });

  it('falls back to the user description after a failed retry — does not pretend classification succeeded', async () => {
    const resolved = await resolveBusiness(
      { description: 'I do stuff', followUp: 'things for people' },
      { deriveKeywords: async () => deriveEmpty(), getCoverage: async () => coverageMiss('x') },
    );
    expect(resolved.state).toBe('keyword_fallback');
    expect(resolved.contextLabel).toBe('Based on your description');
    expect(resolved.searchKeyword).toContain('I do stuff');
    expect(resolved.primaryNaics).toBeNull();
    expect(resolved.confidence).toBe('low');
  });

  it('treats a degraded derive as unavailable, not as an empty classification', async () => {
    const resolved = await resolveBusiness(
      { description: 'I clean office buildings' },
      { deriveKeywords: async () => deriveDegraded(), getCoverage: async () => coverageMiss('x') },
    );
    expect(resolved.state).toBe('unavailable');
    expect(resolved.keywords.status).toBe('unknown');
    expect(resolved.naicsCodes.status).toBe('unknown');
  });

  it('does not coerce a thrown derive into []', async () => {
    const resolved = await resolveBusiness(
      { description: 'I clean office buildings' },
      {
        deriveKeywords: async () => {
          throw new Error('embeddings down');
        },
        getCoverage: async () => coverageMiss('x'),
      },
    );
    expect(resolved.state).toBe('unavailable');
    expect(resolved.keywords).toEqual({
      status: 'unknown',
      reason: 'embeddings down',
    });
  });

  it('keeps keyword search when coverage is degraded rather than inventing NAICS', async () => {
    const resolved = await resolveBusiness(
      { description: 'I clean office buildings' },
      {
        deriveKeywords: async () => deriveOk(['janitorial']),
        getCoverage: async ({ keyword }) => coverageDegraded(keyword),
      },
    );
    expect(resolved.state).toBe('keyword_fallback');
    expect(resolved.naicsCodes.status).toBe('unknown');
    expect(resolved.primaryNaics).toBeNull();
    expect(resolved.contextLabel).toBe('Based on your description');
  });

  it('skips a first-person sentence and diffuse coverage, then takes a tighter candidate', async () => {
    const seen: string[] = [];
    const resolved = await resolveBusiness(
      { description: 'I clean office buildings' },
      {
        deriveKeywords: async () => deriveOk(['clean office buildings', 'buildings']),
        getCoverage: async ({ keyword }) => {
          seen.push(keyword);
          if (keyword === 'clean office buildings' || keyword === 'I clean office buildings') {
            const miss = coverageOk(keyword, Array.from({ length: 400 }, (_, i) => String(100000 + i)));
            miss.coverage!.naicsCount = 500;
            miss._meta.naics_count = 500;
            return miss;
          }
          if (keyword === 'cleaning') return coverageOk(keyword, ['561720']);
          return coverageMiss(keyword);
        },
      },
    );
    expect(seen[0]).toBe('cleaning');
    expect(seen).not.toContain('I clean office buildings');
    expect(resolved.state).toBe('structured');
    expect(resolved.searchKeyword).toBe('cleaning');
    expect(resolved.primaryNaics).toBe('561720');
  });

  it('omits PSC when coverage has a code but no trusted name', async () => {
    const resolved = await resolveBusiness(
      { description: 'I clean office buildings' },
      {
        deriveKeywords: async () => deriveOk(['janitorial']),
        getCoverage: async ({ keyword }) => {
          const ok = coverageOk(keyword, ['561720']);
          ok.coverage!.topPsc = { code: 'S201', name: '' };
          return ok;
        },
      },
    );
    expect(resolved.state).toBe('structured');
    expect(resolved.psc).toBeNull();
  });
});
