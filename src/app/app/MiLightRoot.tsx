'use client';

import { useEffect } from 'react';

/** Adds `mi-light` to <html> while the /app tree is mounted (covers portals). */
export default function MiLightRoot() {
  useEffect(() => {
    const el = document.documentElement;
    el.classList.add('mi-light');
    return () => el.classList.remove('mi-light');
  }, []);
  return null;
}
