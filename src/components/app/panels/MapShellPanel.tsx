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
 *  - No app-inside-an-app: same-origin link clicks in the frame are handed to us (postMessage), and
 *    every frame LOAD is checked too (covers `location.href = …`). A map page becomes its shell panel;
 *    anything else (/app, /pricing, Pursuits, Markets …) navigates the whole window.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppPanel } from '../UnifiedSidebar';
import {
  MAP_SHELL_NAV_MESSAGE,
  MAP_SHELL_URL_MESSAGE,
  type MapShellPanel as Panel,
  appUrlForMapUrl,
  frameNavTarget,
  isShellFrameUrl,
  mapShellSrc,
  parseMapShellMessage,
  shellPanelForPath,
} from '@/lib/app/map-shell';

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
    // Write the app URL first so the next panel (or this one) reads the map params at mount.
    window.history.replaceState(null, '', appUrlForMapUrl(target.panel, target.search));
    if (target.panel === panel) {
      // Navigate the frame in place (replace: no extra history entry). Re-setting `src` would be a
      // no-op when the string is unchanged and a second load when it is not.
      const next = mapShellSrc(panel, target.search);
      try { frameRef.current?.contentWindow?.location.replace(next); } catch { setSrc(next); }
    } else {
      onPanelChange?.(target.panel);
      // handlePanelChange rewrites the URL to the bare panel — restore the params it carries.
      window.history.replaceState(null, '', appUrlForMapUrl(target.panel, target.search));
    }
  }, [panel, onPanelChange]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const msg = parseMapShellMessage(e.data);
      if (!msg) return;
      if (msg.type === MAP_SHELL_URL_MESSAGE) {
        if (shellPanelForPath(msg.path) !== panel) return;
        const next = appUrlForMapUrl(panel, msg.search);
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
