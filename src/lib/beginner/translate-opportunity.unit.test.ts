import { describe, expect, it } from 'vitest';
import { translateOpportunity } from './translate-opportunity';
import { EMPTY_MATCH_MESSAGE, UNAVAILABLE_MESSAGE } from './types';
import type { SamSearchItem } from './types';
import { searchBeginnerOpportunities } from './search';
import type { CompanyKeywordsToolResult } from '@/mcp/tools/company-keywords';
import type { KeywordCoverageToolResult } from '@/mcp/tools/keyword-coverage';

const NOW = Date.parse('2026-09-08T16:00:00Z');

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
    location: { pop_state: 'DC', pop_city: 'Washington', office_state: 'DC' },
    ...over,
  };
}

describe('translateOpportunity', () => {
  it('renders a beginner card without GovCon codes', () => {
    const card = translateOpportunity(item(), { nowMs: NOW, eligibility: { established: false } });
    expect(card.title).toBe('Janitorial Services for Federal Building');
    expect(card.noticeLabel).toBe('Open to bid now');
    expect(card.setAsideLabel).toBe('Small Business set-aside');
    expect(card.audienceLabel).toBe("Who it's for: Small businesses");
    expect(card.dueLabel).toBe('Due in 8 days · Sept 16');
    expect(card.plainMeaning).toContain('accepting offers');
    expect(card.nextStep).toContain('Open the listing');
    expect(card.referenceNumber).toBe('47QSHA26Q0001');
    expect(card.samUrl).toBe('https://sam.gov/opp/abc123/view');
    expect(card.grounded).toBe(true);
    expect(card.amountLabel).toBeNull(); // field absent on SAM search items
    expect(card.pscLabel).toBeNull();
    const visible = `${card.title} ${card.noticeLabel} ${card.setAsideLabel} ${card.audienceLabel} ${card.dueLabel} ${card.plainMeaning} ${card.nextStep}`;
    expect(visible).not.toMatch(/\b561720\b/);
    expect(visible).not.toMatch(/\bSBA\b/);
    expect(visible.toLowerCase()).not.toContain('naics');
    expect(visible.toLowerCase()).not.toContain('likely you');
    expect(card.raw.naics).toBe('561720'); // preserved underneath
  });

  it('omits amount when the field is absent and lists it when present-but-null', () => {
    expect(translateOpportunity(item(), { nowMs: NOW }).amountLabel).toBeNull();
    expect(translateOpportunity(item({ amount: null }), { nowMs: NOW }).amountLabel).toBe(
      'Amount not listed',
    );
    expect(translateOpportunity(item({ amount: 0 }), { nowMs: NOW }).amountLabel).toBe('$0');
    expect(translateOpportunity(item({ amount: 850_000 }), { nowMs: NOW }).amountLabel).toBe('$850K');
  });

  it('omits PSC when only a code is present', () => {
    const card = translateOpportunity(item({ psc_code: 'S201', psc_description: null }), { nowMs: NOW });
    expect(card.pscLabel).toBeNull();
  });

  it('keeps raw source fields for advanced views', () => {
    const raw = item({ type: 'Sources Sought' });
    const card = translateOpportunity(raw, { nowMs: NOW });
    expect(card.noticeLabel).toBe("They're researching the market");
    expect(card.raw).toBe(raw);
    expect(card.raw.type).toBe('Sources Sought');
  });
});

function deriveOk(keywords: string[]): CompanyKeywordsToolResult {
  return {
    keywords,
    _meta: { grounded: true, degraded: false, ranked: true, keyword_count: keywords.length, input_chars: 40 },
  };
}

function coverageOk(keyword: string): KeywordCoverageToolResult {
  return {
    queried: { keyword, coverage_target: 0.9 },
    coverage: {
      keyword,
      totalMarket: 1,
      naicsCount: 1,
      allNaics: [{ code: '561720', name: 'Janitorial', amount: 1, pct: 1 }],
      coverageCodes: ['561720'],
      coveragePct: 1,
      topCodePct: 1,
      leadCodePct: 1,
      pscCount: 1,
      topPsc: { code: 'S201', name: 'Housekeeping and Janitorial Services' },
      topPscPct: 1,
      topPscList: [],
      pinnedPscCodes: null,
    },
    _meta: { grounded: true, degraded: false, naics_count: 1, total_market: 1 },
  };
}

describe('searchBeginnerOpportunities grounding states', () => {
  it('renders grounded results', async () => {
    const result = await searchBeginnerOpportunities(
      { description: 'I clean office buildings', nowMs: NOW },
      {
        deriveKeywords: async () => deriveOk(['janitorial']),
        getCoverage: async ({ keyword }) => coverageOk(keyword),
        searchSam: async () => ({ ok: true, count: 1, items: [item()] }),
      },
    );
    expect(result.outcome.kind).toBe('results');
    if (result.outcome.kind === 'results') {
      expect(result.outcome.count).toBe(1);
      expect(result.outcome.cards[0].samUrl).toContain('sam.gov');
    }
  });

  it('uses the genuine-empty message when a successful search returns zero', async () => {
    const result = await searchBeginnerOpportunities(
      { description: 'I clean office buildings' },
      {
        deriveKeywords: async () => deriveOk(['janitorial']),
        getCoverage: async ({ keyword }) => coverageOk(keyword),
        searchSam: async () => ({ ok: true, count: 0, items: [], note: 'No open SAM opportunities matched' }),
      },
    );
    expect(result.outcome).toEqual({ kind: 'empty', message: EMPTY_MATCH_MESSAGE });
    expect(result.outcome.kind === 'empty' ? result.outcome.message : '').not.toBe(UNAVAILABLE_MESSAGE);
  });

  it('uses the unavailable message when SAM itself fails', async () => {
    const result = await searchBeginnerOpportunities(
      { description: 'I clean office buildings' },
      {
        deriveKeywords: async () => deriveOk(['janitorial']),
        getCoverage: async ({ keyword }) => coverageOk(keyword),
        searchSam: async () => ({ ok: false, error: 'sam_unavailable', count: 0, items: [] }),
      },
    );
    expect(result.outcome).toEqual({ kind: 'unavailable', message: UNAVAILABLE_MESSAGE });
  });

  it('does not treat a missing items array as an empty market', async () => {
    const result = await searchBeginnerOpportunities(
      { description: 'I clean office buildings' },
      {
        deriveKeywords: async () => deriveOk(['janitorial']),
        getCoverage: async ({ keyword }) => coverageOk(keyword),
        searchSam: async () => ({ ok: true, count: 0 } as unknown as { ok: true; count: number; items: [] }),
      },
    );
    expect(result.outcome.kind).toBe('unavailable');
  });

  it('does not search until the follow-up is answered', async () => {
    let searched = false;
    const result = await searchBeginnerOpportunities(
      { description: 'I do stuff' },
      {
        deriveKeywords: async () => ({
          keywords: [],
          _meta: { grounded: false, degraded: false, ranked: false, keyword_count: 0, input_chars: 12 },
        }),
        getCoverage: async () => coverageOk('x'),
        searchSam: async () => {
          searched = true;
          return { ok: true, count: 0, items: [] };
        },
      },
    );
    expect(searched).toBe(false);
    expect(result.outcome.kind).toBe('need_followup');
  });
});
