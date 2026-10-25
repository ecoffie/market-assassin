/**
 * A CTA COUNT AND ITS DESTINATION MUST DESCRIBE THE SAME POPULATION.
 *
 * Joseph Boyd (2026-10-25): the daily alert said "Explore 13 recommended" and the map showed 137.
 * lensCount = profile NAICS ∩ lens strands; the link carried only ?strategy=, so the map applied the
 * strands to the whole corpus. #1299's guard (cta-population.unit.test.ts) checked the strands, not
 * the NAICS scope — this file checks the scope.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lensMapHref } from './lens-link';
import { renderTodaysLensEmailBlock } from '@/lib/alerts/todays-lens-email';
import type { TodaysLens } from './todays-lens';

const LENS: TodaysLens = {
  grounded: true, usingFallback: false, totalOpen: 95,
  strands: [
    { key: 'repeat_buyer', label: 'Repeat Buyers', icon: '', count: 40 },
    { key: 'sb_friendly', label: 'SB-Friendly', icon: '', count: 60 },
    { key: 'sources_sought', label: 'Shapeable (Sources Sought)', icon: '', count: 20 },
  ],
  lensStrategy: 'repeat_buyer,sb_friendly,sources_sought',
  lensNaics: ['236220', '238160', '541330'],
  lensCount: 13,
};

const params = (href: string) => new URL(href, 'https://getmindy.ai').searchParams;

describe('lensMapHref carries the exact scope the count used', () => {
  it('strands AND every profile NAICS code', () => {
    const p = params(lensMapHref(LENS));
    expect(p.get('strategy')).toBe('repeat_buyer,sb_friendly,sources_sought');
    expect(p.get('naics')).toBe('236220,238160,541330');
  });
  it('a NAICS family prefix (e.g. 236) is carried as typed — the map matches it as a prefix like the count', () => {
    expect(params(lensMapHref({ ...LENS, lensNaics: ['236', '541512'] })).get('naics')).toBe('236,541512');
  });
  it('no lens strands → the plain map (nothing to scope)', () => {
    expect(lensMapHref({ ...LENS, lensStrategy: '' })).toBe('/opportunity-map');
  });
  it('drops anything that is not a NAICS code', () => {
    expect(params(lensMapHref({ ...LENS, lensNaics: ['541512', 'x&state=VA', ''] })).get('naics')).toBe('541512');
    expect(lensMapHref({ ...LENS, lensNaics: ['541512', 'x&state=VA'] })).not.toContain('state=');
  });
  it('lens with no rows (0) or an unknown count (null) → the market (codes only), matching "Explore this market"', () => {
    for (const lensCount of [0, null]) {
      const p = params(lensMapHref({ ...LENS, lensCount }));
      expect(p.has('strategy')).toBe(false);
      expect(p.get('naics')).toBe('236220,238160,541330');
    }
    const html = renderTodaysLensEmailBlock({ ...LENS, lensCount: 0 }, 'https://getmindy.ai');
    expect(html).toContain('Explore this market');
    expect(html).not.toMatch(/opportunity-map\?[^"]*strategy=/);
  });
  it('is a market link, never a record link', () => {
    const p = params(lensMapHref(LENS, { src: 'alert' }));
    for (const k of ['opp', 'recompete', 'company', 'buyer', 'ss']) expect(p.has(k)).toBe(false);
  });
});

describe('every lens CTA uses it', () => {
  it('daily alert email: the "Explore N recommended" link carries strategy AND the NAICS behind N', () => {
    const html = renderTodaysLensEmailBlock(LENS, 'https://getmindy.ai');
    expect(html).toContain('Explore 13 recommended');
    const href = html.match(/href="(https:\/\/getmindy\.ai\/opportunity-map\?strategy=[^"]+)"/)![1].replace(/&amp;/g, '&');
    const p = params(href);
    expect(p.get('strategy')).toBe(LENS.lensStrategy);
    expect(p.get('naics')).toBe(LENS.lensNaics.join(','));
    expect(p.get('src')).toBe('alert');
  });
  it('the in-app hero takes the server-built link, and the API builds it with lensMapHref', () => {
    const hero = readFileSync(join(process.cwd(), 'src/components/app/panels/TodaysLensHero.tsx'), 'utf8');
    expect(hero).toContain("const mapHref = data.lensHref || '/opportunity-map';");
    expect(hero).not.toMatch(/opportunity-map\?strategy=\$\{/);
    const api = readFileSync(join(process.cwd(), 'src/app/api/app/todays-lens/route.ts'), 'utf8');
    expect(api).toContain('lensHref: lensMapHref(lens)');
  });
  it('computeTodaysLens returns the codes it counted over', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/dashboard/todays-lens.ts'), 'utf8');
    expect(src).toContain('lensNaics: codes,');
  });
});
