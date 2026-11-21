import { describe, it, expect } from 'vitest';
import { buildSearchOr, queryWords, querySegments, rankSearchResults } from './search';

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

describe('buildSearchOr — a long word list ORs every term (was: one literal phrase)', () => {
  it('a 4+ word query ORs each word across the columns (not the literal phrase)', () => {
    const or = buildSearchOr('cyber cloud compliance network server');
    // The OLD bug: `title.ilike.%cyber cloud …%` (the whole phrase). The FIX: each word separately.
    expect(or.split(',')).toContain('title.ilike.%cyber%');
    expect(or.split(',')).toContain('title.ilike.%server%');
    expect(or).not.toContain('%cyber cloud%'); // never the literal-phrase clause
    expect(or).not.toContain('and(');
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

/**
 * Multi-word CONCEPTS (2026-11-07). Any-word OR made "active directory" match 766 open notices,
 * including a building generator job, when the true phrase matched none. These run the generated
 * Postgres regex against real-world text (Postgres \m / \M word boundaries → JS \b).
 */
function clausesFor(q: string, col = 'description'): RegExp[] {
  return buildSearchOr(q)
    .split(/,(?![^(]*\))/)
    .filter((c) => c.startsWith(`${col}.imatch.`))
    .map((c) => new RegExp(c.slice(`${col}.imatch.`.length).replace(/\\[mM]/g, '\\b'), 'i'));
}
const matches = (q: string, text: string) => clausesFor(q).some((re) => re.test(text));

describe('buildSearchOr — a 2–3 word query is a concept, not a word list', () => {
  it('matches the words in order, including one word between or punctuation between', () => {
    expect(matches('active directory', 'Administer Active Directory and Group Policy')).toBe(true);
    expect(matches('fiber optic installation', 'fiber optic cable installation at Bldg 5')).toBe(true);
    expect(matches('nashville tennessee', 'Place of performance: Nashville, Tennessee')).toBe(true);
    expect(matches('risk management framework', 'supports the Risk Management Framework (RMF)')).toBe(true);
  });
  it('does not match the words scattered across a document', () => {
    expect(matches('active directory', 'active duty personnel will use the building directory signage')).toBe(false);
    expect(matches('risk management framework', 'risk of delay; program management; a framework agreement')).toBe(false);
  });
  it('emits no standalone any-word clause for a concept', () => {
    const top = buildSearchOr('active directory').split(/,(?![^(]*\))/);
    expect(top).not.toContain('title.ilike.%active%');
    expect(top).not.toContain('description.ilike.%directory%');
  });
  it('also matches when every word is in the title', () => {
    expect(buildSearchOr('active directory')).toContain('and(title.ilike.%active%,title.ilike.%directory%)');
  });
  it('a 4+ word query is unchanged (any word, then ranked)', () => {
    expect(buildSearchOr('janitorial custodial grounds turf').split(',')).toContain('title.ilike.%turf%');
  });
});

describe('buildSearchOr — acronyms match whole words; ordinary words stay substrings', () => {
  it('lowercase "roof" still finds "roofing" (not an acronym)', () => {
    expect(matches('roof', 'roofing repairs')).toBe(false); // no regex clause at all for "roof"
    expect(buildSearchOr('roof')).toContain('title.ilike.%roof%');
  });
  it('a 3-letter word is whole-word even in lowercase ("dai" ≠ "daily")', () => {
    expect(matches('dai', 'daily status report')).toBe(false);
    expect(matches('dai', 'DAI program support')).toBe(true);
  });
  it('STIG does not match inside "investigation" but matches STIG and STIGs', () => {
    expect(matches('STIG', 'site investigation report')).toBe(false);
    expect(matches('STIG', 'apply DISA STIGs to all servers')).toBe(true);
    expect(matches('STIG', 'STIG compliance')).toBe(true);
  });
});

describe('querySegments + list syntax', () => {
  it('quotes are an exact phrase; commas, semicolons and OR start a new segment', () => {
    expect(querySegments('"active directory", azure; cloud OR vmware')).toEqual([
      { text: 'active directory', phrase: true },
      { text: 'azure', phrase: false },
      { text: 'cloud', phrase: false },
      { text: 'vmware', phrase: false },
    ]);
  });
  it('a quoted phrase searches that literal phrase', () => {
    expect(buildSearchOr('"active directory"')).toContain('title.ilike.%active directory%');
  });
  it('comma-separated concepts are ORed, each kept as a concept', () => {
    const or = buildSearchOr('active directory, azure');
    expect(or).toContain('and(title.ilike.%active%,title.ilike.%directory%)');
    expect(or.split(/,(?![^(]*\))/)).toContain('title.ilike.%azure%');
  });
  it('chat filler is dropped ("Show me SBA opportunities" searches SBA)', () => {
    expect(queryWords('Show me SBA opportunities')).toEqual(['sba']);
  });
  it('every clause is PostgREST-safe: balanced parentheses, no comma inside a regex', () => {
    for (const q of ['active directory', 'risk management framework', 'STIG', 'women\'s health', 'e-learning design', 'a (b), c']) {
      const s = buildSearchOr(q);
      let depth = 0;
      for (const ch of s) { depth += ch === '(' ? 1 : ch === ')' ? -1 : 0; expect(depth).toBeGreaterThanOrEqual(0); }
      expect(depth).toBe(0);
      // A regex value runs to the next comma or ')' — it must never contain '(' itself.
      expect(s).not.toMatch(/\.imatch\.[^,)]*\(/);
    }
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

  it('IDF-weights: a RARE-term match beats a COMMON-term (boilerplate) match at equal coverage', () => {
    // The live 2026-08-02 bug: "48--VALVE,GLOBE" matched the boilerplate half of Andre's
    // query ("cyber"+"compliance") in its body and out-ranked real cloud/server opps.
    // Both rows below match exactly 2 of 5 terms in the BODY — raw coverage can't tell them
    // apart. Rarity weighting must float the distinctive-term row (cloud+server) above the
    // boilerplate-term row (compliance+network).
    const rows = [
      { title: 'Globe valve replacement', description: 'must ensure network compliance' }, // 2 common terms
      { title: 'Data center refresh', description: 'new cloud server migration' },          // 2 rare terms
    ];
    const ranked = rankSearchResults(rows, 'cyber cloud compliance network server');
    expect(ranked[0].title).toBe('Data center refresh');  // rare terms win over boilerplate
  });
});
