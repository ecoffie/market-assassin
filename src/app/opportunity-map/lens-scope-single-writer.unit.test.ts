/**
 * Map filter initialization: ?strategy= together with a scope (?naics=, ?agency=…) has ONE writer.
 *
 * Two boot handlers used to apply such a link independently: the lens handler checked the strategy
 * boxes and applied them, and the scope-link handler called __applySavedSearch, whose FILT reset has
 * no strategy key. Whichever ran second won, so the lens CTA's NAICS and strands could never both
 * hold (Joseph Boyd, 2026-10-25 — same race family as the ?naics=&state= 5,416 → 0 incident).
 *
 * These tests EXECUTE the two shipped handlers from route.ts in jsdom, with __applySavedSearch and
 * __applyStrategyBoxes stubbed to record every write.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

const src = readFileSync(join(process.cwd(), 'src/app/opportunity-map/route.ts'), 'utf8');

/** A handler block as the browser receives it (the TS template literal un-doubles backslashes). */
function block(startMarker: string): string {
  const start = src.indexOf(startMarker);
  expect(start, startMarker).toBeGreaterThan(-1);
  const end = src.indexOf('}catch(e){} })();', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end + '}catch(e){} })();'.length).replace(/\\\\/g, '\\');
}
const SCOPE = block('// Deep-link: scope params — /opportunity-map?agency=');
const LENS = block('// "Today\'s Lens" pill names the lens');
const STRANDS = ['repeat_buyer', 'sb_friendly', 'posts_early', 'sources_sought', 'closes_soon', 'set_aside'];

type Call = { ss: { mode: string; filters: Record<string, unknown> }; opts?: { strategy?: boolean } };

async function boot(query: string) {
  const boxes = STRANDS.map((v) => `<label><input type="checkbox" class="mf-strategy" value="${v}"><span>${v}</span></label>`).join('');
  const dom = new JSDOM(`<!doctype html><body><div class="mapwrap"></div>${boxes}</body>`, {
    url: `https://getmindy.ai/opportunity-map${query}`, runScripts: 'outside-only',
  });
  const w = dom.window as unknown as Window & Record<string, unknown> & { eval: (s: string) => unknown };
  const applyCalls: Call[] = [];
  let boxApplies = 0;
  w.__AGENCY_PRESETS = [];
  w.__mapMode = 'open';
  w.__isolateHorizon = () => {};
  // Mirrors the real restorer's strategy branch: with opts.strategy it checks exactly the saved strands.
  w.__applySavedSearch = (ss: Call['ss'], opts?: Call['opts']) => {
    applyCalls.push({ ss, opts });
    if (opts?.strategy) {
      const want = String(ss.filters.strategy || '').split(',');
      w.document.querySelectorAll<HTMLInputElement>('.mf-strategy').forEach((b) => { b.checked = want.includes(b.value); });
    }
    return { unsupported: [] };
  };
  w.__applyStrategyBoxes = () => { boxApplies++; return null; };
  w.eval(SCOPE);
  w.eval(LENS);
  await new Promise((r) => setTimeout(r, 400));
  const checked = [...w.document.querySelectorAll<HTMLInputElement>('.mf-strategy:checked')].map((b) => b.value);
  return { applyCalls, boxApplies: () => boxApplies, checked, pill: w.document.getElementById('todaysLensPill') };
}

describe('lens CTA (?strategy= + ?naics=) initializes the Map through ONE writer', () => {
  it('scope handler applies NAICS AND strands in a single call; the lens handler does not write', async () => {
    const r = await boot('?strategy=repeat_buyer,sb_friendly,sources_sought&naics=236220,238160&src=alert');
    expect(r.applyCalls).toHaveLength(1);
    expect(r.applyCalls[0].ss.filters).toMatchObject({ naics: '236220,238160', strategy: 'repeat_buyer,sb_friendly,sources_sought' });
    expect(r.applyCalls[0].opts).toEqual({ strategy: true });
    expect(r.boxApplies()).toBe(0);                       // no second writer
    expect(r.checked.sort()).toEqual(['repeat_buyer', 'sb_friendly', 'sources_sought']);
    expect(r.pill?.textContent).toContain('repeat_buyer');  // the lens is still named
  });

  it('/today hero shape (?agency= + ?strategy=) — same single writer', async () => {
    const r = await boot('?agency=DEFENSE&strategy=set_aside');
    expect(r.applyCalls).toHaveLength(1);
    expect(r.applyCalls[0].ss.filters).toMatchObject({ agency: 'DEFENSE', strategy: 'set_aside' });
    expect(r.boxApplies()).toBe(0);
  });

  it('?strategy= alone (legacy lens links) is still applied by the lens handler', async () => {
    const r = await boot('?strategy=repeat_buyer,closes_soon');
    expect(r.applyCalls).toHaveLength(0);
    expect(r.boxApplies()).toBe(1);
    expect(r.checked.sort()).toEqual(['closes_soon', 'repeat_buyer']);
    expect(r.pill).not.toBeNull();
  });

  it('a scope link WITHOUT strategy is unchanged: no strategy, no opts', async () => {
    const r = await boot('?naics=541512');
    expect(r.applyCalls).toHaveLength(1);
    expect(r.applyCalls[0].ss.filters.strategy).toBeUndefined();
    expect(r.applyCalls[0].opts).toBeUndefined();
    expect(r.boxApplies()).toBe(0);
  });

  it('a junk strand with a scope applies the scope and fabricates no lens pill', async () => {
    const r = await boot('?naics=541512&strategy=not_a_strand');
    expect(r.applyCalls).toHaveLength(1);
    expect(r.checked).toEqual([]);
    expect(r.pill).toBeNull();
  });

  it('the lens handler’s scope detector covers exactly the scope handler’s trigger keys', () => {
    const early = SCOPE.match(/if\((!agency[^)]*)\)return;/)![1];
    const scopeKeys = [...early.matchAll(/!([a-zA-Z]+)/g)].map((m) => m[1].toLowerCase()).sort();
    const lensKeys = LENS.match(/\[\?&\]\(([a-zA-Z|]+)\)=\[\^&\]/)![1].split('|').map((k) => k.toLowerCase());
    for (const k of scopeKeys) expect(lensKeys).toContain(k);
  });
});

describe('the real restorer honours opts.strategy (source contract)', () => {
  const restorer = src.slice(src.indexOf('window.__applySavedSearch=function(ss,opts){'), src.indexOf('// Reflect the restored filters onto the visible controls'));
  it('strategy is applied for saved searches OR an explicit opts.strategy, and never reported unsupported then', () => {
    expect(restorer).toContain('var _withStrategy=_asSaved||!!(opts&&opts.strategy);');
    expect(restorer).toContain("if(uk==='strategy'&&_withStrategy)continue;");
    expect(restorer).toContain('if(_withStrategy){');
  });
  it('opts.strategy does NOT pull in the saved-search-only semantics (national view, exact horizons)', () => {
    const tail = src.slice(src.indexOf('window.__applySavedSearch=function(ss,opts){'), src.indexOf('window.__applySavedSearch=function(ss,opts){') + 20000);
    const savedOnly = [...tail.matchAll(/if\(_asSaved\b/g)].length;
    expect(savedOnly).toBeGreaterThan(0);              // those branches still key on _asSaved alone
  });
});
