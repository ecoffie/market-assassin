'use client';

/**
 * Map / Watchlist / Saved inside the app shell (Option A, 2026-11-16).
 *
 * Renders the EXISTING map pages in a full-height, borderless, same-origin iframe in `?shell=app`
 * mode (the map hides only its own top bar + icon rail). The app keeps its top bar and sidebar.
 *
 *  - Deep links: `/app?panel=map&<map params>` → the iframe src carries the map params verbatim
 *    (src/lib/app/map-shell.ts — record links stay record links; nothing about the reader is added).
 *  - Mirroring: the framed map posts its URL whenever it rewrites it; we replaceState the app URL to
 *    match (never push — the frame's own history entries already sit in the joint session history),
 *    so reload / share / copy keep the view. The iframe src is NOT re-set on a mirror, so the map is
 *    never reloaded by its own URL change.
 *  - Every map action stays inside /app: same-origin link clicks and window.open() calls in the frame
 *    are handed to us (postMessage), and every frame LOAD is checked too (covers `location.href = …`).
 *    A map page (incl. Pursuits, Proposal workspace, Reports, Vault, Forecasts, Market) is shown in
 *    the frame; /app?panel=X switches to that app tab in place; /pricing opens Settings › Billing.
 *  - Clicking "Map" in the sidebar while a map sub-page is showing returns the frame to the map
 *    (`mindy:map-shell-home` event from the app page).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppPanel } from '../UnifiedSidebar';
import {
  MAP_SHELL_NAV_MESSAGE,
  MAP_SHELL_URL_MESSAGE,
  type MapShellPanel as Panel,
  MAP_SHELL_HOME_EVENT,
  appUrlForMapUrl,
  framePageForPath,
  frameNavTarget,
  isShellFrameUrl,
  mapShellSrc,
  mapViewOf,
  parseMapShellMessage,
} from '@/lib/app/map-shell';
import { parseAppDeepLink } from '@/lib/app/deep-link-params';
import { isKnownPanel } from '@/lib/app/known-panels';

const TITLES: Record<Panel, string> = {
  map: 'Opportunity Map',
  watchlist: 'Watchlist — saved searches and new matches',
  saved: 'Saved opportunities',
};

interface Props {
  panel: Panel;
  onPanelChange?: (panel: AppPanel, context?: Record<string, unknown>) => void;
}

export default function MapShellPanel({ panel, onPanelChange }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  // The src is computed ONCE per panel mount from the app URL (deep link). Mirrors never change it.
  const [src, setSrc] = useState<string>(() =>
    mapShellSrc(panel, typeof window === 'undefined' ? '' : window.location.search),
  );

  const go = useCallback((path: string, search: string, hash = '') => {
    const target = frameNavTarget(path, search, hash);
    if (target.kind === 'top') {
      window.location.assign(target.href);
      return;
    }
    if (target.kind === 'app') {
      const appPanel = target.panel;
      if (!isKnownPanel(appPanel)) {
        window.location.assign(`/app${target.search}`);
        return;
      }
      // Another app tab, switched in place. The panel reads its deep-link context (section,
      // pursuit_id, agency …) from the same parser the app uses for a cold /app?panel= load.
      const params = new URLSearchParams(target.search);
      onPanelChange?.(appPanel, { ...parseAppDeepLink(target.panel, params), from: 'map' });
      window.history.replaceState(null, '', `/app${target.search}`);
      return;
    }
    // Write the app URL first so the next panel (or this one) reads the map params at mount.
    const appUrl = appUrlForMapUrl(target.panel, target.search, target.view);
    window.history.replaceState(null, '', appUrl);
    if (target.panel === panel) {
      // Navigate the frame in place (replace: no extra history entry). Re-setting `src` would be a
      // no-op when the string is unchanged and a second load when it is not.
      const next = mapShellSrc(panel, appUrl.slice(appUrl.indexOf('?')));
      try { frameRef.current?.contentWindow?.location.replace(next); } catch { setSrc(next); }
    } else {
      onPanelChange?.(target.panel);
      // handlePanelChange rewrites the URL to the bare panel — restore the params it carries.
      window.history.replaceState(null, '', appUrl);
    }
  }, [panel, onPanelChange]);

  // Sidebar "Map" while a map sub-page (Pursuits, Proposal …) is showing → back to the map itself.
  useEffect(() => {
    if (panel !== 'map') return;
    const onHome = () => {
      if (!mapViewOf(window.location.search)) return; // already on the map — keep the user's view
      go('/opportunity-map', '');
    };
    window.addEventListener(MAP_SHELL_HOME_EVENT, onHome);
    return () => window.removeEventListener(MAP_SHELL_HOME_EVENT, onHome);
  }, [panel, go]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const msg = parseMapShellMessage(e.data);
      if (!msg) return;
      if (msg.type === MAP_SHELL_URL_MESSAGE) {
        const page = framePageForPath(msg.path);
        if (!page || page.panel !== panel) return;
        const next = appUrlForMapUrl(panel, msg.search, page.view);
        if (window.location.pathname + window.location.search !== next) {
          window.history.replaceState(window.history.state, '', next);
        }
      } else if (msg.type === MAP_SHELL_NAV_MESSAGE) {
        go(msg.path, msg.search, msg.hash);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [panel, go]);

  // Safety net for navigations the click bridge cannot see (scripted location changes).
  const onLoad = useCallback(() => {
    let loc: Location | null = null;
    try { loc = frameRef.current?.contentWindow?.location ?? null; } catch { return; }
    if (!loc || loc.href === 'about:blank') return;
    if (isShellFrameUrl(loc.pathname, loc.search)) return;
    go(loc.pathname, loc.search, loc.hash);
  }, [go]);

  return (
    <iframe
      ref={frameRef}
      key={panel}
      src={src}
      title={TITLES[panel]}
      onLoad={onLoad}
      data-testid={`map-shell-${panel}`}
      className="block w-full h-full flex-1 min-h-0 border-0 bg-white"
      allow="geolocation; clipboard-write"
    />
  );
}
