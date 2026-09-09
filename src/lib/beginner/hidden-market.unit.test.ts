import { describe, expect, it } from 'vitest';
import {
  beginnerDirectKeyword,
  buildHiddenMarketReveal,
  coverageTranslatedTerms,
  decideRevealState,
  netNewItems,
  pickExpandedKeyword,
  searchBeginnerHiddenMarket,
  titleMatchesExpanded,
  toHiddenMarketLandingView,
  ctaLabel,
  REVEAL_THRESHOLDS,
} from './hidden-market';
import { opportunityKey } from './opportunity-key';
import { FOLLOW_UP_PROMPT } from './types';
import type { SamSearchItem } from './types';
import type { KeywordCoverage } from '@/lib/market/keyword-coverage';
import type { CompanyKeywordsToolResult } from '@/mcp/tools/company-keywords';
import type { KeywordCoverageToolResult } from '@/mcp/tools/keyword-coverage';

const NOW = Date.parse('2026-09-09T16:00:00Z');

function item(over: Partial<SamSearchItem> = {}): SamSearchItem {
  return {
    title: 'Janitorial Services',
    agency: 'GSA',
    naics: '561720',
    set_aside: 'Total Small Business Set-Aside (FAR 19.5)',
    type: 'Solicitation',
    deadline: '2026-09-16T21:00:00Z',
    solicitation: 'SOL-A',
    link: 'https://sam.gov/workspace/contract/opp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/view',
    ...over,
  };
}

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
      totalMarket: 1_000_000_000,
      naicsCount: 2,
      allNaics: [
        { code: '561720', name: 'Janitorial Services', amount: 800, pct: 0.8 },
        { code: '561210', name: 'Facilities Support Services', amount: 200, pct: 0.2 },
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

describe('opportunityKey', () => {
  it('prefers the 32-char notice id in the SAM url', () => {
    expect(opportunityKey(item())).toBe('notice:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('falls back to solicitation when the link has no notice id', () => {
    expect(opportunityKey(item({ link: 'https://not-a-sam-link', solicitation: 'W912LR26QA045' }))).toBe(
      'sol:w912lr26qa045',
    );
  });

  it('returns null when neither identity is present — that item cannot enter a hidden count', () => {
    expect(opportunityKey(item({ link: null, solicitation: null }))).toBeNull();
  });
});

describe('netNewItems', () => {
  it('does not count an overlap as hidden', () => {
    const a = item();
    const bOverlap = item({ title: 'Same notice, different title' });
    const bNew = item({
      title: 'Landscaping',
      solicitation: 'SOL-B',
      link: 'https://sam.gov/workspace/contract/opp/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/view',
    });
    const hidden = netNewItems([a], [bOverlap, bNew]);
    expect(hidden).toHaveLength(1);
    expect(opportunityKey(hidden[0])).toBe('notice:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('never treats an unkeyed expanded row as net-new', () => {
    const hidden = netNewItems(
      [item()],
      [item({ link: null, solicitation: null, title: 'Mystery' })],
    );
    expect(hidden).toEqual([]);
  });
});

describe('decideRevealState', () => {
  it('is unavailable when both sides failed — never 0 hidden', () => {
    expect(
      decideRevealState({
        directStatus: 'unavailable',
        expandedStatus: 'unavailable',
        directMatchCount: null,
        expandedMatchCount: null,
        totalUniqueCount: null,
      }),
    ).toBe('unavailable');
  });

  it('is unavailable when direct failed even if expanded returned rows', () => {
    expect(
      decideRevealState({
        directStatus: 'unavailable',
        expandedStatus: 'ok',
        directMatchCount: null,
        expandedMatchCount: 5,
        totalUniqueCount: null,
      }),
    ).toBe('unavailable');
  });

  it('is strong when there is a real direct set and 3+ net-new', () => {
    expect(
      decideRevealState({
        directStatus: 'ok',
        expandedStatus: 'ok',
        directMatchCount: 1,
        expandedMatchCount: 3,
        totalUniqueCount: 4,
      }),
    ).toBe('strong');
  });

  it('is expanded_only when the user words hit 0 and translation found listings', () => {
    expect(
      decideRevealState({
        directStatus: 'ok',
        expandedStatus: 'ok',
        directMatchCount: 0,
        expandedMatchCount: 2,
        totalUniqueCount: 2,
      }),
    ).toBe('expanded_only');
  });

  it('is direct_only when coverage added nothing new', () => {
    expect(
      decideRevealState({
        directStatus: 'ok',
        expandedStatus: 'skipped',
        directMatchCount: 5,
        expandedMatchCount: 0,
        totalUniqueCount: 5,
      }),
    ).toBe('direct_only');
  });

  it('is thin for a tiny unique set', () => {
    expect(
      decideRevealState({
        directStatus: 'ok',
        expandedStatus: 'ok',
        directMatchCount: 1,
        expandedMatchCount: 1,
        totalUniqueCount: 2,
      }),
    ).toBe('thin');
  });
});

describe('coverageTranslatedTerms', () => {
  it('returns coverage names the user did not type, never codes or dollars', () => {
    const coverage = coverageOk('cleaning').coverage as KeywordCoverage;
    const terms = coverageTranslatedTerms('I clean office buildings', coverage);
    expect(terms.join(' ')).toMatch(/janitorial/i);
    expect(terms.join(' ')).not.toMatch(/561720/);
    expect(terms.join(' ')).not.toMatch(/S201/);
    expect(terms.every((t) => !/vegetation management/i.test(t))).toBe(true);
    expect(terms.every((t) => !/ship building/i.test(t))).toBe(true);
    expect(terms.every((t) => !/all other/i.test(t))).toBe(true);
  });

  it('drops phrases the user already used so lawn-care does not invent a hidden synonym they typed', () => {
    const coverage: KeywordCoverage = {
      ...(coverageOk('lawn care').coverage as KeywordCoverage),
      keyword: 'lawn care',
      allNaics: [{ code: '561730', name: 'Landscaping Services', amount: 1, pct: 1 }],
      topPsc: { code: 'S208', name: 'Landscaping/Groundskeeping' },
    };
    const terms = coverageTranslatedTerms('I do lawn care and grounds maintenance', coverage);
    expect(terms.some((t) => /lawn care/i.test(t))).toBe(false);
    expect(terms.some((t) => /landscaping/i.test(t))).toBe(true);
  });
});

describe('beginnerDirectKeyword', () => {
  it('uses the user words, not a gerund expansion', () => {
    expect(beginnerDirectKeyword('I clean office buildings')?.toLowerCase()).toContain('clean');
    expect(beginnerDirectKeyword('I clean office buildings')?.toLowerCase()).not.toBe('cleaning');
  });
});

describe('pickExpandedKeyword', () => {
  it('returns nothing when coverage language is already what the user typed', () => {
    expect(pickExpandedKeyword('I do lawn care', 'lawn care', [], 'lawn care')).toBeNull();
  });

  it('picks coverage language the user did not type', () => {
    expect(pickExpandedKeyword('I clean office buildings', 'cleaning', ['Janitorial Services'], 'clean office buildings')).toBe(
      'Janitorial Services',
    );
  });
});

describe('searchBeginnerHiddenMarket', () => {
  it('asks follow-up on a vague input and never searches an expanded population', async () => {
    let searches = 0;
    const result = await searchBeginnerHiddenMarket(
      { description: 'I help businesses' },
      {
        deriveKeywords: async () => ({
          keywords: [],
          _meta: { grounded: false, degraded: false, ranked: false, keyword_count: 0, input_chars: 18 },
        }),
        getCoverage: async () => ({
          queried: { keyword: 'x', coverage_target: 0.9 },
          coverage: null,
          _meta: { grounded: false, degraded: false, naics_count: 0, total_market: 0 },
        }),
        searchSam: async () => {
          searches += 1;
          return { ok: true, count: 0, items: [] };
        },
      },
    );
    expect(searches).toBe(0);
    expect(result.resolution.state).toBe('need_followup');
    expect(result.expanded.status).toBe('skipped');
    expect(result.reveal.expandedMatchCount).toBeNull();
  });

  it('never treats an upstream failure as 0 hidden opportunities', async () => {
    const result = await searchBeginnerHiddenMarket(
      { description: 'I clean office buildings' },
      {
        deriveKeywords: async () => deriveOk(['janitorial services']),
        getCoverage: async ({ keyword }) => coverageOk(keyword),
        searchSam: async () => ({ ok: false, error: 'sam_unavailable', count: 0, items: [] }),
      },
    );
    expect(result.reveal.revealState).toBe('unavailable');
    expect(result.reveal.expandedMatchCount).toBeNull();
    expect(result.reveal.directMatchCount).toBeNull();
    expect(result.reveal.explanation).not.toMatch(/0 hidden/i);
    expect(result.reveal.explanation).toMatch(/couldn['']t measure the broader market/i);
  });

  it('counts expanded as net-new after dedupe, and never sums A+B as a total', async () => {
    const directHit = item();
    const overlap = item({ title: 'Same janitorial notice' });
    const hidden = [
      item({
        title: 'Janitorial Custodial',
        solicitation: 'SOL-2',
        link: 'https://sam.gov/workspace/contract/opp/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/view',
        agency: 'VA',
      }),
      item({
        title: 'Janitorial Facilities',
        solicitation: 'SOL-3',
        link: 'https://sam.gov/workspace/contract/opp/cccccccccccccccccccccccccccccccc/view',
        agency: 'Army',
      }),
      item({
        title: 'Janitorial Housekeeping',
        solicitation: 'SOL-4',
        link: 'https://sam.gov/workspace/contract/opp/dddddddddddddddddddddddddddddddd/view',
        agency: 'Navy',
      }),
    ];
    const result = await searchBeginnerHiddenMarket(
      { description: 'I clean office buildings', nowMs: NOW },
      {
        deriveKeywords: async () => deriveOk(['janitorial services']),
        getCoverage: async ({ keyword }) => coverageOk(keyword),
        searchSam: async ({ keyword }) => {
          if (/janitorial|housekeeping|facilit/i.test(keyword)) {
            return { ok: true, count: 4, items: [overlap, ...hidden] };
          }
          return { ok: true, count: 1, items: [directHit] };
        },
      },
    );
    expect(result.reveal.directMatchCount).toBe(1);
    expect(result.reveal.expandedMatchCount).toBe(3);
    expect(result.reveal.totalUniqueCount).toBe(4);
    // The lie is |A| + |B| (1+4=5). |A| + |B\A| equals the union by construction
    // once expanded is already net-new — that identity is not an overclaim.
    const rawExpandedSize = 4;
    expect(result.reveal.totalUniqueCount).not.toBe(
      (result.reveal.directMatchCount || 0) + rawExpandedSize,
    );
    expect(result.reveal.revealState).toBe('strong');
    const view = toHiddenMarketLandingView(result, { nowMs: NOW });
    expect(view.directCards).toHaveLength(1);
    expect(view.uncoveredCards).toHaveLength(REVEAL_THRESHOLDS.cardsPerGroup);
    expect(view.uncoveredCards.every((c) => c.samUrl !== view.directCards[0].samUrl)).toBe(true);
    const blob = JSON.stringify(view);
    expect(blob).not.toContain('561720');
    expect(blob).not.toContain('1000000000');
    expect(blob).not.toMatch(/\$/);
    expect(blob).not.toMatch(/\bNAICS\b/);
    expect(view.reveal?.explanation).toMatch(/You'd have found 1/);
    expect(view.reveal?.explanation).toMatch(/Mindy found 4/);
  });

  it('does not render an uncovered group when there is no hidden market', async () => {
    const result = await searchBeginnerHiddenMarket(
      { description: 'I do lawn care', nowMs: NOW },
      {
        deriveKeywords: async () => deriveOk(['lawn care']),
        getCoverage: async ({ keyword }) => ({
          queried: { keyword, coverage_target: 0.9 },
          coverage: {
            ...(coverageOk(keyword).coverage as KeywordCoverage),
            keyword: 'lawn care',
            allNaics: [{ code: '561730', name: 'Lawn Care', amount: 1, pct: 1 }],
            topPsc: { code: 'S208', name: 'Lawn Care' },
            topPscList: [],
          },
          _meta: { grounded: true, degraded: false, naics_count: 1, total_market: 1 },
        }),
        searchSam: async () => ({
          ok: true,
          count: 4,
          items: [0, 1, 2, 3].map((i) =>
            item({
              title: `Lawn ${i}`,
              solicitation: `L${i}`,
              link: `https://sam.gov/workspace/contract/opp/${String(i).repeat(32)}/view`,
            }),
          ),
        }),
      },
    );
    expect(result.expandedKeyword).toBeNull();
    expect(result.expanded.status).toBe('skipped');
    expect(result.reveal.expandedMatchCount).toBe(0);
    expect(result.reveal.revealState).toBe('direct_only');
    const view = toHiddenMarketLandingView(result, { nowMs: NOW });
    expect(view.uncoveredCards).toEqual([]);
    expect(view.reveal?.explanation).not.toMatch(/missed|uncovered|translated/i);
  });
});

describe('buildHiddenMarketReveal', () => {
  it('does not treat expanded hits as hidden when the direct search failed', () => {
    const reveal = buildHiddenMarketReveal({
      structured: true,
      directStatus: 'unavailable',
      expandedStatus: 'ok',
      directItems: [],
      expandedItems: [
        item({
          solicitation: 'NEW',
          link: 'https://sam.gov/workspace/contract/opp/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/view',
        }),
      ],
      translatedTerms: ['Janitorial Services'],
    });
    expect(reveal.revealState).toBe('unavailable');
    expect(reveal.expandedMatchCount).toBeNull();
    expect(reveal.directMatchCount).toBeNull();
    expect(reveal.explanation).not.toMatch(/0 hidden/i);
  });

  it('leaves totalUniqueCount null when an identity is missing rather than adding the two counts', () => {
    const reveal = buildHiddenMarketReveal({
      structured: true,
      directStatus: 'ok',
      expandedStatus: 'ok',
      directItems: [item({ link: null, solicitation: null })],
      expandedItems: [
        item({
          solicitation: 'NEW',
          link: 'https://sam.gov/workspace/contract/opp/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/view',
        }),
      ],
      translatedTerms: ['Janitorial Services'],
    });
    expect(reveal.totalUniqueCount).toBeNull();
    expect(reveal.directMatchCount).toBe(1);
    expect(reveal.limitations?.some((l) => /combined total/i.test(l))).toBe(true);
  });
});

describe('titleMatchesExpanded', () => {
  it('drops body-pass hits that only matched a generic word like services', () => {
    expect(
      titleMatchesExpanded(
        item({ title: 'DRYDOCK REPAIRS FOR THE CGC PAMLICO' }),
        'Temporary Help Services',
      ),
    ).toBe(false);
    expect(titleMatchesExpanded(item({ title: 'Temporary Help for VA clinics' }), 'Temporary Help Services')).toBe(
      true,
    );
  });
});

describe('FOLLOW_UP_PROMPT still used for weak classification', () => {
  it('keeps the existing plain-English prompt', () => {
    expect(FOLLOW_UP_PROMPT).toBe('What do you actually do for customers?');
  });
});

describe('ctaLabel', () => {
  it('uses the A/B label only on strong reveals', () => {
    expect(ctaLabel('full_market', 'strong')).toBe('See your full market with Mindy');
    expect(ctaLabel('more', 'strong')).toBe('See more opportunities with Mindy');
    expect(ctaLabel('full_market', 'direct_only')).toBe('See more opportunities with Mindy');
  });
});
