import { describe, expect, it } from 'vitest';
import { searchBeginnerOpportunities } from './search';
import { toBeginnerLandingView } from './landing';
import { EMPTY_MATCH_MESSAGE, UNAVAILABLE_MESSAGE, FOLLOW_UP_PROMPT } from './types';
import type { SamSearchItem } from './types';
import type { CompanyKeywordsToolResult } from '@/mcp/tools/company-keywords';
import type { KeywordCoverageToolResult } from '@/mcp/tools/keyword-coverage';

const NOW = Date.parse('2026-09-08T16:00:00Z');

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

function coverageOk(keyword: string): KeywordCoverageToolResult {
  return {
    queried: { keyword, coverage_target: 0.9 },
    coverage: {
      keyword,
      totalMarket: 1_000_000_000,
      naicsCount: 2,
      allNaics: [
        { code: '561720', name: 'Janitorial Services', amount: 800_000_000, pct: 0.8 },
        { code: '561210', name: 'Facilities Support', amount: 200_000_000, pct: 0.2 },
      ],
      coverageCodes: ['561720', '561210'],
      coveragePct: 0.9,
      topCodePct: 0.8,
      leadCodePct: 0.8,
      pscCount: 1,
      topPsc: { code: 'S201', name: 'Housekeeping and Janitorial Services' },
      topPscPct: 0.8,
      topPscList: [{ code: 'S201', name: 'Housekeeping and Janitorial Services', amount: 800, pct: 0.8 }],
      pinnedPscCodes: null,
    },
    _meta: { grounded: true, degraded: false, naics_count: 2, total_market: 1_000_000_000 },
  };
}

function coverageMiss(keyword: string): KeywordCoverageToolResult {
  return {
    queried: { keyword, coverage_target: 0.9 },
    coverage: null,
    _meta: { grounded: false, degraded: false, naics_count: 0, total_market: 0 },
  };
}

function item(over: Partial<SamSearchItem> = {}): SamSearchItem {
  return {
    title: 'Janitorial Services for Federal Building',
    agency: 'General Services Administration',
    naics: '561720',
    set_aside: 'Total Small Business Set-Aside (FAR 19.5)',
    type: 'Solicitation',
    deadline: '2026-09-16T21:00:00Z',
    solicitation: '47QSHA26Q0001',
    link: 'https://sam.gov/opp/abc123/view',
    ...over,
  };
}

function jargonBlob(value: unknown): string {
  return JSON.stringify(value);
}

describe('toBeginnerLandingView', () => {
  it('shows a grounded market reveal without inventing dollars or codes', async () => {
    const result = await searchBeginnerOpportunities(
      { description: 'I clean office buildings', nowMs: NOW, limit: 8 },
      {
        deriveKeywords: async () => deriveOk(['janitorial services']),
        getCoverage: async ({ keyword }) => coverageOk(keyword),
        searchSam: async () => ({
          ok: true,
          count: 2,
          items: [
            item(),
            item({
              title: 'Custodial Services',
              agency: 'Department of Veterans Affairs',
              solicitation: '36C123',
              link: 'https://sam.gov/opp/def456/view',
            }),
          ],
        }),
      },
    );
    const view = toBeginnerLandingView(result);
    expect(view.outcome).toBe('results');
    expect(view.classification).toBe('structured');
    expect(view.reveal).toEqual([
      'The federal government buys this kind of work.',
      'We found 2 current opportunities related to what you do.',
      'Your description matches opportunities across 2 agencies.',
    ]);
    expect(view.foundCount).toBe(2);
    expect(view.cards).toHaveLength(2);
    expect(view.cards[0].audienceLabel).toBe("Who it's for: Small businesses");
    expect(view.cards[0].noticeLabel).toBe('Open to bid now');
    expect(view.cards[0].samUrl).toContain('sam.gov');
    const blob = jargonBlob(view);
    expect(blob).not.toMatch(/\$/);
    expect(blob).not.toContain('1000000000');
    expect(blob).not.toContain('561720');
    expect(blob).not.toMatch(/naics/i);
    expect(blob).not.toMatch(/\bpsc\b/i);
    expect(blob).not.toContain('"raw"');
  });

  it('does not say the government buys this when classification is only a keyword fallback', async () => {
    const result = await searchBeginnerOpportunities(
      { description: 'I clean office buildings', nowMs: NOW },
      {
        deriveKeywords: async () => deriveOk(['janitorial services']),
        getCoverage: async ({ keyword }) => coverageMiss(keyword),
        searchSam: async () => ({ ok: true, count: 1, items: [item()] }),
      },
    );
    const view = toBeginnerLandingView(result);
    expect(view.classification).toBe('keyword_fallback');
    expect(view.reveal.some((line) => /federal government buys/i.test(line))).toBe(false);
    expect(view.reveal).toContain('We found 1 current opportunity related to what you do.');
    expect(view.cards[0].searchContext).toBe('Based on your description');
  });

  it('caps displayed cards at 5 while keeping the established search count', async () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      item({
        title: `Listing ${i + 1}`,
        solicitation: `SOL-${i + 1}`,
        link: `https://sam.gov/opp/${i + 1}/view`,
        agency: i % 2 === 0 ? 'GSA' : 'VA',
      }),
    );
    const result = await searchBeginnerOpportunities(
      { description: 'I clean office buildings', nowMs: NOW, limit: 8 },
      {
        deriveKeywords: async () => deriveOk(['janitorial services']),
        getCoverage: async ({ keyword }) => coverageOk(keyword),
        searchSam: async () => ({ ok: true, count: items.length, items }),
      },
    );
    const view = toBeginnerLandingView(result);
    expect(view.cards).toHaveLength(5);
    expect(view.foundCount).toBe(8);
    expect(view.reveal[1]).toBe('We found 8 current opportunities related to what you do.');
  });

  it('does not turn a one-agency hit set into an agency-count claim', async () => {
    const result = await searchBeginnerOpportunities(
      { description: 'I clean office buildings', nowMs: NOW },
      {
        deriveKeywords: async () => deriveOk(['janitorial services']),
        getCoverage: async ({ keyword }) => coverageOk(keyword),
        searchSam: async () => ({ ok: true, count: 2, items: [item(), item({ title: 'Night cleaning' })] }),
      },
    );
    const view = toBeginnerLandingView(result);
    expect(view.reveal.some((line) => /agencies/i.test(line))).toBe(false);
  });

  it('keeps a coverage-grounded reveal on a truthful empty search — never zero results', async () => {
    const result = await searchBeginnerOpportunities(
      { description: 'I clean office buildings' },
      {
        deriveKeywords: async () => deriveOk(['janitorial services']),
        getCoverage: async ({ keyword }) => coverageOk(keyword),
        searchSam: async () => ({ ok: true, count: 0, items: [] }),
      },
    );
    const view = toBeginnerLandingView(result);
    expect(view.outcome).toBe('empty');
    expect(view.foundCount).toBeNull();
    expect(view.cards).toEqual([]);
    expect(view.message).toBe(EMPTY_MATCH_MESSAGE);
    expect(view.reveal).toEqual(['The federal government buys this kind of work.']);
    expect(jargonBlob(view)).not.toMatch(/\b0 current opportunities\b/);
  });

  it('shows unavailable, not zero, when SAM fails', async () => {
    const result = await searchBeginnerOpportunities(
      { description: 'I clean office buildings' },
      {
        deriveKeywords: async () => deriveOk(['janitorial services']),
        getCoverage: async ({ keyword }) => coverageOk(keyword),
        searchSam: async () => ({ ok: false, error: 'sam_unavailable', count: 0, items: [] }),
      },
    );
    const view = toBeginnerLandingView(result);
    expect(view.outcome).toBe('unavailable');
    expect(view.message).toBe(UNAVAILABLE_MESSAGE);
    expect(view.foundCount).toBeNull();
    expect(view.cards).toEqual([]);
    expect(view.reveal).toEqual(['The federal government buys this kind of work.']);
  });

  it('surfaces the existing follow-up prompt without searching', async () => {
    const result = await searchBeginnerOpportunities(
      { description: 'I do stuff' },
      {
        deriveKeywords: async () => ({
          keywords: [],
          _meta: { grounded: false, degraded: false, ranked: false, keyword_count: 0, input_chars: 12 },
        }),
        getCoverage: async ({ keyword }) => coverageMiss(keyword),
        searchSam: async () => {
          throw new Error('should not search');
        },
      },
    );
    const view = toBeginnerLandingView(result);
    expect(view.outcome).toBe('need_followup');
    expect(view.followUpPrompt).toBe(FOLLOW_UP_PROMPT);
    expect(view.reveal).toEqual([]);
    expect(view.cards).toEqual([]);
  });
});
