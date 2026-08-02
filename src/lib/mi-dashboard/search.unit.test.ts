import { describe, it, expect } from 'vitest';
import { buildSearchOr, queryWords, rankSearchResults } from './search';

/**
 * The multi-word search fix (Andre @ CypherIntel, 2026-08-02): a query like
 * "cyber cloud compliance network server" used to match the WHOLE phrase as one
 * literal substring → 0 results. The industry standard (Google / Postgres FTS /
 * Elasticsearch) is: tokenize → OR each term → RANK by relevance. These pin that.
 */

describe('queryWords — tokenize a free-text query', () => {
  it('single word → that word (single-term search unchanged)', () => {
    expect(queryWords('cybersecurity')).toEqual(['cybersecurity']);
  });
  it('splits multi-word on whitespace + commas', () => {
    expect(queryWords('cyber, cloud, compliance network server')).toEqual(['cyber', 'cloud', 'compliance', 'network', 'server']);
  });
  it('drops stop-words + GovCon filler + tiny tokens', () => {
    // "the/for/services/requirements" are noise; "it" is <2… kept? "it" is 2 chars, not a stop-word here.
    expect(queryWords('opportunities for cloud services and compliance requirements')).toEqual(['cloud', 'compliance']);
  });
  it('dedupes + caps at 8', () => {
    // 10 distinct 2+char words; deduped-then-capped at 8.
    expect(queryWords('aa aa bb bb cc dd ee ff gg hh ii jj')).toHaveLength(8);
  });
});

describe('buildSearchOr — multi-word ORs every term (was: one literal phrase)', () => {
  it('a multi-word query ORs each word across the columns (not the literal phrase)', () => {
    const or = buildSearchOr('cyber cloud');
    // The OLD bug: `title.ilike.%cyber cloud%` (the whole phrase). The FIX: each word separately.
    expect(or).toContain('title.ilike.%cyber%');
    expect(or).toContain('title.ilike.%cloud%');
    expect(or).not.toContain('%cyber cloud%'); // never the literal-phrase clause
  });
  it('a single word still searches that word across the columns', () => {
    const or = buildSearchOr('roofing');
    expect(or).toContain('title.ilike.%roofing%');
    expect(or).toContain('description.ilike.%roofing%');
  });
  it('a code-like term keeps word-boundary matching (M7 ≠ M776)', () => {
    const or = buildSearchOr('R408');
    expect(or).toContain('imatch'); // regex path, not ILIKE
    expect(or).toContain('R'); // the code token is present
  });
});

describe('rankSearchResults — multi-term matches rank above single-term noise', () => {
  const rows = [
    { title: 'Base valve replacement', description: 'server room valve' },                  // 1 term (server)
    { title: 'Cyber cloud compliance network server support', description: '' },              // 5 terms in TITLE
    { title: 'Network engineering', description: 'cloud migration and compliance review' },   // 3 terms
  ];
  it('sorts the most-relevant (title, multi-term) first; noise sinks', () => {
    const ranked = rankSearchResults(rows, 'cyber cloud compliance network server');
    expect(ranked[0].title).toBe('Cyber cloud compliance network server support');
    expect(ranked[ranked.length - 1].title).toBe('Base valve replacement');
  });
  it('single-word search is a no-op (keeps fetch/freshness order)', () => {
    const ranked = rankSearchResults(rows, 'server');
    expect(ranked).toEqual(rows);
  });
  it('a title match outweighs a body match for the same term count', () => {
    const two = [
      { title: 'unrelated', description: 'cyber cloud' },  // 2 terms in body
      { title: 'cyber cloud', description: 'unrelated' },  // 2 terms in title
    ];
    const ranked = rankSearchResults(two, 'cyber cloud');
    expect(ranked[0].title).toBe('cyber cloud'); // title wins
  });
});
