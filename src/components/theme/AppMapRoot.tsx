'use client';

import { useEffect } from 'react';

/**
 * Mirrors the /app-only Opportunity Map look (`mi-app` + the font-variable classes) onto
 * <html> while the /app tree is mounted, so portals/modals rendered into <body> match.
 * Removed on unmount so other routes in the same SPA session are untouched.
 */
export default function AppMapRoot({ classes }: { classes: string }) {
  useEffect(() => {
    const el = document.documentElement;
    const list = ['mi-app', ...classes.split(/\s+/).filter(Boolean)];
    el.classList.add(...list);
    return () => el.classList.remove(...list);
  }, [classes]);
  return null;
}
