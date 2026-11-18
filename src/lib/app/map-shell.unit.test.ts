import { describe, expect, it } from 'vitest';
import {
  MAP_SHELL_NAV_MESSAGE,
  MAP_SHELL_URL_MESSAGE,
  MAP_SHELL_SELECTED_OPP_MESSAGE,
  appUrlForMapUrl,
  IN_APP_PATH_RE,
  framePageForPath,
  frameNavTarget,
  isMapShellPanel,
  isShellFrameUrl,
  mapShellSrc,
  parseMapShellMessage,
  parseMapSelectedOppMessage,
  shellPanelForPath,
} from './map-shell';

describe('map shell — app URL → frame src', () => {
  it('bare panel → the map in shell mode', () => {
    expect(mapShellSrc('map', '?panel=map')).toBe('/opportunity-map?shell=app');
    expect(mapShellSrc('map', '')).toBe('/opportunity-map?shell=app');
    expect(mapShellSrc('watchlist', '?panel=watchlist')).toBe('/opportunity-map/saved?shell=app');
    expect(mapShellSrc('saved', '?panel=saved')).toBe('/opportunity-map/favorites?shell=app');
  });

  it('forwards every map param VERBATIM (order + encoding) and adds nothing about the reader', () => {
    expect(mapShellSrc('map', '?panel=map&opp=abc123&src=share&sh=u-1'))
      .toBe('/opportunity-map?opp=abc123&src=share&sh=u-1&shell=app');
    expect(mapShellSrc('map', '?panel=map&recompete=W912%2FX&mode=recompete'))
      .toBe('/opportunity-map?recompete=W912%2FX&mode=recompete&shell=app');
    expect(mapShellSrc('map', '?ss=9f&panel=map&q=road+repair&naics=237310&state=VA&agency=Navy'))
      .toBe('/opportunity-map?ss=9f&q=road+repair&naics=237310&state=VA&agency=Navy&shell=app');
    for (const k of ['forecast=fc-1', 'company=ABC123DEF456', 'buyer=77', 'horizon=open,recompete']) {
      expect(mapShellSrc('map', `?panel=map&${k}`)).toBe(`/opportunity-map?${k}&shell=app`);
    }
  });

  it('a record link stays a record link — no state/naics is ever added', () => {
    const src = mapShellSrc('map', '?panel=map&opp=0123456789abcdef0123456789abcdef');
    expect(src).not.toMatch(/[?&](naics|state|agency|subAgency)=/);
  });

  it('drops the app\'s own keys, a stale shell and never forwards embed', () => {
    expect(mapShellSrc('map', '?panel=map&email=a%40b.com&embed=1&shell=app&notice=x&opp=1'))
      .toBe('/opportunity-map?opp=1&shell=app');
  });
});

describe('map shell — frame URL → app URL (mirroring)', () => {
  it('panel leads, map params follow verbatim, shell/embed dropped', () => {
    expect(appUrlForMapUrl('map', '?q=cyber&horizon=open&shell=app')).toBe('/app?panel=map&q=cyber&horizon=open');
    expect(appUrlForMapUrl('map', '?shell=app')).toBe('/app?panel=map');
    expect(appUrlForMapUrl('map', '')).toBe('/app?panel=map');
    expect(appUrlForMapUrl('watchlist', '?shell=app')).toBe('/app?panel=watchlist');
  });

  it('round-trips: app → frame → app is the identity on map params', () => {
    const app = '?panel=map&opp=abc&agency=Department%20of%20the%20Navy&q=a+b';
    const frame = mapShellSrc('map', app);
    expect(appUrlForMapUrl('map', frame.slice(frame.indexOf('?')))).toBe(`/app${app}`);
  });
});

describe('map shell — navigations that start in the frame', () => {
  it('every map action stays in the app: map pages in the frame, app links and pricing as tabs', () => {
    expect(frameNavTarget('/opportunity-map', '?ss=1')).toEqual({ kind: 'panel', panel: 'map', view: null, search: '?ss=1' });
    expect(frameNavTarget('/opportunity-map/saved', '')).toEqual({ kind: 'panel', panel: 'watchlist', view: null, search: '' });
    expect(frameNavTarget('/opportunity-map/favorites/', '?shell=app')).toEqual({ kind: 'panel', panel: 'saved', view: null, search: '' });
    // map sub-pages open inside the Map panel's frame
    expect(frameNavTarget('/opportunity-map/pursuits', '?x=1', '#a')).toEqual({ kind: 'panel', panel: 'map', view: 'pursuits', search: '?x=1' });
    expect(frameNavTarget('/opportunity-map/proposal', '?pursuit=7')).toEqual({ kind: 'panel', panel: 'map', view: 'proposal', search: '?pursuit=7' });
    expect(frameNavTarget('/opportunity-map/unplaced', '')).toEqual({ kind: 'panel', panel: 'map', view: 'forecasts', search: '' });
    // app links switch tabs in place
    expect(frameNavTarget('/app', '?panel=dashboard')).toEqual({ kind: 'app', panel: 'dashboard', search: '?panel=dashboard' });
    expect(frameNavTarget('/app', '?panel=settings&section=billing')).toEqual({ kind: 'app', panel: 'settings', search: '?panel=settings&section=billing' });
    expect(frameNavTarget('/app', '?panel=watchlist')).toEqual({ kind: 'panel', panel: 'watchlist', view: null, search: '' });
    expect(frameNavTarget('/app', '?panel=map&mview=vault&opp=1')).toEqual({ kind: 'panel', panel: 'map', view: 'vault', search: '?opp=1' });
    expect(frameNavTarget('/pricing', '')).toEqual({ kind: 'app', panel: 'settings', search: '?panel=settings&section=billing' });
    // unknown pages are never framed (no reload loop)
    expect(frameNavTarget('/opportunity-map/og', '')).toEqual({ kind: 'top', href: '/opportunity-map/og' });
    expect(frameNavTarget('/learn', '')).toEqual({ kind: 'top', href: '/learn' });
  });

  it('a map sub-page round-trips through the app URL (reload keeps it)', () => {
    const app = appUrlForMapUrl('map', '?pursuit=7', 'proposal');
    expect(app).toBe('/app?panel=map&mview=proposal&pursuit=7');
    expect(mapShellSrc('map', app.slice(app.indexOf('?')))).toBe('/opportunity-map/proposal?pursuit=7&shell=app');
    expect(mapShellSrc('map', '?panel=map&mview=bogus')).toBe('/opportunity-map?shell=app');
    expect(isShellFrameUrl('/opportunity-map/pursuits', '?shell=app')).toBe(true);
    expect(framePageForPath('/opportunity-map/market')).toEqual({ panel: 'map', view: 'market' });
    expect(IN_APP_PATH_RE.test('/opportunity-map/pursuits')).toBe(true);
    expect(IN_APP_PATH_RE.test('/reports/abc')).toBe(false);
  });

  it('recognises a frame that is already in shell mode', () => {
    expect(isShellFrameUrl('/opportunity-map', '?opp=1&shell=app')).toBe(true);
    expect(isShellFrameUrl('/opportunity-map', '?opp=1')).toBe(false);
    expect(isShellFrameUrl('/app', '?shell=app')).toBe(false);
    expect(shellPanelForPath('/opportunity-map/market')).toBeNull();
  });

  it('panel ids', () => {
    expect(['map', 'watchlist', 'saved'].every(isMapShellPanel)).toBe(true);
    expect(isMapShellPanel('dashboard')).toBe(false);
    expect(isMapShellPanel(null)).toBe(false);
  });
});

describe('map shell — message validation', () => {
  it('accepts the two shapes the frame sends', () => {
    expect(parseMapShellMessage({ type: MAP_SHELL_URL_MESSAGE, path: '/opportunity-map', search: '?q=x' }))
      .toEqual({ type: MAP_SHELL_URL_MESSAGE, path: '/opportunity-map', search: '?q=x', hash: '' });
    expect(parseMapShellMessage({ type: MAP_SHELL_NAV_MESSAGE, path: '/app', search: '', hash: '#x' })?.hash).toBe('#x');
  });

  it('rejects anything else, including protocol-relative paths', () => {
    for (const bad of [null, 'x', {}, { type: 'other', path: '/', search: '' },
      { type: MAP_SHELL_NAV_MESSAGE, path: '//evil.com', search: '' },
      { type: MAP_SHELL_NAV_MESSAGE, path: 'https://evil.com', search: '' },
      { type: MAP_SHELL_NAV_MESSAGE, path: '/\\evil.com', search: '' },
      { type: MAP_SHELL_NAV_MESSAGE, path: '/a', search: 'q=1' }]) {
      expect(parseMapShellMessage(bad)).toBeNull();
    }
  });

  it('accepts a SAM notice selection and a clear, rejects non-SAM ids', () => {
    const id = '6ba812a7e0284f79bc44c4932777c340';
    expect(parseMapSelectedOppMessage({ type: MAP_SHELL_SELECTED_OPP_MESSAGE, id: id.toUpperCase(), title: 'T', deadline: 'd' }))
      .toEqual({ type: MAP_SHELL_SELECTED_OPP_MESSAGE, id, title: 'T', deadline: 'd' });
    expect(parseMapSelectedOppMessage({ type: MAP_SHELL_SELECTED_OPP_MESSAGE, id: null, title: '', deadline: '' })?.id).toBeNull();
    expect(parseMapSelectedOppMessage({ type: MAP_SHELL_SELECTED_OPP_MESSAGE, id: 'N0016426R0012', title: '', deadline: '' })).toBeNull();
    expect(parseMapShellMessage({ type: MAP_SHELL_SELECTED_OPP_MESSAGE, id, title: '', deadline: '' })).toBeNull();
  });
});
