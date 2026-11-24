/**
 * Map "says N results but the pins/list don't match my filters" (customer, 2026-11-23).
 *
 * Reproduced on production 2026-11-23: /api/app/opportunity-map?...&sources=sam,sbir
 *   &setAside=SDVOSBC,SBA&naics=541512,541519,541611&psc=D399,R408
 * returned totalForFilters=25 with countsBySource {SAM:0, DLA:0, SBIR:25} — every "match" was an SBIR
 * topic with set 'None' and naics '' that ignored all three filters. The rail showed SBIR cards with
 * "Set-aside: Not stated" and a blank NAICS under an SDVOSB + NAICS search.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sbirExcludingFilters } from './sbir-open-filters';

const routeSrc = readFileSync(join(__dirname, '../../app/api/app/opportunity-map/route.ts'), 'utf8');
const getter = (q: string) => { const u = new URLSearchParams(q); return (k: string) => u.get(k); };

describe('sbirExcludingFilters — filters an SBIR topic can never satisfy', () => {
  it('no narrowing filters → SBIR stays in the Open union', () => {
    expect(sbirExcludingFilters(getter('status=active&sources=sam,sbir&bbox=1,2,3,4'))).toEqual([]);
    expect(sbirExcludingFilters(getter('setAside=&naics=,&psc='))).toEqual([]);
  });

  it('the customer case (set-aside + NAICS + PSC) excludes SBIR', () => {
    expect(sbirExcludingFilters(getter('setAside=SDVOSBC,SBA&naics=541512,541519&psc=D399'))).toEqual(['setAside', 'naics', 'psc']);
  });

  it('each code filter alone excludes SBIR', () => {
    expect(sbirExcludingFilters(getter('setAside=SDVOSBC'))).toEqual(['setAside']);
    expect(sbirExcludingFilters(getter('naics=561210'))).toEqual(['naics']);
    expect(sbirExcludingFilters(getter('psc=R408'))).toEqual(['psc']);
    expect(sbirExcludingFilters(getter('fullOpen=1'))).toEqual(['fullOpen']);
  });

  it('a SAM notice-type filter excludes SBIR, an explicit SBIR/STTR type does not', () => {
    expect(sbirExcludingFilters(getter('noticeType=Solicitation'))).toEqual(['noticeType']);
    expect(sbirExcludingFilters(getter('noticeType=Solicitation,SBIR'))).toEqual([]);
  });

  it('scope=profile excludes SBIR only when a profile actually resolved NAICS', () => {
    expect(sbirExcludingFilters(getter('scope=profile'))).toEqual([]);
    expect(sbirExcludingFilters(getter('scope=profile'), { profileNaics: [] })).toEqual([]);
    expect(sbirExcludingFilters(getter('scope=profile'), { profileNaics: ['541512'] })).toEqual(['profile']);
  });
});

describe('call site — the Open map route gates the SBIR layer on it', () => {
  it('imports the helper and skips SBIR pins (and so their count) when a filter excludes them', () => {
    expect(routeSrc).toContain("import { sbirExcludingFilters } from '@/lib/sbir/sbir-open-filters';");
    expect(routeSrc).toMatch(
      /if \(wantSbirSources\(p\.get\('sources'\)\) && sbirExcludingFilters\(\(k\) => p\.get\(k\), \{ profileNaics \}\)\.length === 0\)/,
    );
    // The headline and in-view totals are built from sbirPins, so an excluded layer adds nothing.
    expect(routeSrc).toMatch(/samTotal \+ \(dlaTotal \|\| dlaPins\.length\) \+ sbirPins\.length/);
  });
});
