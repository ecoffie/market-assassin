/**
 * CUTOVER GUARD — the Maps ecosystem must not link "home" into the legacy /app, and the apex
 * must be owned by exactly one page.
 *
 * Bucket A items 1-2. Both were real: ten Maps surfaces hardcoded `href="/app"` on the logo —
 * the most-clicked element on every page of the new product ejected the user into the old one —
 * and /today hardcoded `canonical → /today` while the root layout claims `/`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAPS_HOME_PATH, MAPS_HOME_URL, MINDY_ORIGIN, MAPS_HOME_IS_APEX } from './maps-home';

const MAPS_SURFACES = [
  'src/app/today/route.ts',
  'src/app/opportunity-map/route.ts',
  'src/app/opportunity-map/pursuits/route.ts',
  'src/app/opportunity-map/saved/route.ts',
  'src/app/opportunity-map/favorites/route.ts',
  'src/app/opportunity-map/proposal/route.ts',
  'src/app/opportunity-map/forecasts/route.ts',
  'src/app/opportunity-map/market/route.ts',
  'src/app/opportunity-map/reports/route.ts',
  'src/app/opportunity-map/vault/route.ts',
];

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
/** Strip comments: these files DOCUMENT the old `href="/app"` while explaining the fix, and
 *  flagging that prose would be a false positive that invites deleting the explanation. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
     .replace(/^([^\n]*?)\/\/.*$/gm, '$1');

describe('maps-home constants', () => {
  it('MAPS_HOME_URL is absolute and built from the origin', () => {
    expect(MAPS_HOME_URL.startsWith(MINDY_ORIGIN)).toBe(true);
    expect(MAPS_HOME_URL).not.toContain('//today');       // no double slash
  });

  it('the apex flag agrees with the path (one edit flips both)', () => {
    expect(MAPS_HOME_IS_APEX).toBe(MAPS_HOME_PATH === '/');
  });

  it('when MAPS_HOME_PATH becomes "/", the URL is the bare apex (no trailing path)', () => {
    // Simulates the cutover edit without performing it.
    const p = '/';
    const url = `${MINDY_ORIGIN}${p === '/' ? '' : p}`;
    expect(url).toBe('https://getmindy.ai');
  });

  it('home never points into the legacy app', () => {
    expect(MAPS_HOME_PATH.startsWith('/app')).toBe(false);
  });
});

describe('no Maps surface links its logo to the legacy /app', () => {
  for (const file of MAPS_SURFACES) {
    it(`${file.split('/').slice(-2).join('/')} uses MAPS_HOME_PATH, not /app`, () => {
      const c = code(read(file));
      expect(c).toContain("from '@/lib/mindy/maps-home'");   // a REAL import, not one buried in the header comment
      expect(c).toContain('${MAPS_HOME_PATH}');
      expect(c).not.toContain('href="/app"');
    });
  }
});

describe('apex canonical ownership', () => {
  it('/today sources canonical + og:url from the shared constant', () => {
    const c = code(read('src/app/today/route.ts'));
    expect(c).toContain('<link rel="canonical" href="${MAPS_HOME_URL}">');
    expect(c).toContain('<meta property="og:url" content="${MAPS_HOME_URL}">');
    expect(c).not.toContain('canonical" href="https://getmindy.ai/today"');  // no hardcoded literal
  });

  it('the root layout still owns "/" while /mindy-landing is the homepage', () => {
    // Pre-flip this is CORRECT. The guard is that /today does not ALSO claim the apex —
    // two pages claiming "https://getmindy.ai" is the regression the flip must not cause.
    const c = code(read('src/app/layout.tsx'));
    expect(c).toContain('canonical: "/"');
    if (!MAPS_HOME_IS_APEX) expect(MAPS_HOME_URL).not.toBe(MINDY_ORIGIN);
  });
});
