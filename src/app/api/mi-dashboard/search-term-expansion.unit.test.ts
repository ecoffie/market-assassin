/**
 * Opportunity search — term-of-art expansion, in the SHARED buildSearchOr (Eric 2026-07-28). A search
 * for "drones" also ORs UAS/UAV/unmanned-aircraft so notices the literal word misses still surface.
 *
 * CRITICAL: this must live in the SHARED lib (@/lib/mi-dashboard/search), because BOTH the app's
 * mi-dashboard route AND the OPPORTUNITY MAP's Open endpoint (via map-filters.ts) call it — plus the
 * saved-search cron. The fix first shipped in a DUPLICATE copy inside the route, so the map never got
 * it; this test locks the expansion into the shared function and asserts every surface uses that one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSearchOr } from '@/lib/mi-dashboard/search';
import { termOfArtSynonyms } from '@/lib/market/sector-expansions';

describe('buildSearchOr (shared) — term-of-art expansion, actually executed', () => {
  it('a plain non-term-of-art keyword matches the full corpus, unexpanded', () => {
    const or = buildSearchOr('janitorial');
    expect(or).toContain('title.ilike.%janitorial%');
    expect(or).toContain('sow_text.ilike.%janitorial%');
    expect(or).not.toContain('UAS');
  });
  it('"drones" ALSO ORs its aliases across the corpus (surfaces UAS/UAV notices)', () => {
    const or = buildSearchOr('drones');
    expect(or).toContain('title.ilike.%drones%');
    expect(or).toContain('title.ilike.%unmanned aircraft%');
    expect(or).toContain('description.ilike.%UAS%');
    expect(or).toContain('sow_text.ilike.%UAV%');
  });
  it('code-like terms (M7) take the word-boundary regex branch, NOT expanded', () => {
    const or = buildSearchOr('M7');
    expect(or).toContain('imatch');
    expect(or).not.toContain('ilike.%M7%');
  });
  it('metachars in a term are stripped (no .or() injection)', () => {
    const or = buildSearchOr('a(b)c');
    expect(or).not.toContain('(');
    expect(or).not.toContain(')');
  });
});

describe('ONE shared implementation — app route, map endpoint, and saved-search cron agree', () => {
  const root = join(__dirname, '../../..');
  const route = readFileSync(join(root, 'app/api/mi-dashboard/route.ts'), 'utf8');
  const mapFilters = readFileSync(join(root, 'lib/opportunities/map-filters.ts'), 'utf8');

  it('the mi-dashboard route IMPORTS the shared buildSearchOr (no local duplicate)', () => {
    // The import names buildSearchOr from the shared module (may also import the
    // ranking helpers rankSearchResults/queryWords on the same line — 2026-08-02).
    expect(route).toMatch(/import\s*\{[^}]*\bbuildSearchOr\b[^}]*\}\s*from\s*'@\/lib\/mi-dashboard\/search'/);
    // the old in-route duplicate is gone (only the import + the call remain, not a definition).
    expect(route).not.toContain('function buildSearchOr(search: string): string {');
  });
  it('the opportunity-map filter path uses the SAME shared buildSearchOr', () => {
    expect(mapFilters).toContain("import { buildSearchOr } from '@/lib/mi-dashboard/search'");
    expect(mapFilters).toContain('buildSearchOr(f.search)');
  });

  it('sanity — the alias source is the shared term-of-art engine', () => {
    expect(termOfArtSynonyms('drones')).toContain('UAS');
    expect(termOfArtSynonyms('janitorial')).toBeNull();
  });
});
