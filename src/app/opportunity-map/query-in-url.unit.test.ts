/**
 * ROW 8 (canonical discovery Phase A) — THE DISCOVERY INTENT LIVES IN THE URL.
 *
 * Contract (Eric 2026-09-24, Option 1 — "the horizon is part of the URL contract"):
 *  · whenever explicit discovery intent is written (typed q, agency suggestion, …) the URL carries
 *    { q, agency, horizon } — horizon = the EXACT set of active horizons, comma-joined, reusing the
 *    scope link's existing `horizon` param;
 *  · the URL is authoritative: any explicit intent stands the localStorage restore down (the veto —
 *    equality of one field never authorizes restoring the rest), and memory can never add an
 *    agency / NAICS / state / horizon the URL does not state;
 *  · an explicit horizon set is applied EXACTLY — never the Open-only fallback;
 *  · a legacy ?q= with no horizon gets the documented default policy (all three on,
 *    window.__horizons init, Eric 2026-08-12) — never browser memory;
 *  · legacy agency/naics links without q or horizon keep their existing behaviour.
 *
 * It is a URL WRITER only, called from user actions — never from fetchView / __applySavedSearch /
 * setMapMode — and a toggle during a scope-link restore never rewrites the link being restored.
 * The client JS ships inside TS template literals, so these tests EXECUTE the extracted source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const cook = (s: string) => s.replace(/\\\\/g, '\\');
const between = (a: string, b: string, from = 0) => {
  const s = MAP.indexOf(a, from); expect(s, a).toBeGreaterThan(0);
  const e = MAP.indexOf(b, s + a.length); expect(e, b).toBeGreaterThan(s);
  return MAP.slice(s, e);
};

type Intent = { q?: string; agency?: string; horizon?: string };
type QueryUrl = (search: string, intent: Intent, drop?: boolean) => string;
const mapQueryUrl: QueryUrl = new Function(
  cook(between('window.__mapQueryUrl=function(search,intent,dropContext){', 'window.__syncQueryUrl=function('))
    .replace('window.__mapQueryUrl=', 'var f=') + '; return f;',
)();
const ALL = 'open,recompete,forecast';

describe('__mapQueryUrl — q + agency + horizon written together, nothing else changes', () => {
  it('writes q with the exact active horizon set', () => {
    expect(mapQueryUrl('', { q: 'fiber optic', horizon: ALL }, true)).toBe('?q=fiber%20optic&horizon=open,recompete,forecast');
    expect(mapQueryUrl('', { q: 'janitorial', horizon: 'forecast' }, true)).toBe('?q=janitorial&horizon=forecast');
    expect(mapQueryUrl('', { q: 'x', horizon: 'open,recompete' }, true)).toBe('?q=x&horizon=open,recompete');
  });
  it('writes agency (the canonical agency input) with the horizon', () => {
    expect(mapQueryUrl('', { agency: 'VETERANS AFFAIRS', horizon: 'recompete' }, true))
      .toBe('?agency=VETERANS%20AFFAIRS&horizon=recompete');
  });
  it('no q and no agency → no horizon either (a bare browse is not a link)', () => {
    expect(mapQueryUrl('?q=old&horizon=open', { q: '', agency: '', horizon: 'open' }, true)).toBe('');
    expect(mapQueryUrl('', { horizon: ALL }, true)).toBe('');
  });
  it('returns the SAME string when the URL already says exactly this', () => {
    const s = '?q=fiber+optic&utm_source=x&horizon=open,recompete,forecast';
    expect(mapQueryUrl(s, { q: 'fiber optic', horizon: ALL }, true)).toBe(s);
    expect(mapQueryUrl('?opp=abc', { q: '', horizon: ALL }, true)).toBe('?opp=abc');   // nothing typed → record link untouched
  });
  it('a horizon change alone rewrites the link', () => {
    expect(mapQueryUrl('?q=x&horizon=open,recompete,forecast', { q: 'x', horizon: 'forecast' }, false)).toBe('?q=x&horizon=forecast');
  });
  it('keeps market params and attribution verbatim (raw encoding preserved)', () => {
    expect(mapQueryUrl('?naics=541512&utm_source=li', { q: 'cyber', horizon: 'open' }, true))
      .toBe('?naics=541512&utm_source=li&q=cyber&horizon=open');
  });
  it('a typed intent drops ?ss= and record ids + share markers', () => {
    expect(mapQueryUrl('?ss=42&utm_source=alert', { q: 'janitorial', horizon: 'open' }, true)).toBe('?utm_source=alert&q=janitorial&horizon=open');
    expect(mapQueryUrl('?opp=313550655dcd4916a7700cb5c8f0ab68&src=share&sh=abc', { q: 'roofing', horizon: 'open' }, true)).toBe('?q=roofing&horizon=open');
  });
  it('without dropContext (keep-in-sync calls), context params are kept', () => {
    expect(mapQueryUrl('?ss=42', { q: 'x', horizon: 'open' }, false)).toBe('?ss=42&q=x&horizon=open');
  });
});

/** Run __syncQueryUrl against fake globals. */
function sync(search: string, st: { Q?: string; agency?: string; horizons?: Record<string, boolean>; mode?: string }, drop = true, onlyIfIntent = false) {
  const writes: string[] = [];
  const hz = between('var HZ_ORDER=', 'window.__mapQueryUrl=function(');
  const src = cook(hz + between('window.__syncQueryUrl=function(dropContext,onlyIfIntent){', '\n  var zsi=document.getElementById'));
  const win: Record<string, unknown> = { __mapQueryUrl: mapQueryUrl, __mapMode: st.mode || 'open', __horizons: st.horizons || { open: true, recompete: true, forecast: true } };
  const loc = { search, pathname: '/opportunity-map', hash: '' };
  const hist = { state: null, replaceState: (_s: unknown, _t: string, url: string) => { writes.push(url); } };
  new Function('window', 'location', 'history', 'Q', 'FILT', src + `; window.__syncQueryUrl(${drop},${onlyIfIntent});`)(
    win, loc, hist, st.Q ?? '', { agency: st.agency ?? '' });
  return writes;
}

describe('__syncQueryUrl — reads Q, FILT.agency and the ACTIVE horizons', () => {
  it('typed query on each horizon set → q + that exact horizon', () => {
    expect(sync('', { Q: 'janitorial', horizons: { open: true, recompete: false, forecast: false } })).toEqual(['/opportunity-map?q=janitorial&horizon=open']);
    expect(sync('', { Q: 'janitorial', horizons: { open: false, recompete: true, forecast: false } })).toEqual(['/opportunity-map?q=janitorial&horizon=recompete']);
    expect(sync('', { Q: 'janitorial', horizons: { open: false, recompete: false, forecast: true } })).toEqual(['/opportunity-map?q=janitorial&horizon=forecast']);
    expect(sync('', { Q: 'janitorial' })).toEqual(['/opportunity-map?q=janitorial&horizon=open,recompete,forecast']);
  });
  it('agency filter is written with the horizon', () => {
    expect(sync('', { agency: 'VETERANS AFFAIRS', horizons: { open: true, recompete: false, forecast: false } }))
      .toEqual(['/opportunity-map?agency=VETERANS%20AFFAIRS&horizon=open']);
  });
  it('onlyIfIntent: a horizon toggle on a bare browse writes nothing; on an intent URL it updates', () => {
    expect(sync('', { Q: '', horizons: { open: false, recompete: true, forecast: false } }, false, true)).toEqual([]);
    expect(sync('?q=x&horizon=open', { Q: 'x', horizons: { open: false, recompete: true, forecast: false } }, false, true))
      .toEqual(['/opportunity-map?q=x&horizon=recompete']);
  });
  it('writes nothing when the URL already agrees', () => {
    expect(sync('?q=cyber&horizon=open,recompete,forecast', { Q: 'cyber' })).toEqual([]);
  });
  it('Players / DLA carry no Opportunities intent (and drop a stale one)', () => {
    expect(sync('', { Q: 'booz allen', mode: 'companies' })).toEqual([]);
    expect(sync('?q=biggest&horizon=open', { Q: 'booz allen', mode: 'companies' })).toEqual(['/opportunity-map']);
  });
  it('never rewrites an embedded host page', () => {
    expect(sync('?embed=1', { Q: 'x' })).toEqual([]);
  });
});

describe('wiring — only USER actions (and keep-in-sync for an existing intent URL) write the URL', () => {
  it('search box input handler syncs after setting Q', () => {
    expect(MAP).toContain('Q=zsi.value.trim(); window.__syncQueryUrl(true); fetchView();');
  });
  it('the search bar Enter path (__applySearchFilters) syncs the applied keyword', () => {
    const fn = between('window.__applySearchFilters = function(intent){', '// (Removed the header source badge');
    expect(fn.indexOf('window.__syncQueryUrl(true)')).toBeGreaterThan(fn.indexOf('Q=_kw;'));
  });
  it('toggleHorizon keeps an intent URL in sync — but never during a scope-link restore', () => {
    const t = between('window.toggleHorizon=function(h){', '\n  };\n');
    expect(t).toContain('if(!window.__urlRestoring&&typeof window.__syncQueryUrl===\'function\')window.__syncQueryUrl(false,true);');
  });
  it('agency picker commit, Filters Apply and Filters Clear keep an intent URL in sync', () => {
    expect(between('    function commit(){', 'btn.onclick=function(e){')).toContain('window.__syncQueryUrl(false,true)');
    expect(MAP).toMatch(/_apply\.onclick=function\(\)\{[^\n]*__syncQueryUrl\(false,true\)/);
    expect(between('if(_mfclr)_mfclr.onclick=function(){', '\n  };')).toContain('__syncQueryUrl(false,true)');
  });
  it('saved-search picker and Start fresh sync; __applySavedSearch / fetchView / setMapMode never do', () => {
    expect(between('window.__applySavedSearch=function(ss){', '// Clear all: reset the server filters')).not.toContain('__syncQueryUrl');
    expect(between("else if(act==='saved'){", "else { location.href='/opportunity-map/saved'; }")).toContain('window.__syncQueryUrl(true)');
    expect(between("x.textContent='Start fresh';", 'pill.appendChild(x);')).toContain('window.__syncQueryUrl(true)');
    expect(between('function fetchView(){', '// FOOT OF THE FEED')).not.toContain('__syncQueryUrl');
    expect(between('window.setMapMode=function(mode){', 'function syncHorizonBarVis(mode){')).not.toContain('__syncQueryUrl');
  });
  it('no other history write exists on the page', () => {
    expect(MAP.match(/history\.(replaceState|pushState)\(/g) || []).toHaveLength(1);
  });
});

// ── READ SIDE: scope link + return continuity at boot ─────────────────────────

const NOW = Date.now();
const mem = (filters: Record<string, unknown>, ageH = 2) => JSON.stringify({ mode: 'open', t: NOW - ageH * 3600 * 1000, filters });
const PRESETS = [{ name: 'Department of Veterans Affairs', match: 'VETERANS AFFAIRS' }, { name: 'Department of Defense', match: 'DEFENSE' }, { name: 'Department of Energy', match: 'ENERGY' }];

type Applied = { mode: string; filters: Record<string, unknown> };
/** The scope-link IIFE against fakes: what reaches __applySavedSearch, and which horizon is isolated. */
function runScope(search: string, opts: { restoringSeen?: boolean[] } = {}) {
  const applied: Applied[] = []; const isolated: string[] = [];
  const start = MAP.indexOf("  (function(){ try{\n    function P(k){ var m=(location.search||'')");
  const end = MAP.indexOf('\n  }catch(e){} })();', start) + '\n  }catch(e){} })();'.length;
  const win: Record<string, unknown> = { __AGENCY_PRESETS: PRESETS, __mapMode: 'open' };
  win.__applySavedSearch = (ss: Applied) => { applied.push(ss); opts.restoringSeen?.push(!!win.__urlRestoring); };
  win.__isolateHorizon = (h: string) => isolated.push(h);
  new Function('location', 'localStorage', 'window', 'setTimeout', cook(MAP.slice(start, end)))(
    { search }, { getItem: () => null }, win, (f: () => void) => f(),
  );
  return { applied, isolated, restoringAfter: win.__urlRestoring };
}

/** The return-continuity restorer against fakes. */
function runRestore(search: string, stored: string | null) {
  const applied: unknown[] = [];
  const start = MAP.indexOf('  // ── RETURN CONTINUITY: pick up the market you left');
  const marker = '\n  }catch(e){} })();';
  const end = MAP.indexOf(marker, start) + marker.length;
  const meaningful = new Function(cook(between('window.__mapStateMeaningful=function(f,mode){', 'function _rememberMapState()'))
    .replace('window.__mapStateMeaningful=', 'var m=') + '; return m;')();
  const win: Record<string, unknown> = { __applySavedSearch: (ss: unknown) => applied.push(ss), __mapStateMeaningful: meaningful, __track: () => {}, __STATE_NAMES: {} };
  const el = () => ({ style: { cssText: '' }, setAttribute() {}, appendChild() {}, remove() {}, textContent: '', onclick: null });
  const doc = { querySelector: () => ({ appendChild() {} }), createElement: () => el(), body: { appendChild() {} } };
  new Function('location', 'localStorage', 'window', 'document', 'setTimeout', cook(MAP.slice(start, end)))(
    { search }, { getItem: (k: string) => (k === 'mi_map_last_search' ? stored : null) }, win, doc, (f: () => void) => f(),
  );
  return applied;
}

describe('each horizon round-trips through the URL (writer → reader)', () => {
  for (const set of ['open', 'recompete', 'forecast', 'open,recompete', 'recompete,forecast', ALL]) {
    it(`horizon=${set}`, () => {
      const on = set.split(',');
      const url = mapQueryUrl('', { q: 'janitorial', horizon: set }, true);
      const { applied, isolated } = runScope(url);
      expect(applied).toHaveLength(1);
      expect(applied[0].filters.q).toBe('janitorial');
      expect(applied[0].filters.horizons).toEqual({ open: on.includes('open'), recompete: on.includes('recompete'), forecast: on.includes('forecast') });
      expect(isolated).toEqual([]);                    // exact set — never the Open-only fallback
      expect(applied[0].mode).toBe('open');            // a horizon is not a dataset switch
    });
  }
  it('agency + horizon round-trips (single and pipe-joined agencies)', () => {
    let r = runScope(mapQueryUrl('', { agency: 'VETERANS AFFAIRS', horizon: 'recompete' }, true));
    expect(r.applied[0].filters).toMatchObject({ agency: 'VETERANS AFFAIRS', horizons: { open: false, recompete: true, forecast: false } });
    r = runScope(mapQueryUrl('', { agency: 'DEFENSE|ENERGY', horizon: 'open' }, true));
    expect(r.applied[0].filters.agency).toBe('DEFENSE|ENERGY');
  });
  it('junk horizon tokens are ignored; an all-junk set falls back to the legacy default', () => {
    expect(runScope('?q=x&horizon=forecast,bogus').applied[0].filters.horizons).toEqual({ open: false, recompete: false, forecast: true });
    expect(runScope('?q=x&horizon=bogus').applied[0].filters.horizons).toEqual({ open: true, recompete: true, forecast: true });
  });
  it('the restore guard is set while the scope link applies, and cleared after', () => {
    const seen: boolean[] = [];
    const r = runScope('?q=x&horizon=open', { restoringSeen: seen });
    expect(seen).toEqual([true]);
    expect(r.restoringAfter).toBe(false);
  });
});

describe('legacy links', () => {
  it('?q= with NO horizon → the documented default policy: all three on (not memory, not Open-only)', () => {
    const { applied, isolated } = runScope('?q=janitorial');
    expect(applied[0].filters).toEqual({ q: 'janitorial', horizons: { open: true, recompete: true, forecast: true } });
    expect(isolated).toEqual([]);
    // The policy it cites is the real init default.
    expect(MAP).toContain('window.__horizons={open:true,recompete:true,forecast:true};');
  });
  it('agency/naics links without q or horizon keep their existing behaviour (Open isolation, no horizons key)', () => {
    let r = runScope('?agency=Department%20of%20Defense');
    expect(r.applied[0].filters).toEqual({ agency: 'DEFENSE' });
    expect(r.isolated).toEqual(['open']);
    r = runScope('?naics=541512');
    expect(r.applied[0].filters).toEqual({ naics: '541512' });
    expect(r.isolated).toEqual(['open']);
  });
  it('explicit ?mode=recompete still isolates Recompete (dataset link unchanged)', () => {
    const r = runScope('?mode=recompete');
    expect(r.applied[0].mode).toBe('recompete');
    expect(r.isolated).toEqual(['recompete']);
  });
});

describe('memory never adds what the URL does not state', () => {
  const MEM = mem({ agency: 'VETERANS AFFAIRS', state: 'VA', naics: '541512', q: 'ai governance', horizons: { open: false, recompete: true, forecast: false } });
  it('?q= EQUAL to the remembered q restores NOTHING else — the URL applies alone', () => {
    const url = '?q=ai+governance&horizon=forecast';
    expect(runRestore(url, MEM)).toHaveLength(0);
    const { applied } = runScope(url);
    expect(applied).toHaveLength(1);
    expect(applied[0].filters).toEqual({ q: 'ai governance', horizons: { open: false, recompete: false, forecast: true } });
  });
  it('legacy ?q= (no horizon) equal to memory: default horizons, no remembered agency/state/naics/horizon', () => {
    expect(runRestore('?q=ai+governance', MEM)).toHaveLength(0);
    expect(runScope('?q=ai+governance').applied[0].filters).toEqual({ q: 'ai governance', horizons: { open: true, recompete: true, forecast: true } });
  });
  it('an explicit horizon alone stands memory down', () => {
    expect(runRestore('?horizon=open', MEM)).toHaveLength(0);
  });
  it('the exception machinery is gone', () => {
    expect(MAP).not.toContain('__qLinkOwnSession');
    expect(MAP).not.toContain('__qLinkDeferred');
  });
  it('a bare visit still restores the memory; a record link restores nothing (unchanged)', () => {
    expect(runRestore('', MEM)).toHaveLength(1);
    expect(runRestore('?opp=313550655dcd4916a7700cb5c8f0ab68', MEM)).toHaveLength(0);
  });
});
