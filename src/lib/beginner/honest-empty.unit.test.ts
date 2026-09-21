/**
 * An exact-token miss is not market absence.
 *
 * `/try` matches the words in a listing's TITLE. Measured 2026-09-21, "we mow
 * lawns": zero open titles contain "lawn" or "mowing", while ~18 open
 * grounds-maintenance notices (NAICS 561730) ARE that business. Four separate
 * copy sites turned that miss into a claim about the market, and all four were
 * shipping. These tests are the guard.
 *
 * (Lived in detail-evidence.unit.test.ts until that fallback was removed —
 * the copy is independent of it and must not leave with it.)
 */
import { describe, expect, it } from 'vitest';
import { searchBeginnerHiddenMarket, toHiddenMarketLandingView } from './hidden-market';
import { AWARDED_ONLY_EXPLANATION } from './hidden-market';
import { EMPTY_MATCH_MESSAGE, EMPTY_OPEN_MARKET_MESSAGE } from './types';
import type { CompanyKeywordsToolResult } from '@/mcp/tools/company-keywords';
import type { SamSearchItem } from './types';

const ABSENCE_CLAIMS = /nothing matching is open|the open market is small|0 current opportunit|no opportunities exist/i;

function derive(keywords: string[]): CompanyKeywordsToolResult {
  return {
    keywords,
    _meta: {
      grounded: keywords.length > 0,
      degraded: false,
      ranked: false,
      keyword_count: keywords.length,
      input_chars: 20,
    },
  };
}

function item(over: Partial<SamSearchItem> = {}): SamSearchItem {
  return {
    title: 'Trash and Garbage Removal Services',
    agency: 'STATE, DEPARTMENT OF',
    naics: '562998',
    set_aside: null,
    type: 'Solicitation',
    deadline: '2026-10-15T17:00:00Z',
    solicitation: 'S-1',
    link: 'https://sam.gov/workspace/contract/opp/cccccccccccccccccccccccccccccccc/view',
    ...over,
  };
}

describe('zero results never read as market absence', () => {
  it('every shared empty-state string states the limit of the SEARCH', () => {
    for (const copy of [EMPTY_MATCH_MESSAGE, EMPTY_OPEN_MARKET_MESSAGE, AWARDED_ONLY_EXPLANATION]) {
      expect(copy).not.toMatch(ABSENCE_CLAIMS);
      expect(copy).toMatch(/limit of this search|not a sign that nothing is open|not a reading of the market/i);
    }
  });

  it('names the words searched instead of claiming the market is empty', async () => {
    const result = await searchBeginnerHiddenMarket(
      { description: 'we mow lawns' },
      {
        deriveKeywords: async () => derive(['mow lawns']),
        searchSam: async () => ({ ok: true, count: 0, items: [] }),
      },
    );
    const view = toHiddenMarketLandingView(result);
    const blob = `${view.message ?? ''} ${view.reveal?.explanation ?? ''}`;
    expect(blob).not.toMatch(ABSENCE_CLAIMS);
    expect(blob).toMatch(/not a sign that nothing is open|not a reading of the market/i);
  });

  it('a thin RESULT is never reported as a thin MARKET', async () => {
    const result = await searchBeginnerHiddenMarket(
      { description: 'can a 2 person garbage company do government contracts' },
      {
        deriveKeywords: async () => derive(['garbage']),
        searchSam: async () => ({ ok: true, count: 1, items: [item()] }),
      },
    );
    // The garbage hauler was shown "the open market is small right now" while
    // ~20 open refuse / solid-waste notices existed under words they had not typed.
    expect(result.reveal.explanation).not.toMatch(ABSENCE_CLAIMS);
    expect(result.reveal.explanation).toMatch(/title names/i);
    expect(result.reveal.searchedTerms).toContain('garbage');
  });

  it('the reveal carries the words actually sent to SAM', async () => {
    const result = await searchBeginnerHiddenMarket(
      { description: 'we install commercial roofing' },
      {
        deriveKeywords: async () => derive(['commercial roofing']),
        searchSam: async () => ({ ok: true, count: 0, items: [] }),
      },
    );
    expect(result.reveal.searchedTerms).toContain('roofing');
    expect(result.reveal.explanation).toContain('"roofing"');
  });
});
