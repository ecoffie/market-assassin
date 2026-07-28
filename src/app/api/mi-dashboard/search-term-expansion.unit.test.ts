/**
 * Map search — term-of-art expansion (Eric 2026-07-28). The opportunity map's Open search is a literal
 * substring match against title/description/sow_text; the market-research keyword fix (drones→UAS) did
 * NOT reach it. Now buildSearchOr() ALSO ORs the term's aliases so a map search for "drones" surfaces
 * UAS/UAV/unmanned-aircraft notices — the same termOfArtSynonyms engine, applied to notice-text search.
 * (Code-like terms like "M7" still take the word-boundary regex branch and are NOT expanded.)
 *
 * buildSearchOr has TS-typed arrow params that `new Function` can't eval, so this asserts the source
 * structure (the wiring) + delegates the alias LOGIC to the dedicated term-of-art-expansion tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { termOfArtSynonyms } from '@/lib/market/sector-expansions';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

describe('buildSearchOr wires term-of-art expansion into the map search', () => {
  it('imports and calls termOfArtSynonyms for the search term', () => {
    expect(routeSrc).toContain("import { termOfArtSynonyms } from '@/lib/market/sector-expansions'");
    expect(routeSrc).toContain('termOfArtSynonyms(term)');
  });
  it('ORs the term + its aliases across the full notice corpus', () => {
    // term + aliases, each ILIKE'd across every corpus column.
    expect(routeSrc).toContain('const terms = [term, ...(termOfArtSynonyms(term) || [])]');
    expect(routeSrc).toContain('for (const t of terms) for (const c of cols) clauses.push(`${c}.ilike.%${t}%`)');
    // corpus includes the deep layers.
    expect(routeSrc).toContain("const cols = ['title', 'description', 'sow_text', 'department', 'solicitation_number']");
  });
  it('strips PostgREST metachars from each term/alias (no .or() injection)', () => {
    expect(routeSrc).toContain("const esc = (s: string) => s.replace(/[%,()]/g, ' ').trim()");
    expect(routeSrc).toContain('.filter((t, i, a) => t && a.indexOf(t) === i)'); // dedupe + drop empties
  });
  it('code-like terms take the word-boundary regex branch BEFORE expansion (not expanded)', () => {
    // isCodeLike returns early with imatch — the expansion only applies to the normal-phrase branch.
    expect(routeSrc).toContain('if (isCodeLike) {');
    const codeIdx = routeSrc.indexOf('if (isCodeLike) {');
    const expandIdx = routeSrc.indexOf('termOfArtSynonyms(term)');
    expect(codeIdx, 'code-like branch precedes the expansion').toBeLessThan(expandIdx);
  });
});

describe('the alias source the map now uses (sanity — same engine as app market research)', () => {
  it('drones expands to UAS/UAV aliases; ordinary terms do not', () => {
    const a = termOfArtSynonyms('drones');
    expect(a).toContain('UAS');
    expect(a).toContain('unmanned aircraft');
    expect(termOfArtSynonyms('janitorial')).toBeNull();
  });
});

describe('Recompete + Contacts expand via curated NAICS (search NAMES, not notice text)', () => {
  const recompeteSrc = readFileSync(join(__dirname, '../app/recompete-map/route.ts'), 'utf8');
  const contactsSrc = readFileSync(join(__dirname, '../app/contacts-map/route.ts'), 'utf8');

  it('recompete-map resolves a term-of-art `q` to curated NAICS (only when no explicit naics)', () => {
    expect(recompeteSrc).toContain('termOfArtNaicsCodes');
    expect(recompeteSrc).toContain('if (q && !naics)');
    expect(recompeteSrc).toContain('naics = toaCodes.join(\',\')');
    // and its naics filter now handles a comma-sep list (OR of exact codes).
    expect(recompeteSrc).toContain('const codes = naics.split(\',\')');
    expect(recompeteSrc).toContain('codes.map((c) => `naics_code.eq.${c}`).join(\',\')');
  });

  it('contacts-map (companies) resolves term-of-art search to NAICS AND drops the name-search', () => {
    expect(contactsSrc).toContain('termOfArtNaicsCodes');
    expect(contactsSrc).toContain("if (type === 'companies' && search && !naics)");
    // drops the name search so it doesn't AND away the NAICS matches.
    expect(contactsSrc).toContain('searchCompanies = \'\'');
    // buyers path untouched (a person has no industry axis).
    expect(contactsSrc).toContain('await buyersPins({ bbox, state, search, agency })');
  });
});
