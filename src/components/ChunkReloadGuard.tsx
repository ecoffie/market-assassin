'use client';

/**
 * Global chunk-error catcher (Eric 2026-08-05), the belt-and-suspenders companion to global-error.tsx.
 *
 * A ChunkLoadError from a Vercel deploy swap doesn't always reach React's error boundary — a lazy
 * import fired from an event handler, a prefetch, or a CSS chunk can fail OUTSIDE render and surface
 * as a window 'error' / 'unhandledrejection' event that global-error never sees. This listens for
 * those, and on a CHUNK error only, auto-reloads ONCE (same sessionStorage once-guard as
 * global-error, so the two can't double-reload and a real broken build can't loop).
 *
 * Non-chunk errors are left ALONE — they must propagate to the normal boundary / console, never
 * trigger a reload. Mounted once in the root layout.
 */

import { useEffect } from 'react';

const RELOAD_GUARD_KEY = 'mindy_chunk_reloaded';

function isChunkMessage(msg: string): boolean {
  return (
    /ChunkLoadError/i.test(msg) ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /Loading CSS chunk/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /importing a module script failed/i.test(msg)
  );
}

function looksLikeChunkError(err: unknown, fallbackMsg?: string): boolean {
  const name = (err as { name?: string })?.name || '';
  const msg = (err as { message?: string })?.message || fallbackMsg || '';
  if (name === 'ChunkLoadError') return true;
  return isChunkMessage(String(msg));
}

function reloadOnce(): void {
  let already = false;
  try {
    already = sessionStorage.getItem(RELOAD_GUARD_KEY) === '1';
  } catch {
    already = true; // can't persist a guard → don't risk an auto-loop
  }
  if (already) return;
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
  } catch {
    return;
  }
  window.location.reload();
}

export default function ChunkReloadGuard() {
  useEffect(() => {
    // A clean mount with no chunk error means the last reload (if any) succeeded → clear the guard so
    // a LATER deploy in the same tab can auto-recover again. Deferred a tick so we don't clear it out
    // from under an in-flight reload.
    const clear = setTimeout(() => {
      try {
        sessionStorage.removeItem(RELOAD_GUARD_KEY);
      } catch {
        /* noop */
      }
    }, 4000);

    const onError = (e: ErrorEvent) => {
      if (looksLikeChunkError(e.error, e.message)) {
        clearTimeout(clear);
        reloadOnce();
      }
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (looksLikeChunkError(e.reason)) {
        clearTimeout(clear);
        reloadOnce();
      }
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      clearTimeout(clear);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
