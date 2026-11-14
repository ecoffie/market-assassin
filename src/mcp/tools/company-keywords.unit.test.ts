import { describe, it, expect, vi } from 'vitest';

// The input-only path calls embedText via deriveSemanticKeywords: make it fail soft (lexical
// order) so the test never reaches the network. embedTexts is passed as an injected fake.
vi.mock('@/lib/market/embeddings', async (orig) => {
  const real = await orig<typeof import('@/lib/market/embeddings')>();
  return { ...real, embedText: vi.fn(async () => { throw new Error('offline'); }), embedTexts: vi.fn(async () => { throw new Error('offline'); }) };
});

import { deriveCompanyKeywords, type CompanyKeywordsDeps } from './company-keywords';

/** Deterministic "embedding": character-trigram counts hashed into 128 dims (lexical overlap). */
function fakeVec(text: string): number[] {
  const v = new Array(128).fill(0);
  const t = ` ${text.toLowerCase()} `;
  for (let i = 0; i < t.length - 2; i++) {
    let h = 0;
    for (const ch of t.slice(i, i + 3)) h = (h * 31 + ch.charCodeAt(0)) % 128;
    v[h] += 1;
  }
  return v;
}

const DESC = 'Superb Staffing is a light industrial, clerical and warehouse staffing firm in Memphis';

function deps(over: Partial<CompanyKeywordsDeps> = {}): Partial<CompanyKeywordsDeps> {
  return {
    embed: async (texts) => texts.map(fakeVec),
    codesForTerm: async (t) => (t === 'warehouse' ? [{ code: '493110', weight: 100 }] : t === 'staffing' ? [{ code: '561320', weight: 90 }] : []),
    getVocabulary: async (c) =>
      c === '493110'
        ? [{ term: 'warehouse services', kind: 'bigram', weight: 10, df: 13 }, { term: 'memphis depot', kind: 'bigram', weight: 9, df: 3 }]
        : [{ term: 'staffing services', kind: 'bigram', weight: 10, df: 31 }],
    calcTitles: async (w) =>
      w === 'warehouse' ? [{ title: 'warehouse worker', n: 12 }, { title: 'warehouse specialist', n: 187 }]
        : w === 'clerical' ? [{ title: 'general clerk', n: 19 }] : [],
    solicitationTexts: async () => [
      { id: 'n1', text: 'Warehouse staffing: material handlers and forklift operators; clerical support.' },
      { id: 'n2', text: 'Clerical and warehouse labor. The material handler and forklift operator shall...' },
    ],
    ...over,
  };
}

describe('derive_company_keywords — grounded path (R6)', () => {
  it('never returns the city or the brand word, and keeps the capability word in the brand', async () => {
    const r = await deriveCompanyKeywords({ description: DESC, brand_exclude: ['Superb Staffing'], include_market_terms: true }, deps());
    expect(r.keywords.length).toBeGreaterThan(0);
    for (const k of r.keywords) {
      expect(k).not.toMatch(/memphis/);
      expect(k).not.toMatch(/superb/);
    }
    expect(r.excluded_terms).toEqual({ locations: ['memphis'], brand: ['superb'] });
    // "memphis depot" came from a market source and is still blocked.
    expect(r.keyword_sources!.some((k) => k.keyword.includes('memphis'))).toBe(false);
    expect(r.keywords.some((k) => k.includes('staffing'))).toBe(true);
  });

  it('surfaces occupational titles from CALC and solicitation text, each with a named source', async () => {
    // Flat embedding: every candidate equally relevant, so this test checks provenance, not ranking.
    const r = await deriveCompanyKeywords(
      { description: DESC, brand_exclude: ['Superb Staffing'], include_market_terms: true, limit: 25 },
      deps({ embed: async (texts) => texts.map(() => [1, 0, 0]) }),
    );
    const occ = r.occupational_titles!.map((o) => o.keyword);
    expect(occ).toEqual(expect.arrayContaining(['material handler', 'forklift operator', 'warehouse worker', 'general clerk']));
    for (const k of r.keyword_sources!) {
      expect(k.sources.length).toBeGreaterThan(0);
      for (const s of k.sources) expect(['input_text', 'market_vocabulary', 'calc_labor_category', 'solicitation_text']).toContain(s.type);
    }
    const mh = r.occupational_titles!.find((o) => o.keyword === 'material handler')!;
    expect(mh.sources[0]).toMatchObject({ type: 'solicitation_text', n: 2 });
    expect(r.naics_used!.map((n) => n.code).sort()).toEqual(['493110', '561320']);
    expect(r.keyword_sources!.map((k) => k.keyword)).toEqual(r.keywords);
  });

  it('reports a failed source as error, not as none', async () => {
    const r = await deriveCompanyKeywords(
      { description: DESC, include_market_terms: true },
      deps({ calcTitles: async () => null, solicitationTexts: async () => null }),
    );
    expect(r._meta.source_status).toMatchObject({ calc_labor_category: 'error', solicitation_text: 'error', market_vocabulary: 'ok' });
    expect(r._meta.grounded).toBe(true);
  });

  it('uses the caller NAICS when given', async () => {
    const seen: string[] = [];
    await deriveCompanyKeywords(
      { description: DESC, naics: ['561320'], include_market_terms: true },
      deps({ getVocabulary: async (c) => { seen.push(c); return []; } }),
    );
    expect(seen).toEqual(['561320']);
  });

  it('falls back to lexical order (ranked=false) when embeddings fail, still with sources', async () => {
    const r = await deriveCompanyKeywords(
      { description: DESC, include_market_terms: true },
      deps({ embed: async () => { throw new Error('down'); } }),
    );
    expect(r._meta.ranked).toBe(false);
    expect(r.keywords.length).toBeGreaterThan(0);
    expect(r.keywords.some((k) => k.includes('memphis'))).toBe(false);
  });
});

describe('derive_company_keywords — input-only path (library callers)', () => {
  it('strips the city and only brand-distinctive words; sources are input_text', async () => {
    const r = await deriveCompanyKeywords({ description: DESC, brand_exclude: ['Superb Staffing'] });
    expect(r.keywords.length).toBeGreaterThan(0);
    for (const k of r.keywords) {
      expect(k).not.toMatch(/memphis|superb/);
    }
    expect(r.keywords.some((k) => k.includes('staffing'))).toBe(true);
    expect(r.keyword_sources!.every((k) => k.sources[0].type === 'input_text')).toBe(true);
    expect(r.occupational_titles).toBeUndefined();
  });
});
