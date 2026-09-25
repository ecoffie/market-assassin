/**
 * Maps first load (2026-09-25) — Building your market must not wait for the Maps JavaScript it covers,
 * and the full page must not ship the embed's placeholder list.
 *
 * Measured with native arm64 Chrome (tasks/maps-first-load-investigation-2026-09-25.md): the overlay was
 * revealed by a parse-time setTimeout, which cannot fire while the parser runs the page's inline scripts, so
 * it appeared 0.4–1.4 s after first paint; and an unused 600-row placeholder list was rendered, re-rendered,
 * cleared and redrawn BEFORE the first discovery request went out.
 *
 * Contract pinned here:
 *  1. The overlay is in the server HTML with `.app` already `mfb-booting`, and NO script reveals it — a
 *     compositor CSS animation does, after BOOT_REVEAL. Visible is its static state (reduced motion → shown).
 *  2. The full page ships `let OPPS = []` and never queries the 600 rows; `?embed=` keeps them.
 *  3. The sweep animates `transform`, never `background-position`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { MARKET_BOOT_HTML, MARKET_BOOT_APP_OPEN, MARKET_FEEDBACK_CSS, MF_TIMING } from './market-feedback';

const ROWS = [{ id: 'n1', naics: '541512', cat: 'IT', title: 'EMBED-ROW-ONE', agency: 'ARMY', set: 'SB', loc: 'VA', close: '2099-01-01', sol: 'W1', uiLink: '', lat: 38, lng: -77, locSrc: 'pop' }];
const getMapOpportunities = vi.fn(async () => ROWS);
vi.mock('@/lib/opportunities/map-data', async (orig) => ({
  ...(await orig<typeof import('@/lib/opportunities/map-data')>()),
  getMapOpportunities: (n: number) => getMapOpportunities(n),
}));

async function get(qs: string): Promise<string> {
  const { GET } = await import('./route');
  const res = await GET(new NextRequest(`https://getmindy.ai/opportunity-map${qs}`));
  expect(res.status).toBe(200);
  return res.text();
}
const oppsLiteral = (html: string) => (html.match(/let OPPS = (\[.*?\]);\n/s) || [])[1];

beforeEach(() => { getMapOpportunities.mockClear(); });

describe('placeholder list: embed only', () => {
  it('the full page ships an EMPTY OPPS and never queries the 600 placeholder rows', async () => {
    const html = await get('');
    expect(oppsLiteral(html)).toBe('[]');
    expect(html).not.toContain('EMBED-ROW-ONE');
    expect(getMapOpportunities).not.toHaveBeenCalled();
  });
  it('a restored / deep-linked full page is the same (the query is the client\'s job)', async () => {
    expect(oppsLiteral(await get('?q=cybersecurity'))).toBe('[]');
    expect(getMapOpportunities).not.toHaveBeenCalled();
  });
  it('?embed= keeps the rows — they are its entire content', async () => {
    const html = await get('?embed=1');
    expect(getMapOpportunities).toHaveBeenCalledWith(600);
    expect(oppsLiteral(html)).toContain('EMBED-ROW-ONE');
    expect(html).not.toContain('id="mfbBoot"');            // no Building your market in the embed
    expect(html).not.toContain('mfb-booting');
  });
});

describe('Building your market: server-rendered, CSS-revealed', () => {
  it('ships in the full page with .app already booting — no script has to run first', async () => {
    const html = await get('');
    expect(html).toContain(MARKET_BOOT_APP_OPEN + '');
    expect(MARKET_BOOT_APP_OPEN).toBe('<div class="app mfb-booting">');
    const i = html.indexOf('id="mfbBoot"');
    expect(i).toBeGreaterThan(-1);
    // Before any inline script in <body>: nothing has to execute for it to exist.
    const body = html.slice(html.indexOf('<body'));
    expect(body.indexOf('id="mfbBoot"')).toBeLessThan(body.indexOf('<script'));
  });
  it('no JS timer reveals it', () => {
    expect(MARKET_BOOT_HTML).not.toContain('<script');
    expect(MARKET_BOOT_HTML).not.toContain('setTimeout');
  });
  it('a compositor opacity animation reveals it after BOOT_REVEAL (~300 ms); static state is visible', () => {
    const rule = (MARKET_FEEDBACK_CSS.match(/\.mfb-boot\{[^}]*\}/) || [''])[0];
    expect(MF_TIMING.BOOT_REVEAL).toBe(300);
    expect(rule).toContain(`animation:mfbBootIn .24s ease-out ${MF_TIMING.BOOT_REVEAL}ms both`);
    expect(rule).not.toMatch(/(^|[;{])opacity:0/);         // reduced motion (animation:none) → shown, not stuck at 0
    expect(MARKET_FEEDBACK_CSS).toContain('@keyframes mfbBootIn{from{opacity:0}to{opacity:1}}');
  });
  it('leaving beats the reveal (a fast load never sees it) and has no minimum display time', () => {
    const out = (MARKET_FEEDBACK_CSS.match(/\.mfb-boot\.out\{[^}]*\}/) || [''])[0];
    expect(out).toContain('opacity:0!important');
    expect(out).toContain('animation:none');
  });
  it('the sweep runs on transform (compositor), never background-position (main thread)', () => {
    const after = (MARKET_FEEDBACK_CSS.match(/\.mfb-boot::after\{[^}]*\}/) || [''])[0];
    const kf = (MARKET_FEEDBACK_CSS.match(/@keyframes mfbBootSweep\{.*?\}\}/) || [''])[0];
    expect(after).toContain('animation:mfbBootSweep');
    expect(kf).toContain('transform:translateX(');
    expect(kf).not.toContain('background-position');
    expect(MARKET_FEEDBACK_CSS).toMatch(/prefers-reduced-motion:reduce\)\{[^}]*\.mfb-boot::after\{animation:none\}/);
  });
});
