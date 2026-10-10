/**
 * Mindy Learn navigation (Learn PR C, 2026-10-10): ONE "Learn" item in the existing chrome — no new nav
 * system. Desktop right cluster on every Maps page, /today and the shared public header; the Map's mobile
 * drawer; "Your Action Plan" in the account menu. All point at the existing /learn.
 *
 * ORDER IS LOAD-BEARING: Bid with confidence · Learn · Pricing. At <=1000px every header hides the FIRST
 * right-cluster link (`.zh-right a:first-child` / `.mp-head-right>a:first-child`); Learn must not be it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MP_HEADER_ACCOUNT_LINKS } from '@/lib/public-site/chrome';
import { ACCOUNT_MENU_HTML } from './account-menu';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const SUBPAGES = ['favorites', 'forecasts', 'market', 'proposal', 'pursuits', 'reports', 'saved', 'vault']
  .map((p) => `src/app/opportunity-map/${p}/route.ts`);

describe('desktop: Learn in the right cluster, second', () => {
  it('the Map', () => {
    const s = read('src/app/opportunity-map/route.ts');
    expect(s).toMatch(/'<a href="\/bid">Bid with confidence<\/a>'\n(?:\s*\/\/[^\n]*\n)*\s*\+ '<a href="\/learn">Learn<\/a>'\n\s*\+ '<a href="\/pricing">Pricing<\/a>'/);
  });
  it.each([...SUBPAGES, 'src/app/today/route.ts'])('%s', (p) => {
    expect(read(p)).toContain('<a href="/bid">Bid with confidence</a>\n    <a href="/learn">Learn</a>\n    <a href="/pricing">Pricing</a>');
  });
  it('the shared public header (/learn, /bid, /gov, React public pages)', () => {
    expect(MP_HEADER_ACCOUNT_LINKS.map((l) => l.href)).toEqual(['/bid', '/learn', '/pricing']);
    expect(MP_HEADER_ACCOUNT_LINKS[1].label).toBe('Learn');
  });
  it('exactly one Learn item per header (no duplicate entry points)', () => {
    for (const p of ['src/app/opportunity-map/route.ts', ...SUBPAGES, 'src/app/today/route.ts']) {
      const s = read(p);
      const desktop = (s.match(/<a href="\/learn">Learn<\/a>/g) || []).length;
      expect(desktop, p).toBe(1);
    }
  });
});

describe('mobile', () => {
  it('the Map drawer has Learn next to Pricing / Bid with confidence', () => {
    const s = read('src/app/opportunity-map/route.ts');
    expect(s).toMatch(/<a href="\/learn"><svg[^']*<\/svg>Learn<\/a>'\n\s*\+\s+'<a href="\/pricing"><svg/);
  });
});

describe('account menu', () => {
  it('"Your Action Plan" points at /learn', () => {
    expect(ACCOUNT_MENU_HTML).toMatch(/<a href="\/learn" role="menuitem"><svg[^>]*>[\s\S]*?<\/svg>Your Action Plan<\/a>/);
  });
});
