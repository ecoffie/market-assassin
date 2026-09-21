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
import { FOLLOW_UP_PROMPT, EMPTY_OPEN_MARKET_MESSAGE } from './types';
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

function deriveEmpty(): CompanyKeywordsToolResult {
  return {
    keywords: [],
    _meta: { grounded: false, degraded: false, ranked: false, keyword_count: 0, input_chars: 9 },
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
      transactionCount: 1,
      uniqueAwardCount: 1,
      fiscalYear: 2025,
      source: 'bigquery_usaspending_awards',
      sourceMaxActionDate: '2025-09-30',
      allAgencies: [],
      primarySense: 'work_text',
      evidenceStatus: 'MARKET_EVIDENCE_FOUND',
      naicsIdentityStatus: 'NOT_ESTABLISHED',
    },
    _meta: { grounded: true, degraded: false, naics_count: 2, total_market: 1_000_000_000 },
  };
}

describe('beginnerDirectKeyword', () => {
  it('searches the object for a repair-verb description so titles like Replace Doors match', () => {
    // CHANGED 2026-09-21 (adversarial pass): the SINGULAR is searched. SAM's
    // title search is an ILIKE substring, so "%fences%" missed "Fence",
    // "Fencing" and "Fence Repair" — 14 live fence notices reduced to 2, under
    // a headline reading "Mindy found 0". The singular is a substring of both.
    expect(beginnerDirectKeyword('fix doors')).toBe('door');
    // CHANGED 2026-09-21: the keyword is now the ACTIVITY, not the sentence.
    // "%clean office buildings%" matches no SAM title at all — it only ever
    // "worked" because search_sam_opportunities silently retries token-by-token
    // on a zero result. The keyword is now for RECALL and the evidence gate
    // supplies PRECISION, so a broad-but-correct activity word is right here.
    expect(beginnerDirectKeyword('I clean office buildings')).toBe('clean');
  });

  it('searches lidar, not the whole sentence, for a six-word drone description', () => {
    expect(beginnerDirectKeyword('work with lidar for uas drones')).toBe('lidar');
    // CHANGED 2026-09-21: see above — the single activity noun is searched and
    // "window washing" is still held as evidence (activity.terms), so a
    // "Window Washing Services" title still outranks a bare "window" hit.
    expect(beginnerDirectKeyword('I do window washing')).toBe('window');
  });
});

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

  it('does not call a measured-empty market thin — 0 listings is not "here is what we found"', () => {
    expect(
      decideRevealState({
        directStatus: 'ok',
        expandedStatus: 'ok',
        directMatchCount: 0,
        expandedMatchCount: 0,
        totalUniqueCount: 0,
      }),
    ).not.toBe('thin');
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

  it('returns construction door listings for "fix doors", not a follow-up', async () => {
    const keywords: string[] = [];
    const result = await searchBeginnerHiddenMarket(
      { description: 'fix doors', nowMs: NOW },
      {
        deriveKeywords: async () => deriveEmpty(),
        getCoverage: async ({ keyword }) => {
          if (keyword === 'door repair' || keyword === 'door replacement') {
            return {
              queried: { keyword, coverage_target: 0.9 },
              coverage: {
                ...(coverageOk(keyword).coverage as KeywordCoverage),
                keyword,
                allNaics: [
                  { code: '236220', name: 'Commercial and Institutional Building Construction', amount: 4, pct: 0.7 },
                  { code: '238290', name: 'Other Building Equipment Contractors', amount: 1, pct: 0.3 },
                ],
                coverageCodes: ['236220', '238290'],
                topPsc: { code: 'Z2JZ', name: 'Repair or Alteration of Miscellaneous Buildings' },
                topPscList: [],
              },
              _meta: { grounded: true, degraded: false, naics_count: 2, total_market: 5 },
            };
          }
          return {
            queried: { keyword, coverage_target: 0.9 },
            coverage: null,
            _meta: { grounded: false, degraded: false, naics_count: 0, total_market: 0 },
          };
        },
        searchSam: async ({ keyword }) => {
          keywords.push(keyword);
          if (!/door/i.test(keyword)) return { ok: true, count: 0, items: [] };
          return {
            ok: true,
            count: 3,
            items: [
              item({
                title: 'Replace Garage Doors',
                naics: '238290',
                solicitation: 'DOOR-1',
                link: 'https://sam.gov/workspace/contract/opp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/view',
              }),
              item({
                title: 'Repair Operating Room Doors',
                naics: '238290',
                solicitation: 'DOOR-2',
                link: 'https://sam.gov/workspace/contract/opp/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/view',
              }),
              item({
                title: 'Automobile Door Assemblies',
                naics: '336111',
                solicitation: 'AUTO-1',
                link: 'https://sam.gov/workspace/contract/opp/cccccccccccccccccccccccccccccccc/view',
              }),
            ],
          };
        },
      },
    );
    expect(result.resolution.state).toBe('structured');
    expect(result.resolution.primaryNaics).toBeNull();
    expect(keywords).toContain('door'); // singular — see beginnerDirectKeyword above
    expect(result.direct.items.map((i) => i.solicitation)).toEqual(['DOOR-1', 'DOOR-2']);
    const view = toHiddenMarketLandingView(result, { nowMs: NOW });
    expect(view.outcome).toBe('results');
    expect(view.directCards.some((c) => /Garage Doors/i.test(c.title))).toBe(true);
    expect(view.directCards.some((c) => /Automobile/i.test(c.title))).toBe(false);
  });

  it('returns lidar listings for a six-word drone description, not an empty open market', async () => {
    const keywords: string[] = [];
    const result = await searchBeginnerHiddenMarket(
      { description: 'work with lidar for uas drones', nowMs: NOW },
      {
        deriveKeywords: async () => deriveOk(['unmanned aircraft', 'drones']),
        getCoverage: async ({ keyword }) => {
          if (keyword === 'drones' || keyword === 'unmanned aircraft') {
            return {
              queried: { keyword, coverage_target: 0.9 },
              coverage: {
                ...(coverageOk(keyword).coverage as KeywordCoverage),
                keyword,
                allNaics: [
                  { code: '336411', name: 'Aircraft Manufacturing', amount: 4, pct: 0.7 },
                  { code: '336413', name: 'Other Aircraft Parts and Auxiliary Equipment', amount: 1, pct: 0.3 },
                ],
                coverageCodes: ['336411', '336413'],
                topPsc: { code: '1550', name: 'Unmanned Aircraft' },
                topPscList: [],
              },
              _meta: { grounded: true, degraded: false, naics_count: 2, total_market: 5 },
            };
          }
          return {
            queried: { keyword, coverage_target: 0.9 },
            coverage: null,
            _meta: { grounded: false, degraded: false, naics_count: 0, total_market: 0 },
          };
        },
        searchSam: async ({ keyword }) => {
          keywords.push(keyword);
          if (!/lidar/i.test(keyword)) return { ok: true, count: 0, items: [] };
          return {
            ok: true,
            count: 2,
            items: [
              item({
                title: 'WESTERN MINES LIDAR SURVEY',
                naics: '541370',
                solicitation: 'LIDAR-1',
                link: 'https://sam.gov/workspace/contract/opp/dddddddddddddddddddddddddddddddd/view',
              }),
              item({
                title: 'UAS LIDAR YELLOWSCAN MAPPER ULTRA',
                naics: '334511',
                solicitation: 'LIDAR-2',
                link: 'https://sam.gov/workspace/contract/opp/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/view',
              }),
            ],
          };
        },
      },
    );
    expect(result.directKeyword).toBe('lidar');
    expect(keywords).toContain('lidar');
    expect(keywords.some((k) => k.split(/\s+/).length > 3)).toBe(false);
    expect(result.direct.items.map((i) => i.solicitation)).toEqual(['LIDAR-1', 'LIDAR-2']);
    const view = toHiddenMarketLandingView(result, { nowMs: NOW });
    expect(view.outcome).toBe('results');
    expect(view.directCards.some((c) => /LIDAR/i.test(c.title))).toBe(true);
    expect(view.message || '').not.toMatch(/nothing matching is open/i);
    expect(view.reveal?.explanation || '').not.toMatch(/nothing matching is open/i);
  });

  it('skips USASpending entirely when getCoverage is omitted', async () => {
    const result = await searchBeginnerHiddenMarket(
      { description: 'work with lidar for uas drones', nowMs: NOW },
      {
        deriveKeywords: async () => deriveEmpty(),
        searchSam: async ({ keyword }) => {
          if (!/lidar/i.test(keyword)) return { ok: true, count: 0, items: [] };
          return {
            ok: true,
            count: 1,
            items: [
              item({
                title: 'WESTERN MINES LIDAR SURVEY',
                naics: '541370',
                solicitation: 'LIDAR-CACHE',
                link: 'https://sam.gov/workspace/contract/opp/ffffffffffffffffffffffffffffffff/view',
              }),
            ],
          };
        },
      },
    );
    expect(result.resolution.coverageKeyword).toBeNull();
    expect(result.directKeyword).toBe('lidar');
    expect(toHiddenMarketLandingView(result, { nowMs: NOW }).outcome).toBe('results');
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
    // The fixture must be in the SAME market as the description, or the
    // relevance gate (correctly) drops it and this stops testing dedupe math.
    const directHit = item({ title: 'Interior Cleaning Services' });
    const overlap = item({ title: 'Same janitorial cleaning notice' });
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

  it('drops Dale Carnegie Building-training from an HVAC/construction search', async () => {
    const result = await searchBeginnerHiddenMarket(
      { description: 'I do HVAC and building construction', nowMs: NOW },
      {
        deriveKeywords: async () => deriveOk(['hvac']),
        getCoverage: async ({ keyword }) => ({
          queried: { keyword, coverage_target: 0.9 },
          coverage: {
            ...(coverageOk(keyword).coverage as KeywordCoverage),
            keyword,
            allNaics: [
              { code: '238220', name: 'Plumbing, Heating, and Air-Conditioning Contractors', amount: 3, pct: 0.5 },
              { code: '236220', name: 'Commercial and Institutional Building Construction', amount: 2, pct: 0.3 },
              { code: '541512', name: 'Computer Systems Design Services', amount: 1, pct: 0.2 },
            ],
            coverageCodes: ['238220', '236220', '541512'],
            topPsc: { code: 'Z1AA', name: 'Maintenance of Office Buildings' },
            topPscList: [],
          },
          _meta: { grounded: true, degraded: false, naics_count: 3, total_market: 1 },
        }),
        searchSam: async () => ({
          ok: true,
          count: 2,
          items: [
            item({
              title: 'Replace Air Handling Units',
              naics: '238220',
              solicitation: 'HVAC-1',
              deadline: '2026-09-16T21:00:00Z',
              link: 'https://sam.gov/workspace/contract/opp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/view',
            }),
            item({
              title: 'Dale Carnegie Building a Stronger and More Cohesive Team Training on Fort Drum, NY',
              naics: '611430',
              solicitation: 'W911S226QA089',
              deadline: '2026-09-09T15:00:00+00:00',
              link: 'https://sam.gov/workspace/contract/opp/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/view',
            }),
          ],
        }),
      },
    );
    // CHANGED 2026-09-21: "Replace Air Handling Units" names no word the user
    // typed — only its NAICS (238220) says it is HVAC work. Code overlap alone
    // can no longer produce a DESCRIBED match, so it moves to the explicitly
    // adjacent group. It is still SHOWN; it just stops claiming to match the
    // user's words. Dale Carnegie appears in neither group, which is what this
    // test exists for.
    expect(result.direct.items.map((i) => i.solicitation)).toEqual([]);
    expect(result.related.map((i) => i.solicitation)).toEqual(['HVAC-1']);
    expect(result.related.some((i) => /Dale Carnegie/i.test(i.title || ''))).toBe(false);
    const view = toHiddenMarketLandingView(result, { nowMs: NOW });
    expect(view.directCards.some((c) => /Dale Carnegie/i.test(c.title))).toBe(false);
    expect(view.relatedCards.some((c) => /Dale Carnegie/i.test(c.title))).toBe(false);
    expect(view.relatedCards.map((c) => c.referenceNumber)).toEqual(['HVAC-1']);
    expect(view.relatedCards[0]?.dueLabel).toBe('Bid due in 7 days · Sept 16');
  });

  it('does not say here is what we found when SAM returned nothing', async () => {
    const result = await searchBeginnerHiddenMarket(
      { description: 'I clean office buildings', nowMs: NOW },
      {
        deriveKeywords: async () => deriveOk(['janitorial services']),
        getCoverage: async ({ keyword }) => coverageOk(keyword),
        searchSam: async () => ({ ok: true, count: 0, items: [] }),
      },
    );
    expect(result.reveal.revealState).not.toBe('thin');
    expect(result.reveal.explanation).not.toMatch(/here is what we found/i);
    const view = toHiddenMarketLandingView(result, { nowMs: NOW });
    expect(view.outcome).toBe('empty');
    expect(view.directCards).toEqual([]);
    expect(view.uncoveredCards).toEqual([]);
    expect(view.message).toBe(EMPTY_OPEN_MARKET_MESSAGE);
    expect(view.reveal?.explanation).toBe(EMPTY_OPEN_MARKET_MESSAGE);
    expect(JSON.stringify(view)).not.toMatch(/here is what we found/i);
    expect(JSON.stringify(view)).not.toMatch(/\bMindy found 0\b/);
  });

  it('does not treat relevance-filtered-to-zero as a small market we found', async () => {
    const result = await searchBeginnerHiddenMarket(
      { description: 'I clean office buildings', nowMs: NOW },
      {
        deriveKeywords: async () => deriveOk(['janitorial services']),
        getCoverage: async ({ keyword }) => coverageOk(keyword),
        searchSam: async () => ({
          ok: true,
          count: 1,
          items: [
            item({
              title: 'Dale Carnegie Building a Stronger and More Cohesive Team Training',
              naics: '611430',
              solicitation: 'W911S226QA089',
              link: 'https://sam.gov/workspace/contract/opp/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/view',
            }),
          ],
        }),
      },
    );
    expect(result.direct.items).toEqual([]);
    expect(result.reveal.totalUniqueCount).toBe(0);
    expect(result.reveal.revealState).not.toBe('thin');
    const view = toHiddenMarketLandingView(result, { nowMs: NOW });
    expect(view.outcome).toBe('empty');
    expect(view.message).toBe(EMPTY_OPEN_MARKET_MESSAGE);
    expect(JSON.stringify(view)).not.toMatch(/here is what we found/i);
  });

  it('falls back to cached Award Notices when nothing is open to bid', async () => {
    let awardedCalls = 0;
    const result = await searchBeginnerHiddenMarket(
      { description: 'I do window washing', nowMs: NOW },
      {
        deriveKeywords: async () => deriveEmpty(),
        searchSam: async () => ({ ok: true, count: 0, items: [] }),
        searchAwarded: async ({ keyword }) => {
          awardedCalls += 1;
          expect(keyword.toLowerCase()).toMatch(/window|wash/);
          return {
            ok: true,
            count: 2,
            items: [
              item({
                title: 'Window Washing Services — Main Hospital',
                type: 'Award Notice',
                deadline: '2026-08-12T00:00:00Z',
                solicitation: 'WW-1',
                link: 'https://sam.gov/workspace/contract/opp/11111111111111111111111111111111/view',
                amount: 48000,
              }),
              item({
                title: 'Exterior Window Washing',
                type: 'Award Notice',
                deadline: '2026-07-01T00:00:00Z',
                solicitation: 'WW-2',
                link: 'https://sam.gov/workspace/contract/opp/22222222222222222222222222222222/view',
              }),
            ],
          };
        },
      },
    );
    expect(awardedCalls).toBe(1);
    expect(result.awardedFallback).toBe(true);
    expect(result.direct.items).toEqual([]);
    expect(result.expanded.items).toHaveLength(2);
    const view = toHiddenMarketLandingView(result, { nowMs: NOW });
    expect(view.outcome).toBe('results');
    expect(view.directCards).toEqual([]);
    expect(view.uncoveredCards.length).toBeGreaterThan(0);
    expect(view.uncoveredCards[0]?.title).toMatch(/Window Washing/i);
    expect(view.uncoveredCards[0]?.noticeLabel).toMatch(/already awarded/i);
    expect(view.uncoveredCards[0]?.dueLabel).toBe('Awarded · Aug 12');
    expect(view.reveal?.expandedLabel).toBe('Recently awarded');
    expect(view.reveal?.explanation).toMatch(/recently AWARDED/i); // CHANGED 2026-09-21: the old line said "Nothing matching is open to bid right now" — a market claim from a TITLE-token search;
    expect(view.ctaVariant).toBe('full_market');
    expect(view.message).toBeNull();
  });

  it('does not search Award Notices or BQ task orders when an open listing already matches', async () => {
    let awardedCalls = 0;
    let taskOrderCalls = 0;
    const result = await searchBeginnerHiddenMarket(
      { description: 'I do HVAC', nowMs: NOW },
      {
        deriveKeywords: async () => deriveEmpty(),
        searchSam: async () => ({
          ok: true,
          count: 3,
          items: [
            item({ title: 'HVAC Preventative Maintenance', naics: '238220', solicitation: 'HV-1' }),
            item({ title: 'HVAC Rooftop Replacement', naics: '238220', solicitation: 'HV-2' }),
            item({ title: 'Barracks HVAC Service', naics: '238220', solicitation: 'HV-3' }),
          ],
        }),
        searchAwarded: async () => {
          awardedCalls += 1;
          return { ok: true, count: 0, items: [] };
        },
        searchTaskOrders: async () => {
          taskOrderCalls += 1;
          return { ok: true, count: 0, items: [] };
        },
      },
    );
    expect(awardedCalls).toBe(0);
    expect(taskOrderCalls).toBe(0);
    expect(result.awardedFallback).toBe(false);
    expect(toHiddenMarketLandingView(result, { nowMs: NOW }).outcome).toBe('results');
  });

  it('fills from BigQuery task orders when SAM Award Notices are empty', async () => {
    const result = await searchBeginnerHiddenMarket(
      { description: 'I do window washing', nowMs: NOW },
      {
        deriveKeywords: async () => deriveEmpty(),
        searchSam: async () => ({ ok: true, count: 0, items: [] }),
        searchAwarded: async () => ({ ok: true, count: 0, items: [] }),
        searchTaskOrders: async () => ({
          ok: true,
          count: 1,
          items: [
            item({
              title: 'TASK ORDER FOR WINDOW WASHING AT THE FEDERAL BUILDING',
              type: 'Task Order',
              deadline: '2026-03-11',
              solicitation: '47PE5226F0047',
              link: 'https://www.usaspending.gov/award/CONT_AWD_47PE5226F0047_4732_47PM0725D0002_4732',
              amount: 18420,
              agency: 'GENERAL SERVICES ADMINISTRATION',
            }),
          ],
        }),
      },
    );
    expect(result.awardedFallback).toBe(true);
    const view = toHiddenMarketLandingView(result, { nowMs: NOW });
    expect(view.outcome).toBe('results');
    expect(view.uncoveredCards[0]?.title).toMatch(/WINDOW WASHING/i);
    expect(view.uncoveredCards[0]?.noticeLabel).toBe('Task order — already awarded');
    expect(view.uncoveredCards[0]?.dueLabel).toBe('Awarded · Mar 11');
    expect(view.uncoveredCards[0]?.samUrl).toMatch(/usaspending\.gov\/award\//);
    expect(view.reveal?.expandedLabel).toBe('Recently awarded');
  });

  it('merges BigQuery task orders ahead of SAM Award Notices and dedupes by PIID', async () => {
    const result = await searchBeginnerHiddenMarket(
      { description: 'I do window washing', nowMs: NOW },
      {
        deriveKeywords: async () => deriveEmpty(),
        searchSam: async () => ({ ok: true, count: 0, items: [] }),
        searchAwarded: async () => ({
          ok: true,
          count: 2,
          items: [
            item({
              title: 'Window Washing Services — Main Hospital',
              type: 'Award Notice',
              deadline: '2026-08-12T00:00:00Z',
              solicitation: 'WW-SAM',
              link: 'https://sam.gov/workspace/contract/opp/11111111111111111111111111111111/view',
            }),
            item({
              title: 'Duplicate window washing PIID from SAM',
              type: 'Award Notice',
              deadline: '2026-08-01T00:00:00Z',
              solicitation: '47PE5226F0047',
              link: 'https://sam.gov/workspace/contract/opp/33333333333333333333333333333333/view',
            }),
          ],
        }),
        searchTaskOrders: async () => ({
          ok: true,
          count: 1,
          items: [
            item({
              title: 'TASK ORDER FOR WINDOW WASHING AT THE FEDERAL BUILDING',
              type: 'Task Order',
              deadline: '2026-03-11',
              solicitation: '47PE5226F0047',
              link: 'https://www.usaspending.gov/award/CONT_AWD_47PE5226F0047_4732_47PM0725D0002_4732',
              amount: 18420,
            }),
          ],
        }),
      },
    );
    expect(result.expanded.items.map((row) => row.solicitation)).toEqual([
      '47PE5226F0047',
      'WW-SAM',
    ]);
    expect(result.expanded.items[0]?.type).toBe('Task Order');
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
