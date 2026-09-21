/**
 * THE REGRESSION (2026-08-14, live on prod): every company card on the Network map opened a
 * drawer reading "Network hiccup — try opening it again." The API was fine — HTTP 200,
 * success:true, a full company object. The failure was a pure RENDER bug wearing a network
 * error's clothes:
 *
 *   companyScaleTier() is defined in VIEWPORT_JS; companyHead()/companyScaleMethodology()
 *   call it from DRAWER_JS — a SEPARATE <script> IIFE that cannot see that closure. So
 *   companyHead threw `ReferenceError: companyScaleTier is not defined` INSIDE the fetch
 *   .then(), the drawer's outer .catch() swallowed it, and drawerLoadError(0) printed the
 *   status-0 copy ("Network hiccup") — the one branch that means "the fetch itself rejected."
 *
 * Why the existing tests missed it: network-drawer-dispatch.unit.test.ts asserts DISPATCH
 * (was the request made), and every assertion there still passed — the request WAS made and
 * did return 200. Nothing exercised the render that consumes the response. So this test runs
 * the SHIPPED renderer against a real-shaped payload and asserts it produces markup, which is
 * the only thing that would have gone red.
 *
 * Guard: cross-<script>-block scope. The card chip (companyScaleTierChip, same VIEWPORT_JS
 * scope) rendered "Top tier" perfectly the whole time — list and drawer live in different
 * scopes, so a working list proves nothing about the drawer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

/** Same de-escaping the sibling drawer tests use: `\\uXXXX` in TS source is `\uXXXX` on the wire. */
function deEscape(s: string): string { return s.replace(/\\\\/g, '\\'); }

/** Extract a `function <name>(...){...}` body from route.ts by brace matching. */
function extractFn(name: string): string {
  const start = routeSrc.indexOf(`function ${name}(`);
  expect(start, `function ${name} must exist in route.ts`).toBeGreaterThan(-1);
  const open = routeSrc.indexOf('{', routeSrc.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < routeSrc.length; i++) {
    if (routeSrc[i] === '{') depth++;
    else if (routeSrc[i] === '}') { depth--; if (depth === 0) return deEscape(routeSrc.slice(start, i + 1)); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

/** The real shape /api/app/company-detail returns (captured live from prod for IMPRES). */
const COMPANY = {
  uei: 'MSSQQ551LG41',
  name: 'IMPRES TECHNOLOGY SOLUTIONS, INC',
  city: 'ROUND ROCK',
  state: 'TX',
  totalObligated: 480303482.31,
  awardCount: 1839,
  distinctAgencyCount: 31,
  distinctNaicsCount: 12,
  setAsides: [],
};

describe('company drawer: companyScaleTier must be reachable from DRAWER_JS', () => {
  it('is bridged onto window in VIEWPORT_JS', () => {
    // The fix. Without this line the drawer's call resolves to nothing and throws at runtime.
    expect(
      /window\.companyScaleTier\s*=\s*companyScaleTier/.test(routeSrc),
      'companyScaleTier must be bridged onto window — DRAWER_JS is a separate <script> IIFE',
    ).toBe(true);
  });

  it('every DRAWER_JS call site goes through the window bridge', () => {
    // A bare `companyScaleTier(` inside the drawer block is exactly the shipped bug. Bound the
    // scan to DRAWER_JS so the VIEWPORT_JS definition and its in-scope callers do not match.
    const drawerStart = routeSrc.indexOf('const DRAWER_JS');
    expect(drawerStart, 'DRAWER_JS must exist').toBeGreaterThan(-1);
    const drawerSrc = routeSrc.slice(drawerStart);
    const bare = drawerSrc
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*)/.test(l))            // strip comments — several now QUOTE the bug
      .filter((l) => /(?<!window\.)(?<![\w$.])companyScaleTier\s*\(/.test(l));
    expect(bare, `unbridged companyScaleTier call(s) in DRAWER_JS:\n${bare.join('\n')}`).toEqual([]);
  });

  it('companyScaleMethodology RENDERS instead of throwing (the swallowed ReferenceError)', () => {
    // Run the SHIPPED function with only the window bridge in scope — exactly what the drawer
    // has at runtime. Pre-fix this threw ReferenceError and the drawer printed "Network hiccup".
    const factory = new Function(
      'window', 'esc',
      `${extractFn('companyScaleMethodology')}; return companyScaleMethodology;`,
    );
    const tierFn = (v: number) => (Number(v) || 0) <= 0 ? '' : (v >= 1e8 ? 'Top tier' : (v >= 1e7 ? 'Mid' : 'Emerging'));
    const render = factory({ companyScaleTier: tierFn }, (s: string) => String(s));

    expect(() => render(COMPANY)).not.toThrow();
    const html = render(COMPANY);
    expect(html, 'a $480M firm must get the M-Scale block').toContain('M-Scale');
  });

  it('honest miss: a firm with no obligated dollars renders NO tier (never a fabricated one)', () => {
    const factory = new Function(
      'window', 'esc',
      `${extractFn('companyScaleMethodology')}; return companyScaleMethodology;`,
    );
    const tierFn = (v: number) => (Number(v) || 0) <= 0 ? '' : (v >= 1e8 ? 'Top tier' : (v >= 1e7 ? 'Mid' : 'Emerging'));
    const render = factory({ companyScaleTier: tierFn }, (s: string) => String(s));

    expect(render({ ...COMPANY, totalObligated: 0 })).toBe('');
  });
});
