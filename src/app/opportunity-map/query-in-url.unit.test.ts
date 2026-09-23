/**
 * ROW 8 (canonical discovery Phase A) — THE TYPED QUERY LIVES IN THE URL.
 *
 * Before: the search box wrote Q in memory only. Reload or share, and the query was gone — while
 * the scope-link IIFE had read `?q=` since 2026-08-15, so the READ half existed with no writer.
 *
 * Rules this pins (CLAUDE.md "Record links vs market links" + "Return continuity"):
 *  · a URL WRITER only — never an applier, never called from fetchView or __applySavedSearch, so a
 *    boot restore cannot rewrite the link that booted it (the 5,416 → 0 class needs a LATE reader);
 *  · a user-typed query drops ?ss= and record ids (two appliers on reload / a record link carrying
 *    a filter that can delete its record) and keeps every market + attribution param verbatim;
 *  · `?q=` is a market link → the localStorage restore stands down — EXCEPT when it is this
 *    visitor's own session (memory holds exactly that q), decided ONCE so only one applier runs.
 *
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

type QueryUrl = (search: string, q: string, drop?: boolean) => string;
const mapQueryUrl: QueryUrl = new Function(
  cook(between('window.__mapQueryUrl=function(search,q,dropContext){', 'window.__syncQueryUrl=function('))
    .replace('window.__mapQueryUrl=', 'var f=') + '; return f;',
)();

describe('__mapQueryUrl — the URL carries the query, nothing else changes', () => {
  it('adds q to a bare URL and removes it when the box is cleared', () => {
    expect(mapQueryUrl('', 'fiber optic', true)).toBe('?q=fiber%20optic');
    expect(mapQueryUrl('?q=fiber%20optic', '', true)).toBe('');
  });
  it('is a no-op (returns the SAME string) when the URL already says this query', () => {
    // byte-identical → __syncQueryUrl skips replaceState entirely; also reads "+" as a space,
    // the same decoding the scope-link IIFE uses.
    expect(mapQueryUrl('?q=fiber+optic&utm_source=x', 'fiber optic', true)).toBe('?q=fiber+optic&utm_source=x');
    expect(mapQueryUrl('?opp=abc', '', true)).toBe('?opp=abc');   // nothing typed → record link untouched
  });
  it('keeps market params and attribution verbatim (raw encoding preserved)', () => {
    expect(mapQueryUrl('?agency=DEPT%20OF%20DEFENSE&naics=541512&utm_source=li', 'cyber', true))
      .toBe('?agency=DEPT%20OF%20DEFENSE&naics=541512&utm_source=li&q=cyber');
  });
  it('a typed query drops ?ss= and record ids + share markers (no second applier, no filtered record link)', () => {
    expect(mapQueryUrl('?ss=42&utm_source=alert', 'janitorial', true)).toBe('?utm_source=alert&q=janitorial');
    expect(mapQueryUrl('?opp=313550655dcd4916a7700cb5c8f0ab68&src=share&sh=abc', 'roofing', true)).toBe('?q=roofing');
    for (const k of ['company', 'buyer', 'recompete', 'forecast']) {
      expect(mapQueryUrl(`?${k}=X1`, 'hvac', true)).toBe('?q=hvac');
    }
  });
  it('without dropContext, context params are kept', () => {
    expect(mapQueryUrl('?ss=42', 'x', false)).toBe('?ss=42&q=x');
  });
  it('replaces an existing q rather than appending a second one', () => {
    expect(mapQueryUrl('?q=old&naics=236220', 'new term', true)).toBe('?naics=236220&q=new%20term');
  });
  it('round-trips through the scope-link reader', () => {
    const P = (search: string, k: string) => {
      const m = search.match(new RegExp('[?&]' + k + '=([^&]+)'));
      return m ? decodeURIComponent(m[1].split('+').join(' ')).trim() : '';
    };
    for (const q of ['fiber optic', 'a&b = c', '"medical billing" -dental', 'Département']) {
      expect(P(mapQueryUrl('?naics=1', q, true), 'q')).toBe(q);
    }
  });
});

/** Run __syncQueryUrl against fake globals. */
function sync(search: string, Q: string, mode = 'open', drop = true) {
  const writes: string[] = [];
  const src = cook(between('window.__syncQueryUrl=function(dropContext){', '\n  var zsi=document.getElementById'));
  const win: Record<string, unknown> = { __mapQueryUrl: mapQueryUrl, __mapMode: mode };
  const loc = { search, pathname: '/opportunity-map', hash: '' };
  const hist = { state: null, replaceState: (_s: unknown, _t: string, url: string) => { writes.push(url); } };
  new Function('window', 'location', 'history', 'Q', src + '; window.__syncQueryUrl(' + drop + ');')(win, loc, hist, Q);
  return writes;
}

describe('__syncQueryUrl — one replaceState, only when the URL would change', () => {
  it('writes the typed query with replaceState (no reload, no history entry)', () => {
    expect(sync('', 'fiber optic')).toEqual(['/opportunity-map?q=fiber%20optic']);
  });
  it('writes nothing when the URL already agrees', () => {
    expect(sync('?q=cyber', 'cyber')).toEqual([]);
  });
  it('Players / DLA carry no q — and drop a stale Opportunities one', () => {
    expect(sync('', 'booz allen', 'companies')).toEqual([]);
    expect(sync('?q=biggest%20va%20contractors', 'booz allen', 'companies')).toEqual(['/opportunity-map']);
    expect(sync('', '5330', 'dla')).toEqual([]);
  });
  it('recompete (Awarded) is a restorable dataset and carries q', () => {
    expect(sync('', 'janitorial', 'recompete')).toEqual(['/opportunity-map?q=janitorial']);
  });
  it('never rewrites an embedded host page', () => {
    expect(sync('?embed=1', 'x')).toEqual([]);
  });
});

describe('wiring — only USER actions write the URL', () => {
  it('the search box input handler syncs after setting Q', () => {
    expect(MAP).toContain("Q=zsi.value.trim(); window.__syncQueryUrl(true); fetchView();");
  });
  it('the search bar Enter path (__applySearchFilters) syncs the applied keyword', () => {
    const fn = between('window.__applySearchFilters = function(intent){', '// (Removed the header source badge');
    expect(fn.indexOf('window.__syncQueryUrl(true)')).toBeGreaterThan(fn.indexOf('Q=_kw;'));
  });
  it('the saved-search picker and Start fresh sync; __applySavedSearch itself NEVER does', () => {
    const restorer = between('window.__applySavedSearch=function(ss){', '// Clear all: reset the server filters');
    expect(restorer).not.toContain('__syncQueryUrl');
    expect(between("else if(act==='saved'){", "else { location.href='/opportunity-map/saved'; }")).toContain('window.__syncQueryUrl(true)');
    expect(between("x.textContent='Start fresh';", 'pill.appendChild(x);')).toContain('window.__syncQueryUrl(true)');
  });
  it('fetchView never writes the URL (a state-derived writer would race boot restores)', () => {
    expect(between('function fetchView(){', '// FOOT OF THE FEED')).not.toContain('__syncQueryUrl');
  });
  it('setMapMode does not write the URL (it runs inside restores and the Players gate)', () => {
    expect(between('window.setMapMode=function(mode){', 'function syncHorizonBarVis(mode){')).not.toContain('__syncQueryUrl');
  });
  it('no other history write exists on the page', () => {
    const writes = MAP.match(/history\.(replaceState|pushState)\(/g) || [];
    expect(writes).toHaveLength(1);
  });
});

// ── RETURN CONTINUITY × ?q= ──────────────────────────────────────────────────

const ownSession = new Function(
  cook(between('window.__qLinkOwnSession=function(qs,raw,now){', '\n  (function(){ try{'))
    .replace('window.__qLinkOwnSession=', 'var f=') + '; return f;',
)() as (qs: string, raw: string, now: number) => boolean;

const NOW = Date.now();
const mem = (q: string | undefined, ageH = 2, extra: Record<string, unknown> = {}) => JSON.stringify({
  mode: 'open', t: NOW - ageH * 3600 * 1000,
  filters: { agency: 'NAVY', state: 'VA', ...(q === undefined ? {} : { q }), horizons: { open: true, recompete: false, forecast: false }, ...extra },
});

describe('__qLinkOwnSession — a ?q= this visitor wrote', () => {
  it('true only when the memory holds EXACTLY the URL query', () => {
    expect(ownSession('?q=fiber%20optic', mem('fiber optic'), NOW)).toBe(true);
    expect(ownSession('?q=fiber+optic&utm_source=x', mem('fiber optic'), NOW)).toBe(true);
    expect(ownSession('?q=fiber', mem('fiber optic'), NOW)).toBe(false);   // a colleague's link
    expect(ownSession('?q=fiber', mem(undefined), NOW)).toBe(false);
  });
  it('any other record/market param → an explicit link, never the memory', () => {
    for (const p of ['naics=541512', 'agency=NAVY', 'ss=1', 'opp=abc', 'state=VA', 'mode=recompete', 'embed=1']) {
      expect(ownSession(`?q=fiber&${p}`, mem('fiber'), NOW), p).toBe(false);
    }
  });
  it('stale (>30d), undated or unreadable memory is not a session', () => {
    expect(ownSession('?q=fiber', mem('fiber', 31 * 24), NOW)).toBe(false);
    expect(ownSession('?q=fiber', JSON.stringify({ mode: 'open', filters: { q: 'fiber' } }), NOW)).toBe(false);
    expect(ownSession('?q=fiber', '{not json', NOW)).toBe(false);
    expect(ownSession('?q=fiber', '', NOW)).toBe(false);
    expect(ownSession('', mem(''), NOW)).toBe(false);
  });
  it('compares against the 120-char slice _mapState stores', () => {
    const long = 'x'.repeat(150);
    expect(ownSession('?q=' + long, mem(long.slice(0, 120)), NOW)).toBe(true);
  });
});

/** The scope-link IIFE, run against fakes: which filters does it hand __applySavedSearch? */
function runScope(search: string, stored: string | null) {
  const applied: unknown[] = [];
  const start = MAP.indexOf("  (function(){ try{\n    function P(k){ var m=(location.search||'')");
  const end = MAP.indexOf('\n  }catch(e){} })();', start) + '\n  }catch(e){} })();'.length;
  const win: Record<string, unknown> = {
    __qLinkOwnSession: ownSession,
    __applySavedSearch: (ss: unknown) => applied.push(ss),
    __AGENCY_PRESETS: [], __mapMode: 'open',
  };
  const ls = { getItem: (k: string) => (k === 'mi_map_last_search' ? stored : null) };
  new Function('location', 'localStorage', 'window', 'setTimeout', cook(MAP.slice(start, end)))(
    { search }, ls, win, (f: () => void) => f(),
  );
  return { applied, deferred: win.__qLinkDeferred };
}

/** The return-continuity restorer, run with the scope IIFE's decision. */
function runRestore(search: string, stored: string | null, deferred: unknown) {
  const applied: unknown[] = [];
  const start = MAP.indexOf('  // ── RETURN CONTINUITY: pick up the market you left');
  const marker = '\n  }catch(e){} })();';
  const end = MAP.indexOf(marker, start) + marker.length;
  const meaningful = new Function(cook(between('window.__mapStateMeaningful=function(f,mode){', 'function _rememberMapState()'))
    .replace('window.__mapStateMeaningful=', 'var m=') + '; return m;')();
  const win: Record<string, unknown> = {
    __applySavedSearch: (ss: unknown) => applied.push(ss), __mapStateMeaningful: meaningful,
    __qLinkOwnSession: ownSession, __track: () => {}, __STATE_NAMES: {},
  };
  if (deferred !== undefined) win.__qLinkDeferred = deferred;
  const el = () => ({ style: { cssText: '' }, setAttribute() {}, appendChild() {}, remove() {}, textContent: '', onclick: null });
  const doc = { querySelector: () => ({ appendChild() {} }), createElement: () => el(), body: { appendChild() {} } };
  const ls = { getItem: (k: string) => (k === 'mi_map_last_search' ? stored : null) };
  new Function('location', 'localStorage', 'window', 'document', 'setTimeout', cook(MAP.slice(start, end)))(
    { search }, ls, win, doc, (f: () => void) => f(),
  );
  return applied;
}

/** Boot both, in page order, sharing ONE window decision — exactly how the page runs them. */
function boot(search: string, stored: string | null) {
  const s = runScope(search, stored);
  const r = runRestore(search, stored, s.deferred);
  return { scope: s.applied, restore: r, total: s.applied.length + r.length };
}

describe('exactly ONE applier at boot — never both', () => {
  it('own session: the memory restores the WHOLE market, the scope link stands down', () => {
    const b = boot('?q=fiber%20optic', mem('fiber optic'));
    expect(b.total).toBe(1);
    expect(b.scope).toHaveLength(0);
    const f = (b.restore[0] as { filters: Record<string, unknown> }).filters;
    expect(f).toMatchObject({ q: 'fiber optic', agency: 'NAVY', state: 'VA' });
  });
  it('a shared link (someone else\'s memory) applies ONLY the query — the link wins', () => {
    const b = boot('?q=fiber%20optic', mem('roofing'));
    expect(b.total).toBe(1);
    expect(b.restore).toHaveLength(0);
    expect((b.scope[0] as { filters: Record<string, unknown> }).filters).toEqual({ q: 'fiber optic' });
  });
  it('no memory at all → the query alone', () => {
    const b = boot('?q=fiber', null);
    expect(b.total).toBe(1);
    expect((b.scope[0] as { filters: Record<string, unknown> }).filters).toEqual({ q: 'fiber' });
  });
  it('q + another market param is never own-session, even with a matching memory', () => {
    const b = boot('?q=fiber&naics=541512', mem('fiber'));
    expect(b.total).toBe(1);
    expect(b.restore).toHaveLength(0);
    expect((b.scope[0] as { filters: Record<string, unknown> }).filters).toMatchObject({ q: 'fiber', naics: '541512' });
  });
  it('a record link still stands the memory down (unchanged)', () => {
    expect(boot('?opp=313550655dcd4916a7700cb5c8f0ab68', mem('fiber')).total).toBe(0);
  });
  it('a bare visit still restores the memory (unchanged)', () => {
    const b = boot('', mem('fiber'));
    expect(b.total).toBe(1);
    expect(b.restore).toHaveLength(1);
  });
});
