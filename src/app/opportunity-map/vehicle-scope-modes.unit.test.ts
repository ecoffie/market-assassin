/**
 * #1692 integration review — the vehicle scope across map MODES (DLA, Players).
 * Executes the served __syncQueryUrl (+ __mapQueryUrl) and __renderVehicleScope in a VM with stubbed
 * location/history/DOM. Pins two defects found in review:
 *   · a URL sync while in DLA/Players stripped the scope from the link while FILT kept applying it on
 *     return, and no later "only if intent" sync could write it back (reload/share → unscoped market);
 *   · the scope banner stayed visible over the Players/DLA maps, which ignore the scope.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const SRC = readFileSync(process.env.MAPS_ROUTE_SRC || join(__dirname, 'route.ts'), 'utf8');
const unTemplate = (s: string) => s.replace(/\\\\/g, '\\');
function assigned(src: string, head: string): string {
  const i = src.indexOf(head); if (i < 0) throw new Error(`missing ${head}`);
  let depth = 0; let j = src.indexOf('{', i);
  for (; j < src.length; j++) { const c = src[j]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) break; } }
  return src.slice(i, j + 1) + ';';
}

function syncEnv(search: string, mode: string, FILT: Record<string, string>, Q = '') {
  const location = { search, pathname: '/opportunity-map', hash: '' };
  const window: Record<string, unknown> = { __mapMode: mode, __activeHorizonParam: () => 'recompete' };
  const ctx: Record<string, unknown> = {
    window, location, FILT, Q,
    history: { state: null, replaceState(_s: unknown, _t: string, u: string) { location.search = u.replace(/^\/opportunity-map/, ''); } },
  };
  vm.createContext(ctx);
  vm.runInContext(unTemplate(assigned(SRC, 'window.__mapQueryUrl=function(') + assigned(SRC, 'window.__syncQueryUrl=function(')), ctx);
  return { location, sync: window.__syncQueryUrl as (drop?: boolean, onlyIfIntent?: boolean) => void };
}
const SCOPED = '?mode=recompete&horizon=recompete&vehicle=OASIS%2B&work=management%20consulting&leadMax=60&minValue=1000000';
const F = { vehicle: 'OASIS+', parent: '', work: 'management consulting', leadMax: '60', valueRange: '1000000-', agency: '' };

describe('a URL sync in DLA/Players keeps the scope the map will re-apply on return', () => {
  for (const mode of ['dla', 'companies', 'buyers']) {
    it(`${mode}: Filters apply (onlyIfIntent) and typing (drop) keep vehicle/work/leadMax/minValue`, () => {
      const e = syncEnv(SCOPED, mode, { ...F });
      e.sync(false, true);
      expect(e.location.search).toBe(SCOPED);
      e.sync(true);
      expect(e.location.search).toContain('vehicle=OASIS%2B');
      expect(e.location.search).toContain('minValue=1000000');
    });
  }
  it('a Players search term never becomes an Opportunities q (the dataset rule is unchanged)', () => {
    const e = syncEnv(SCOPED, 'companies', { ...F }, 'lockheed');
    e.sync(true);
    expect(e.location.search).not.toContain('q=');
  });
  it('on the Opportunities map nothing changed: clearing FILT still drops the scope', () => {
    const e = syncEnv(SCOPED, 'recompete', { vehicle: '', parent: '', work: '', leadMax: '', valueRange: '', agency: '' });
    e.sync(false, true);
    expect(e.location.search).toBe('?mode=recompete');
  });
});

describe('the scope banner shows only on the Opportunities map', () => {
  function bannerEnv(mode: string) {
    const nodes: Record<string, { style: { display: string; cssText: string }; textContent: string; id?: string; appendChild: (n: unknown) => void; setAttribute: () => void }> = {};
    const mk = () => ({ style: { display: '', cssText: '' }, textContent: '', appendChild() {}, setAttribute() {}, onclick: null as unknown });
    const window: Record<string, unknown> = {
      __mapMode: mode, innerWidth: 1400,
      __vehicleScope: { status: 'resolved', kind: 'vehicle', label: 'OASIS+', parents_in_scope: 237, work_terms: [] },
      __vehicleScopeState: () => ({ vehicle: 'OASIS+', parent: '', work: '' }),
    };
    const document = {
      getElementById: (id: string) => nodes[id] || null,
      createElement: () => mk(),
      body: { appendChild(n: { id?: string }) { if (n.id) nodes[n.id] = n as never; } },
    };
    const ctx: Record<string, unknown> = { window, document };
    vm.createContext(ctx);
    // The element ids are assigned after createElement — capture them via a tiny shim.
    const code = unTemplate(assigned(SRC, 'window.__renderVehicleScope=function(')).replace(/el\.id='vehicleScopeBar';/, "el.id='vehicleScopeBar';").replace(/txt\.id='vehicleScopeText';/, "txt.id='vehicleScopeText'; nodes_put(txt);");
    ctx.nodes_put = (n: { id: string }) => { nodes[n.id] = n as never; };
    vm.runInContext(code, ctx);
    (window.__renderVehicleScope as () => void)();
    return nodes;
  }
  it('Opportunities (open/recompete): visible', () => {
    for (const m of ['open', 'recompete']) expect(bannerEnv(m).vehicleScopeBar?.style.display, m).toBe('flex');
  });
  it('DLA and Players: hidden (they ignore the scope)', () => {
    for (const m of ['dla', 'companies', 'buyers']) {
      const bar = bannerEnv(m).vehicleScopeBar;
      expect(!bar || bar.style.display === 'none', m).toBe(true);
    }
  });
  it('every fetch round re-evaluates the banner (the Players branch returns before any Awarded round)', () => {
    expect(SRC).toMatch(/function _fetchViewNow\(t0\)\{\n\s*if\(window\.__suppressFetchView\) return;\n(?:\s*\/\/[^\n]*\n)*\s*if\(typeof window\.__renderVehicleScope==='function'\)window\.__renderVehicleScope\(\);/);
  });
});
