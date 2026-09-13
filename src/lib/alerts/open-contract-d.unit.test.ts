import { describe, it, expect } from 'vitest';
import {
  OPEN_MARKET_NO_KEYWORD_HITS_COPY,
  hasNaicsOrPscMarket,
  keywordIncludeTerms,
  openMarketNote,
  preferDistinctiveInOpenMarket,
  scoreContractDKeywords,
} from './open-contract-d';

const LWP_KEYWORDS = [
  'property maintenance',
  'building maintenance',
  'carpentry',
  'general contractor',
  'handyman services',
  'painting',
  'flooring',
  'drywall',
  'facility management',
  'installation',
  'assembly',
  'repair',
  'delivery',
  'grounds maintenance',
  'janitorial',
  'minor construction',
  'emergency service',
  'facility support',
];

const textOf = (row: { title: string; description?: string }) => `${row.title} ${row.description || ''}`;

describe('Contract D — Open SAM keyword include', () => {
  it('does not put generic singles or any keyword into the market query when NAICS exist', () => {
    expect(hasNaicsOrPscMarket(['561720'], [])).toBe(true);
    expect(keywordIncludeTerms(LWP_KEYWORDS, ['561720'], [])).toEqual([]);
    expect(keywordIncludeTerms(['repair', 'janitorial'], ['561210'], [])).toEqual([]);
  });

  it('keyword-only profiles include distinctive terms and drop generic singles', () => {
    expect(keywordIncludeTerms(['janitorial', 'repair', 'delivery'], [], [])).toEqual(['janitorial']);
  });
});

describe('Contract D — distinctive prefer does not treat empty-keyword as empty-Open', () => {
  const market = [
    { title: '1ST QTR FY27- MILK - FDC Houston', description: 'delivery of milk' },
    { title: 'OEC 3D C-Arm Repair', description: 'medical equipment repair' },
    { title: 'Central Great Plains Janitorial Services', description: 'janitorial' },
    { title: 'Western Oregon Service Unit Grounds Maintenance', description: 'grounds maintenance' },
  ];

  it('LWP-style keywords prefer janitorial/grounds and drop milk/DLA repair', () => {
    const out = preferDistinctiveInOpenMarket(market, LWP_KEYWORDS, textOf);
    expect(out.outcome).toBe('distinctive_hits');
    expect(out.distinctiveMatchCount).toBe(2);
    expect(out.rows.map((r) => r.title)).toEqual([
      'Central Great Plains Janitorial Services',
      'Western Oregon Service Unit Grounds Maintenance',
    ]);
    expect(out.rows.some((r) => /milk|c-arm/i.test(r.title))).toBe(false);
  });

  it('zero distinctive hits still returns the Open NAICS set and does not mention recompetes', () => {
    const naicsOnly = [
      { title: 'Facilities Support IDIQ', description: 'base operations' },
      { title: 'Custodial option year', description: 'housekeeping' },
    ];
    const out = preferDistinctiveInOpenMarket(naicsOnly, ['carpentry'], textOf);
    expect(out.outcome).toBe('open_market_no_keyword_hits');
    expect(out.distinctiveMatchCount).toBe(0);
    expect(out.rows).toEqual(naicsOnly);
    const note = openMarketNote(out.outcome);
    expect(note).toBe(OPEN_MARKET_NO_KEYWORD_HITS_COPY);
    expect(note).not.toMatch(/recompete/i);
  });

  it('empty Open market is empty_open_market, not a keyword miss', () => {
    const out = preferDistinctiveInOpenMarket([], LWP_KEYWORDS, textOf);
    expect(out.outcome).toBe('empty_open_market');
    expect(out.rows).toEqual([]);
    expect(openMarketNote(out.outcome)).toBeNull();
  });

  it('generic-only keywords still send the Open market and say so', () => {
    const marketRows = [{ title: 'Elevator modernization', description: 'repair and installation' }];
    const out = preferDistinctiveInOpenMarket(marketRows, ['repair', 'installation', 'delivery'], textOf);
    expect(out.outcome).toBe('open_market_no_keyword_hits');
    expect(out.rows).toEqual(marketRows);
  });
});

describe('Contract D — scoring', () => {
  it('a distinctive janitorial hit outranks a generic repair hit', () => {
    const janitorial = scoreContractDKeywords('Central Great Plains Janitorial Services', LWP_KEYWORDS);
    const repairOnly = scoreContractDKeywords('OEC 3D C-Arm Repair', LWP_KEYWORDS);
    expect(janitorial).toBe(25);
    expect(repairOnly).toBe(2);
    expect(janitorial).toBeGreaterThan(repairOnly);
  });
});
