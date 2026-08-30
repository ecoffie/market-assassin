/**
 * The Network map merges Companies + Gov Buyers onto ONE map (MODES.companies / MODES.buyers both
 * hit /api/app/contacts-map, and the fetch enables each type off window.__players — NOT off MODE).
 * The nav/pill only ever set MODE='companies' ("the value stays companies so no mode wiring
 * changes"), so a per-drawer `MODE === 'buyers'` equality guard made every Gov-Buyer pin and card
 * a DEAD CLICK on the live map: openBuyerDrawer returned before it fetched anything, leaving
 * whatever the drawer last showed (often a stale company) frozen on screen.
 *
 * These tests RUN the shipped drawer openers (extracted from route.ts's injected <script>, the
 * same technique as drawer-parity-awarded-company-buyer.unit.test.ts) against a stub DOM + fetch,
 * so they assert the real dispatch behavior — not the shape of the guard expression.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');

// The drawer JS lives in a TS template literal, so `\\u2019` in the raw source is `’` in the
// browser. De-escaping reproduces exactly what ships.
function deEscape(s: string): string { return s.replace(/\\\\/g, '\\'); }

/** Extract `window.<name>=function(...){...}` from route.ts by brace matching. */
function extractWindowFn(name: string): string {
  const start = routeSrc.indexOf(`window.${name}=function(`);
  expect(start, `window.${name} must exist in route.ts`).toBeGreaterThan(-1);
  const open = routeSrc.indexOf('{', routeSrc.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < routeSrc.length; i++) {
    if (routeSrc[i] === '{') depth++;
    else if (routeSrc[i] === '}') { depth--; if (depth === 0) return deEscape(routeSrc.slice(start, i + 1)); }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

type Harness = { open: (id: string) => void; urls: string[] };

/**
 * Build a runnable drawer opener with the outer scope stubbed (the drawer DOM refs, the pin-set
 * lookup, the render helpers). fetch resolves to a never-settling promise: we only assert WHETHER
 * the request was made, so no rendering runs.
 */
function harness(name: 'openCompanyDrawer' | 'openBuyerDrawer', mapMode: string): Harness {
  const urls: string[] = [];
  const el = () => ({ innerHTML: '', scrollTop: 0, classList: { add() {}, remove() {} } });
  const win: Record<string, unknown> = { __mapMode: mapMode };
  const factory = new Function(
    'window', 'fetch', 'localStorage', 'dr', 'bd', 'body',
    'clearTaskOrderPins', 'companyRender', 'buyerRender', 'buildTabs', 'OPPS', 'CUR',
    `${extractWindowFn(name)}; return window.${name};`,
  );
  const open = factory(
    win,
    (u: string) => { urls.push(u); return new Promise(() => {}); },
    { getItem: () => null },
    el(), el(), el(),
    () => {}, () => '', () => '', () => {}, [], null,
  ) as (id: string) => void;
  return { open, urls };
}

describe('Network map drawer dispatch (companies + buyers share ONE mode)', () => {
  it('a Gov-Buyer card opens the buyer drawer while MODE is the Network default (companies)', () => {
    // THE REGRESSION: this is the live path — nav sets MODE='companies', the list holds both
    // entity types, and clicking a buyer must still fetch buyer-detail.
    const h = harness('openBuyerDrawer', 'companies');
    h.open('12345');
    expect(h.urls.length, 'buyer click on the Network map must not be a dead click').toBe(1);
    expect(h.urls[0]).toContain('/api/app/buyer-detail?id=12345');
  });

  it('a company card opens the company drawer while MODE is buyers', () => {
    // The mirror case: a ?buyer= deep-link can leave MODE='buyers' with company pins on screen.
    const h = harness('openCompanyDrawer', 'buyers');
    h.open('ABC123DEF456');
    expect(h.urls.length, 'company click must not be a dead click in buyers mode').toBe(1);
    expect(h.urls[0]).toContain('/api/app/company-detail?uei=ABC123DEF456');
  });

  it('each drawer still opens in its own mode', () => {
    const b = harness('openBuyerDrawer', 'buyers'); b.open('12345');
    const c = harness('openCompanyDrawer', 'companies'); c.open('ABC123DEF456');
    expect(b.urls.length).toBe(1);
    expect(c.urls.length).toBe(1);
  });

  it('NEITHER drawer opens from the Opportunities map — that is what the guard is for', () => {
    // The guard's real job: an opp/recompete/forecast/dla pin must never open an entity drawer.
    for (const mode of ['open', 'recompete', 'forecast', 'dla', 'grants']) {
      const b = harness('openBuyerDrawer', mode); b.open('12345');
      const c = harness('openCompanyDrawer', mode); c.open('ABC123DEF456');
      expect(b.urls, `buyer drawer must stay shut in ${mode}`).toEqual([]);
      expect(c.urls, `company drawer must stay shut in ${mode}`).toEqual([]);
    }
  });

  it('an empty id is still rejected before any fetch', () => {
    const b = harness('openBuyerDrawer', 'companies'); b.open('');
    const c = harness('openCompanyDrawer', 'companies'); c.open('');
    expect(b.urls).toEqual([]);
    expect(c.urls).toEqual([]);
  });

  it('the ?buyer= deep-link lands on the canonical Network mode via the Players gate', () => {
    // The dataset <select> has no "buyers" <option> (only value="companies", labeled "Players"),
    // so setMapMode('buyers') sets dsel.value to an absent option → the pill renders blank.
    const link = routeSrc.match(/\[\?&\]buyer=\(\[\^&\]\+\)[\s\S]{0,800}?\}\)\(\);/);
    expect(link, 'the ?buyer= deep-link block must exist').toBeTruthy();
    expect(link![0]).not.toContain("setMapMode('buyers')");
    expect(link![0]).toContain("__playersGate('companies', openBu)");
    expect(routeSrc).not.toContain('<option value="buyers"');
  });
});

describe('the dataset selector only offers the merged Network mode', () => {
  it('"Players" is the companies-valued option (the reason both types share one MODE)', () => {
    expect(routeSrc).toContain('<option value="companies">Players</option>');
  });
});

// Keep vi imported-but-used lint-clean if the harness ever swaps to vi.fn().
void vi;
