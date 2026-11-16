import { describe, expect, it } from 'vitest';
import {
  MAP_SHELL_NAV_MESSAGE,
  MAP_SHELL_URL_MESSAGE,
  appUrlForMapUrl,
  frameNavTarget,
  isMapShellPanel,
  isShellFrameUrl,
  mapShellSrc,
  parseMapShellMessage,
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
  it('map pages become shell panels; everything else goes to the whole window', () => {
    expect(frameNavTarget('/opportunity-map', '?ss=1')).toEqual({ kind: 'panel', panel: 'map', search: '?ss=1' });
    expect(frameNavTarget('/opportunity-map/saved', '')).toEqual({ kind: 'panel', panel: 'watchlist', search: '' });
    expect(frameNavTarget('/opportunity-map/favorites/', '?shell=app')).toEqual({ kind: 'panel', panel: 'saved', search: '' });
    expect(frameNavTarget('/app', '?panel=dashboard')).toEqual({ kind: 'top', href: '/app?panel=dashboard' });
    expect(frameNavTarget('/opportunity-map/pursuits', '?x=1', '#a')).toEqual({ kind: 'top', href: '/opportunity-map/pursuits?x=1#a' });
    expect(frameNavTarget('/pricing', '')).toEqual({ kind: 'top', href: '/pricing' });
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
});
