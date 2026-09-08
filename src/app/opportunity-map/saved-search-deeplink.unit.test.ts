/**
 * "Explore N New Opportunities" from the watchlist opened the UNFILTERED map.
 *
 * The watchlist flattened a saved search's filters into query params (naics=…, horizons=…,
 * setAsideMulti=…) but the map reads NONE of those — its deep-link params are
 * opp/company/buyer/recompete/strategy. So a search scoped to NAICS 236/237/238, Open-only landed
 * on 136,879 results with every horizon on (Eric 2026-08-13).
 *
 * Two of the values could not have survived the trip anyway. Measured on the real row:
 *   OLD: /opportunity-map?naics=236%2C237%2C238&horizons=%5Bobject%20Object%5D&strategy=
 *                                               ^^^^^^^^^^^^^^^^^^ String({open:true,…})
 * The map now takes ?ss=<id> and reuses __applySavedSearch — the same restorer its own picker
 * uses — so the two entry points share ONE definition of "apply a saved search".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const map = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const saved = readFileSync(join(__dirname, 'saved/route.ts'), 'utf8');

function fnBody(s: string, name: string): string {
  const start = s.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const open = s.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

describe('the watchlist links by id, not by flattened filters', () => {
  const mapUrl = (() => {
    const body = fnBody(saved, 'mapUrl');
    // eslint-disable-next-line no-new-func
    return new Function(`${body}; return mapUrl;`)() as (r: unknown) => string;
  })();

  it('emits ?ss=<id> for a real saved search', () => {
    // The exact row from Eric's watchlist.
    const row = {
      id: '58cedd75-3da7-419e-aa6d-df4a18d29bd2',
      mode: 'open',
      filters: { naics: '236,237,238', horizons: { open: true, forecast: false, recompete: false }, strategy: [] },
    };
    expect(mapUrl(row)).toBe('/opportunity-map?ss=58cedd75-3da7-419e-aa6d-df4a18d29bd2');
    // The params the map never read must be gone — especially the one that stringified to garbage.
    expect(mapUrl(row)).not.toContain('naics=');
    expect(mapUrl(row)).not.toContain('horizons=');
    expect(mapUrl(row)).not.toContain('object%20Object');
  });

  it('degrades to the plain map when there is no id', () => {
    expect(mapUrl({ filters: { naics: '541512' } })).toBe('/opportunity-map');
    expect(mapUrl(null)).toBe('/opportunity-map');
  });
});

describe('the map applies ?ss= through the existing restorer', () => {
  it('reads ?ss and hands it to __applySavedSearch', () => {
    expect(map).toContain("(location.search||'').match(/[?&]ss=([^&]+)/)");
    expect(map).toContain('window.__applySavedSearch(ss);');
    // Reuse, not a second implementation — one code path for both entry points.
    expect(map.match(/window\.__applySavedSearch=function/g)?.length).toBe(1);
  });

  it('never fabricates a filter it could not load', () => {
    const block = map.slice(map.indexOf("var m=(location.search||'').match(/[?&]ss=([^&]+)/)"), map.indexOf('// "Today\'s Lens" pill names the lens'));
    expect(block).toContain('if(!em||!tk)return;');   // signed out -> default map, no pretend filter
    expect(block).toContain('if(!ss)return;');        // deleted / foreign id -> default map
  });
});

describe('a saved search restores its horizons', () => {
  const restorer = map.slice(map.indexOf('window.__applySavedSearch=function'), map.indexOf('// Clear all: reset the server filters'));

  it('applies the saved horizons object', () => {
    // Open-only default + last-ON sticky cannot toggle Open off while it is the only
    // horizon, so restore writes the saved object through __applyHorizonState (same
    // chip sync as toggleHorizon) then fetchView() once.
    expect(restorer).toContain("if(f.horizons&&typeof f.horizons==='object')");
    expect(restorer).toContain('window.__applyHorizonState(f.horizons)');
    expect(restorer).not.toContain('window.toggleHorizon(h)');
  });

  it('syncs the same chips toggleHorizon owns, without the last-ON guard fighting restore', () => {
    expect(restorer).not.toContain('window.__horizons[h]=');
    const apply = map.slice(map.indexOf('window.__applyHorizonState=function'), map.indexOf('window.toggleHorizon=function'));
    expect(apply).toContain(".hzc[data-hz=\"'+h+'\"], .hznrow[data-hz=\"'+h+'\"]");
    expect(apply).toContain('recompete:!!H.recompete');
    const toggle = map.slice(map.indexOf('window.toggleHorizon=function'), map.indexOf('window.toggleHorizon=function') + 1200);
    expect(toggle).toContain(".hzc[data-hz=\"'+h+'\"], .hznrow[data-hz=\"'+h+'\"]");
    expect(toggle).toContain('if(on && onCount<=1)return;');
  });
});
