import { describe, it, expect } from 'vitest';
import {
  OPEN_MARKET_NO_KEYWORD_HITS_COPY,
  filterMarketToSavedIndustry,
  hasNaicsOrPscMarket,
  keywordIncludeTerms,
  naicsInSavedMarket,
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

describe('saved-industry filter — PSC leak must not send off-NAICS rows', () => {
  const ADAM = ['541511', '541512', '541513', '541519'];
  const textOfRow = (row: { title: string; description?: string; naics: string }) =>
    `${row.title} ${row.description || ''}`;

  it('keeps exact / 5415-group IT rows and drops C-130 / wayfinding', () => {
    const rows = [
      { title: 'Cybersecurity support', naics: '541512' },
      { title: 'C-130 propeller', naics: '336413' },
      { title: 'VA wayfinding signs', naics: '339950' },
      { title: 'Computer facilities', naics: '541513' },
    ];
    const out = filterMarketToSavedIndustry(rows, ADAM, ['AI Governance', 'PAM', 'AI Security', 'Identity'], (r) => r.naics, textOfRow);
    expect(out.droppedOffIndustry).toBe(2);
    expect(out.rows.map((r) => r.naics).sort()).toEqual(['541512', '541513']);
  });

  it('keeps an off-industry row that carries a distinctive keyword', () => {
    const rows = [{ title: 'AI Governance for C-130 program', naics: '336413' }];
    const out = filterMarketToSavedIndustry(rows, ADAM, ['AI Governance'], (r) => r.naics, textOfRow);
    expect(out.droppedOffIndustry).toBe(0);
    expect(out.rows).toHaveLength(1);
  });

  it('541511 (curated exact) is in-market; 541611 is not', () => {
    expect(naicsInSavedMarket('541511', ADAM)).toBe(true);
    expect(naicsInSavedMarket('541611', ADAM)).toBe(false);
  });
});
