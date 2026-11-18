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

/**
 * The map's OTHER pages (Pursuits, Proposal workspace, Reports, Vault, Forecasts, Market). Inside the
 * app they open IN the Map panel's frame (shell mode) instead of a new tab or a full-page jump, so a
 * map action never leaves /app. The app URL carries which one as `mview`, so reload keeps it.
 * `unplaced` is the retired alias of `forecasts` (its route 308s there).
 */
export const MAP_SUBPAGES = ['pursuits', 'proposal', 'reports', 'vault', 'forecasts', 'market'] as const;
export type MapSubpage = (typeof MAP_SUBPAGES)[number];
export const MAP_VIEW_PARAM = 'mview';
const SUBPAGE_ALIASES: Readonly<Record<string, MapSubpage>> = { unplaced: 'forecasts' };

export function isMapSubpage(v: unknown): v is MapSubpage {
  return typeof v === 'string' && (MAP_SUBPAGES as readonly string[]).includes(v);
}

/** The map sub-page a path renders (`/opportunity-map/pursuits` → 'pursuits'), or null. */
export function mapSubpageForPath(pathname: string): MapSubpage | null {
  const m = /^\/opportunity-map\/([a-z]+)\/?$/.exec(pathname);
  if (!m) return null;
  const name = SUBPAGE_ALIASES[m[1]] ?? m[1];
  return isMapSubpage(name) ? name : null;
}

/** The mode flag the map route reads. Never `embed` — that is the /today hero's static map. */
export const SHELL_PARAM = 'shell';
export const SHELL_VALUE = 'app';

/** postMessage types the framed map sends to /app. Same-origin only (checked on both ends). */
export const MAP_SHELL_URL_MESSAGE = 'mindy:map-shell-url';
export const MAP_SHELL_NAV_MESSAGE = 'mindy:map-shell-nav';
/**
 * iframe → parent: the open SAM listing changed (`window.__selectedOpp`). Parent persists it so
 * Ask Mindy can attach that notice when the customer opens Chat — no second chat engine.
 */
export const MAP_SHELL_SELECTED_OPP_MESSAGE = 'mindy:map-shell-selected-opp';
/** Window event the app page fires when the active map panel's sidebar item is clicked again. */
export const MAP_SHELL_HOME_EVENT = 'mindy:map-shell-home';

/** Keys that belong to /app (or to the shell itself) and must never reach the map's URL. */
const APP_ONLY_KEYS = new Set(['panel', MAP_VIEW_PARAM, SHELL_PARAM, 'embed', 'email', 'reset', 'setup', 'signup', 'next', 'notice', 'section', 'keyword']);

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
  const view = panel === 'map' ? mapViewOf(appSearch) : null;
  const path = view ? `/opportunity-map/${view}` : MAP_SHELL_PATHS[panel];
  return `${path}${rest}${sep}${SHELL_PARAM}=${SHELL_VALUE}`;
}

/** The valid `mview` in an app query string, or null (unknown values open the map itself). */
export function mapViewOf(appSearch: string): MapSubpage | null {
  const part = rawParts(appSearch).find((p) => keyOf(p) === MAP_VIEW_PARAM);
  if (!part) return null;
  const v = part.slice(part.indexOf('=') + 1);
  return isMapSubpage(v) ? v : null;
}

/**
 * The /app URL that mirrors the map's own URL, so reload / share / copy keep the view.
 * `panel` leads; the map's params follow verbatim minus `shell`/`embed`.
 */
export function appUrlForMapUrl(panel: MapShellPanel, mapSearch: string, view: MapSubpage | null = null): string {
  const rest = withoutKeys(mapSearch, new Set([SHELL_PARAM, 'embed', 'panel', MAP_VIEW_PARAM]));
  const v = panel === 'map' && view ? `&${MAP_VIEW_PARAM}=${view}` : '';
  return `/app?panel=${panel}${v}${rest ? `&${rest.slice(1)}` : ''}`;
}

/** Which shell panel (+ map sub-page) renders a frame path, or null when no shell page does. */
export function framePageForPath(pathname: string): { panel: MapShellPanel; view: MapSubpage | null } | null {
  const panel = shellPanelForPath(pathname);
  if (panel) return { panel, view: null };
  const view = mapSubpageForPath(pathname);
  return view ? { panel: 'map', view } : null;
}

/** True when a frame URL is already in shell mode (so it renders without its own chrome). */
export function isShellFrameUrl(pathname: string, search: string): boolean {
  return framePageForPath(pathname) !== null
    && rawParts(search).some((p) => keyOf(p) === SHELL_PARAM && p.slice(p.indexOf('=') + 1) === SHELL_VALUE);
}

export type FrameNavTarget =
  | { kind: 'panel'; panel: MapShellPanel; view: MapSubpage | null; search: string }
  | { kind: 'app'; panel: string; search: string }
  | { kind: 'top'; href: string };

/**
 * Where a navigation that STARTED inside the framed map should land. Every map action stays inside
 * /app (owner rule, 2026-11-16):
 *  - a map page (the map, Watchlist, Saved, or a map sub-page such as Pursuits) → shown in the frame;
 *  - `/app?panel=X…` → that app tab, switched in place (no reload, the app never nests in itself);
 *  - `/pricing` → the Billing tab of Settings;
 *  - anything else on our origin (a hosted report, /learn …) → the whole window (`top`). The frame's
 *    click bridge opens those in a NEW tab before they ever get here, so this is only the fallback
 *    for scripted navigations.
 */
export function frameNavTarget(pathname: string, search: string, hash = ''): FrameNavTarget {
  const page = framePageForPath(pathname);
  if (page) {
    return { kind: 'panel', panel: page.panel, view: page.view, search: withoutKeys(search, new Set([SHELL_PARAM, 'embed'])) };
  }
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/app') {
    const part = rawParts(search).find((x) => keyOf(x) === 'panel');
    const panel = part ? part.slice(part.indexOf('=') + 1) : 'dashboard';
    if (isMapShellPanel(panel)) {
      const view = panel === 'map' ? mapViewOf(search) : null;
      return { kind: 'panel', panel, view, search: withoutKeys(search, new Set(['panel', MAP_VIEW_PARAM, SHELL_PARAM, 'embed'])) };
    }
    if (/^[a-z][a-z-]{0,39}$/.test(panel)) return { kind: 'app', panel, search: search || '' };
  }
  if (p === '/pricing') return { kind: 'app', panel: 'settings', search: '?panel=settings&section=billing' };
  return { kind: 'top', href: `${pathname}${search}${hash}` };
}

/** Same-origin paths the frame hands to the app instead of opening a new tab (mirrored in APP_SHELL_JS). */
export const IN_APP_PATH_RE = /^\/(app|pricing|opportunity-map)(\/|$)/;

export interface MapShellMessage {
  type: typeof MAP_SHELL_URL_MESSAGE | typeof MAP_SHELL_NAV_MESSAGE;
  path: string;
  search: string;
  hash?: string;
}

export interface MapShellSelectedOppMessage {
  type: typeof MAP_SHELL_SELECTED_OPP_MESSAGE;
  /** 32-hex lowercase SAM notice id, or null when the listing drawer closed / non-SAM pin. */
  id: string | null;
  title: string;
  deadline: string;
}

const NOTICE_ID = /^[0-9a-f]{32}$/;

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

/** Shape check for the selected-opportunity bridge (origin + source checked by the caller). */
export function parseMapSelectedOppMessage(data: unknown): MapShellSelectedOppMessage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type !== MAP_SHELL_SELECTED_OPP_MESSAGE) return null;
  if (d.id !== null && typeof d.id !== 'string') return null;
  const id = typeof d.id === 'string' ? d.id.toLowerCase() : null;
  if (id !== null && !NOTICE_ID.test(id)) return null;
  return {
    type: MAP_SHELL_SELECTED_OPP_MESSAGE,
    id,
    title: typeof d.title === 'string' ? d.title.slice(0, 300) : '',
    deadline: typeof d.deadline === 'string' ? d.deadline.slice(0, 40) : '',
  };
}
