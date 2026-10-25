import { describe, it, expect } from 'vitest';
import { todaysLensMapPath } from './todays-lens-link';

const LENS = { lensStrategy: 'repeat_buyer,sb_friendly,sources_sought', lensNaics: ['236220', '541330', '238'], lensCount: 13 };
const params = (path: string) => new URL(path, 'https://getmindy.ai').searchParams;

describe('todaysLensMapPath — the link carries the population its count describes', () => {
  it('carries ALL three strands and EVERY NAICS code the count used', () => {
    const p = params(todaysLensMapPath(LENS, { src: 'alert', sentOn: '2026-10-21' }));
    expect(p.get('strategy')).toBe('repeat_buyer,sb_friendly,sources_sought');
    expect(p.get('naics')).toBe('236220,541330,238');
  });

  it('labels the count and the date it was counted, and the source', () => {
    const p = params(todaysLensMapPath(LENS, { src: 'alert', sentOn: '2026-10-21' }));
    expect(p.get('lens_n')).toBe('13');
    expect(p.get('lens_on')).toBe('2026-10-21');
    expect(p.get('src')).toBe('alert');
  });

  it('exact param order (the map tests and the funnel read this contract)', () => {
    expect(todaysLensMapPath(LENS, { src: 'alert', sentOn: '2026-10-21' })).toBe(
      '/opportunity-map?strategy=repeat_buyer%2Csb_friendly%2Csources_sought&naics=236220%2C541330%2C238&lens_n=13&lens_on=2026-10-21&src=alert',
    );
  });

  it('the default codes travel too (a profile with no NAICS is counted on FALLBACK_NAICS)', () => {
    const fallback = ['541512', '541611', '541330', '541990', '561210'];
    const p = params(todaysLensMapPath({ ...LENS, lensNaics: fallback }, { src: 'todays_intel' }));
    expect(p.get('naics')).toBe(fallback.join(','));
  });

  it('in-app hero: src=todays_intel, no lens_on (it is not a dated send)', () => {
    const p = params(todaysLensMapPath(LENS, { src: 'todays_intel' }));
    expect(p.get('src')).toBe('todays_intel');
    expect(p.has('lens_on')).toBe(false);
  });

  it('an unknown count (null) is omitted, never written as 0', () => {
    const p = params(todaysLensMapPath({ ...LENS, lensCount: null }, { src: 'alert' }));
    expect(p.has('lens_n')).toBe(false);
  });

  it('a real 0 is kept (an honest empty is not unknown)', () => {
    expect(params(todaysLensMapPath({ ...LENS, lensCount: 0 }, { src: 'alert' })).get('lens_n')).toBe('0');
  });

  it('junk codes, strands and dates are dropped, duplicates collapsed', () => {
    const p = params(todaysLensMapPath(
      { lensStrategy: 'repeat_buyer,DROP TABLE,sb_friendly', lensNaics: ['236220', 'abc', '1', '236220', '2362201'], lensCount: 5 },
      { src: 'alert', sentOn: 'yesterday' },
    ));
    expect(p.get('strategy')).toBe('repeat_buyer,sb_friendly');
    expect(p.get('naics')).toBe('236220');
    expect(p.has('lens_on')).toBe(false);
  });

  it('no strands → the plain map (nothing to scope; never a half-built lens)', () => {
    expect(todaysLensMapPath({ lensStrategy: '', lensNaics: ['236220'], lensCount: 3 }, { src: 'alert' }))
      .toBe('/opportunity-map?src=alert');
  });
});
