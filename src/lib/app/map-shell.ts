/**
 * The Opportunity Map inside the signed-in app (Option A, 2026-11-16).
 *
 * `/app?panel=map` shows the EXISTING map route in a same-origin iframe, in `?shell=app` mode: the
 * map hides only its own site top bar (.zhead) and icon rail (.zrail) and keeps everything else.
 * Watchlist and Saved open the map's own sub-pages the same way. Nothing about the map's data, boot
 * or performance changes — the map still owns its URL, its fetch rounds and return continuity.
 *
 * This module is the ONE place that translates between the two addresses:
 *   app URL  /app?panel=map&opp=X        ⇄  frame URL  /opportunity-map?opp=X&shell=app
 *
 * ⚠️ Record links vs market links (docs/engineering/record-links-vs-market-links.md): map params are
 * forwarded VERBATIM, in their original order and encoding. Nothing about the reader is ever added
 * here — a record link (`?opp=`) that gained a profile filter on the way in could delete its record.
 * Only the app's own keys are dropped, plus `embed`, which would switch the map into a different
 * (static, filter-less) mode.
 *
 * Pure: no window, no DOM — unit-tested in map-shell.unit.test.ts.
 */

export type MapShellPanel = 'map' | 'watchlist' | 'saved';

/** The map page each shell panel renders. */
export const MAP_SHELL_PATHS: Readonly<Record<MapShellPanel, string>> = {
  map: '/opportunity-map',
  watchlist: '/opportunity-map/saved',
  saved: '/opportunity-map/favorites',
};

/** The mode flag the map route reads. Never `embed` — that is the /today hero's static map. */
export const SHELL_PARAM = 'shell';
export const SHELL_VALUE = 'app';

/** postMessage types the framed map sends to /app. Same-origin only (checked on both ends). */
export const MAP_SHELL_URL_MESSAGE = 'mindy:map-shell-url';
export const MAP_SHELL_NAV_MESSAGE = 'mindy:map-shell-nav';

/** Keys that belong to /app (or to the shell itself) and must never reach the map's URL. */
const APP_ONLY_KEYS = new Set(['panel', SHELL_PARAM, 'embed', 'email', 'reset', 'setup', 'signup', 'next', 'notice', 'section', 'keyword']);

export function isMapShellPanel(panel: unknown): panel is MapShellPanel {
  return panel === 'map' || panel === 'watchlist' || panel === 'saved';
}

/** The shell panel that renders a map path, or null for any other path. */
export function shellPanelForPath(pathname: string): MapShellPanel | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  for (const [panel, path] of Object.entries(MAP_SHELL_PATHS) as [MapShellPanel, string][]) {
    if (p === path) return panel;
  }
  return null;
}

/** Split a raw query string into its `key=value` parts WITHOUT re-encoding them. */
function rawParts(search: string): string[] {
  const s = search.startsWith('?') ? search.slice(1) : search;
  return s ? s.split('&').filter(Boolean) : [];
}

const keyOf = (part: string): string => {
  const k = part.split('=')[0];
  try { return decodeURIComponent(k.replace(/\+/g, ' ')); } catch { return k; }
};

/** The query string (with leading `?`, or '') minus the given keys, everything else verbatim. */
function withoutKeys(search: string, drop: ReadonlySet<string>): string {
  const keep = rawParts(search).filter((p) => !drop.has(keyOf(p)));
  return keep.length ? `?${keep.join('&')}` : '';
}

/**
 * The iframe src for a shell panel, given the APP's query string. Every map param passes through
 * unchanged; the app's own keys are dropped; `shell=app` is appended.
 */
export function mapShellSrc(panel: MapShellPanel, appSearch: string): string {
  const rest = withoutKeys(appSearch, APP_ONLY_KEYS);
  const sep = rest ? '&' : '?';
  return `${MAP_SHELL_PATHS[panel]}${rest}${sep}${SHELL_PARAM}=${SHELL_VALUE}`;
}

/**
 * The /app URL that mirrors the map's own URL, so reload / share / copy keep the view.
 * `panel` leads; the map's params follow verbatim minus `shell`/`embed`.
 */
export function appUrlForMapUrl(panel: MapShellPanel, mapSearch: string): string {
  const rest = withoutKeys(mapSearch, new Set([SHELL_PARAM, 'embed', 'panel']));
  return `/app?panel=${panel}${rest ? `&${rest.slice(1)}` : ''}`;
}

/** True when a frame URL is already in shell mode (so it renders without its own chrome). */
export function isShellFrameUrl(pathname: string, search: string): boolean {
  return shellPanelForPath(pathname) !== null
    && rawParts(search).some((p) => keyOf(p) === SHELL_PARAM && p.slice(p.indexOf('=') + 1) === SHELL_VALUE);
}

export type FrameNavTarget =
  | { kind: 'panel'; panel: MapShellPanel; search: string }
  | { kind: 'top'; href: string };

/**
 * Where a navigation that STARTED inside the framed map should land, so the app never ends up
 * nested inside itself. A map page → the matching shell panel (in the frame); anything else on our
 * origin (/app, /pricing, /opportunity-map/pursuits …) → the whole window.
 */
export function frameNavTarget(pathname: string, search: string, hash = ''): FrameNavTarget {
  const panel = shellPanelForPath(pathname);
  if (panel) return { kind: 'panel', panel, search: withoutKeys(search, new Set([SHELL_PARAM, 'embed'])) };
  return { kind: 'top', href: `${pathname}${search}${hash}` };
}

export interface MapShellMessage {
  type: typeof MAP_SHELL_URL_MESSAGE | typeof MAP_SHELL_NAV_MESSAGE;
  path: string;
  search: string;
  hash?: string;
}

/** Shape check for a message from the framed map (origin + source are checked by the caller). */
export function parseMapShellMessage(data: unknown): MapShellMessage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type !== MAP_SHELL_URL_MESSAGE && d.type !== MAP_SHELL_NAV_MESSAGE) return null;
  if (typeof d.path !== 'string' || !d.path.startsWith('/') || d.path.startsWith('//')) return null;
  if (typeof d.search !== 'string' || (d.search && !d.search.startsWith('?'))) return null;
  const hash = typeof d.hash === 'string' && (d.hash === '' || d.hash.startsWith('#')) ? d.hash : '';
  if (/[\s\\]/.test(d.path)) return null;
  return { type: d.type, path: d.path, search: d.search, hash };
}
