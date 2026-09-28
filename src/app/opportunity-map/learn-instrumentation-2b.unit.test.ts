/**
 * Learn PR 2b — the remaining Maps instrumentation contract (repair board P0-G).
 *  - listing_open carries metadata.horizon, taken from the same pin src the drawer routes on;
 *  - drawers reached WITHOUT openOppDrawer (typed ?recompete= / ?forecast= links, similar cards)
 *    also emit listing_open — and a routed open is never counted twice;
 *  - horizon_toggled fires for a USER toggle only, never for a deep-link isolate or saved-search restore;
 *  - window.__drawerKind names the open drawer and clears on close;
 *  - a share link never carries learn= (or anything else from the current URL).
 * Executes the extracted client source from route.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAP = readFileSync(join(__dirname, 'route.ts'), 'utf8');
function slice(start: string, end: string, from = 0) {
  const a = MAP.indexOf(start, from);
  if (a < 0) throw new Error(`marker not found: ${start}`);
  const b = MAP.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`end marker not found: ${end}`);
  return MAP.slice(a, b).replace(/\\\\/g, '\\');
}

type Ev = [string, string, Record<string, unknown>];
const flush = () => new Promise((r) => setTimeout(r, 0));

function drawers(opts: { pins?: Record<string, unknown>[]; mode?: string } = {}) {
  const events: Ev[] = [];
  const win: Record<string, unknown> = {
    __track: (k: string, a: string, m: Record<string, unknown>) => events.push([k, a, m]),
    __mapMode: opts.mode ?? 'open',
    OPPS: opts.pins ?? [],
  };
  const el = () => ({ innerHTML: '', classList: { add() {}, remove() {} }, scrollTop: 0 });
  const code =
    slice("  window.__drawerKind=null;\n  function close(){", "  // Action bar:") +
    slice('  window.openRecompeteDrawer=function(key){', '\n  };') + '\n  };\n' +
    slice('  window.openForecastDrawer=function(key){', '\n  };') + '\n  };\n' +
    slice('  window.openOppDrawer=function(nid,force){', "    fetch('/api/app/opportunity-detail?id='") +
    "\n  };\nreturn { close: close };";
  const api = new Function('document', 'window', 'OPPS', 'dr', 'bd', 'body', 'clearTaskOrderPins', 'findRecompeteRow', 'paintRecompeteDrawer',
    'fetchRecompeteRow', 'forecastRender', 'buildTabs', 'loadForecastDetail', 'loadCrossSellOpen', 'oppShellHTML', code)(
    { addEventListener() {} }, win, win.OPPS, el(), el(), el(), () => {}, (k: string) => ({ nid: k }), () => {}, () => {}, () => '', () => {}, () => {}, () => {}, () => '') as { close: () => void };
  return { win, events, api, open: (win as { openOppDrawer: (n: string, f?: boolean) => void }).openOppDrawer };
}

describe('listing_open carries the horizon the drawer routes on', () => {
  const NID = '0d83db23b91c4db7883b8e9e38b2f180';
  for (const [src, horizon] of [['SAM', 'open'], ['RECOMPETE', 'recompete'], ['FORECAST', 'forecast'], ['DLA', 'dla']] as const) {
    it(`${src} pin → horizon '${horizon}', counted once`, () => {
      const d = drawers({ pins: [{ nid: 'k1', src }] });
      d.open('k1');
      const lo = d.events.filter((e) => e[1] === 'listing_open');
      expect(lo).toHaveLength(1);
      expect(lo[0][2]).toMatchObject({ notice_id: 'k1', horizon });
    });
  }
  it('typed ?opp= deep link with no pin in hand: a SAM notice id reads as open', () => {
    const d = drawers();
    d.open(NID, true);
    expect(d.events.filter((e) => e[1] === 'listing_open')[0][2]).toMatchObject({ horizon: 'open' });
  });
});

describe('drawers reached without openOppDrawer still count, exactly once', () => {
  it('typed ?recompete= / similar card → openRecompeteDrawer emits listing_open(recompete)', () => {
    const d = drawers();
    (d.win.openRecompeteDrawer as (k: string) => void)('CONT_AWD_X');
    const lo = d.events.filter((e) => e[1] === 'listing_open');
    expect(lo).toEqual([['tool_use', 'listing_open', { notice_id: 'CONT_AWD_X', horizon: 'recompete' }]]);
  });
  it('typed ?forecast= → openForecastDrawer emits listing_open(forecast)', () => {
    const d = drawers();
    (d.win.openForecastDrawer as (k: string) => void)('fc-1');
    expect(d.events.filter((e) => e[1] === 'listing_open')[0][2]).toMatchObject({ horizon: 'forecast' });
  });
  it('the same recompete reopened later from a similar card counts again (the marker is one-shot)', () => {
    const d = drawers({ pins: [{ nid: 'r1', src: 'RECOMPETE' }] });
    d.open('r1');
    (d.win.openRecompeteDrawer as (k: string) => void)('r1');
    expect(d.events.filter((e) => e[1] === 'listing_open')).toHaveLength(2);
  });
});

describe('window.__drawerKind', () => {
  it('names the open drawer and clears on close', () => {
    const d = drawers({ pins: [{ nid: 'r1', src: 'RECOMPETE' }, { nid: 'f1', src: 'FORECAST' }] });
    d.open('r1'); expect(d.win.__drawerKind).toBe('recompete');
    d.open('f1'); expect(d.win.__drawerKind).toBe('forecast');
    d.api.close(); expect(d.win.__drawerKind).toBeNull();
    d.open('0d83db23b91c4db7883b8e9e38b2f180', true); expect(d.win.__drawerKind).toBe('open');
  });
  it('company, buyer and DLA drawers set their own kind', () => {
    expect(slice('window.openCompanyDrawer=function(uei){', 'var em=')).toContain("window.__drawerKind='company'");
    expect(slice('window.openBuyerDrawer=function(id){', 'var em=')).toContain("window.__drawerKind='buyer'");
    expect(MAP).toContain("if(d.opp.isDla){ window.__drawerKind='dla';");
  });
});

describe('horizon_toggled — the user exploring a horizon, never a restore', () => {
  function horizons() {
    const events: Ev[] = [];
    const win: Record<string, unknown> = { __horizons: { open: true, recompete: true, forecast: true } };
    const doc = { querySelectorAll: () => ({ forEach() {} }) };
    const code = slice('  window.toggleHorizon=function(h){', '  // Typed-address boot:');
    new Function('window', 'document', '_track', code)(win, doc, (k: string, a: string, m: Record<string, unknown>) => events.push([k, a, m]));
    return { win, events, toggle: win.toggleHorizon as (h: string) => void, isolate: win.__isolateHorizon as (h: string) => void };
  }
  it('a chip click fires horizon_toggled with the new state', () => {
    const h = horizons();
    h.toggle('forecast');
    expect(h.events).toEqual([['tool_use', 'horizon_toggled', { horizon: 'forecast', on: false }]]);
  });
  it('a typed deep link isolating one horizon fires nothing', () => {
    const h = horizons();
    h.isolate('recompete');
    expect(h.events).toHaveLength(0);
    expect(h.win.__horizons).toEqual({ open: false, recompete: true, forecast: false });
    expect(h.win.__hzSystem).toBe(false);
  });
  it('the saved-search restorer marks itself as a system toggle', () => {
    const restorer = slice('window.__applySavedSearch=function', '// Clear all: reset the server filters');
    expect(restorer).toMatch(/window\.__hzSystem=true;[\s\S]*window\.toggleHorizon\(h\)[\s\S]*finally\{ window\.__hzSystem=false; \}/);
  });
});

describe('a share link never carries learn= (or anything else from the current URL)', () => {
  it('the only share builder composes the URL from origin + record + src + sh', () => {
    const share = slice('  if(_share)_share.onclick=function(){', '\n  };');
    const urlLine = share.split('\n').find((l) => /var url=/.test(l))!;
    expect(urlLine).toMatch(/var url=location\.origin\+'\/opportunity-map\?'\+_pk\+'='\+encodeURIComponent\(CUR\.id\)\+'&src=share&sh='\+_sid;/);
    expect(urlLine).not.toMatch(/location\.(search|href)/);
  });
  it('there is no other share/copy builder in the Map that reuses the current URL', () => {
    expect(MAP.match(/navigator\.clipboard\.writeText\(/g)?.length).toBe(1);
  });
});

void flush;

describe('typed ?recompete= retry loop counts one open, not one per retry (prod 2026-09-28: 4-15)', () => {
  function run(paintOnTry: number) {
    const events: Ev[] = [];
    const timers: Array<() => void> = [];
    const win: Record<string, unknown> = { __track: (k: string, a: string, m: Record<string, unknown>) => events.push([k, a, m]), __mapMode: 'open', OPPS: [] };
    let calls = 0;
    const el = () => ({ innerHTML: '', classList: { add() {}, remove() {} }, scrollTop: 0 });
    const drawer =
      slice("  window.__drawerKind=null;\n  function close(){", "  // Action bar:") +
      slice('  window.openRecompeteDrawer=function(key){', '\n  };') + '\n  };\n';
    new Function('document', 'window', 'OPPS', 'dr', 'bd', 'body', 'clearTaskOrderPins', 'findRecompeteRow', 'paintRecompeteDrawer', 'fetchRecompeteRow', drawer)(
      { addEventListener() {} }, win, [], el(), el(), el(), () => {},
      (k: string) => (++calls >= paintOnTry ? { nid: k } : null),
      (o: { nid: string }) => { win.__recompeteOpenedId = o.nid; }, () => {});
    const loop = slice('  (function(){ try{ var m=(location.search||\'\').match(/[?&]recompete=([^&]+)/);', '  // Deep-link: /opportunity-map?strategy=');
    new Function('window', 'location', 'setTimeout', loop)(win, { search: '?recompete=CONT_AWD_X' }, (f: () => void) => timers.push(f));
    while (timers.length) timers.shift()!();
    return { events, calls };
  }
  it('row found on the 5th try → 5 drawer calls, ONE listing_open', () => {
    const r = run(5);
    expect(r.calls).toBe(5);
    expect(r.events.filter((e) => e[1] === 'listing_open')).toEqual([['tool_use', 'listing_open', { notice_id: 'CONT_AWD_X', horizon: 'recompete' }]]);
  });
  it('row in memory immediately → one call, one listing_open', () => {
    expect(run(1).events.filter((e) => e[1] === 'listing_open')).toHaveLength(1);
  });
});
