'use client';

/**
 * Root error boundary (Eric 2026-08-05). This catches errors ANYWHERE in the React tree — including
 * the root layout, which a segment-level error.tsx cannot — and renders its own <html>/<body> because
 * at this level Next has torn the normal layout down.
 *
 * THE bug it fixes: across a Vercel deploy, a tab still holding the OLD page requests JS chunks by
 * their old content-hash; the new build no longer has those hashes → a ChunkLoadError bubbles up and
 * the user sees Next's raw "This page couldn't load" (Eric hit this on /app at 06:56, mid the
 * forecast-drawer deploy). The page isn't broken — the browser just needs the NEW chunks, which one
 * reload fetches.
 *
 * So: on a CHUNK-LOAD error only, auto-reload ONCE. The once-guard is a sessionStorage stamp keyed to
 * this tab — if the reload lands and the SAME chunk error fires again (a real broken build, not a
 * deploy swap), we do NOT reload a second time; we fall through to the branded fallback. A genuine
 * runtime bug must never become a reload loop. Any NON-chunk error skips the auto-reload entirely and
 * shows the fallback immediately (Reload / Back), which still beats Next's default.
 */

import { useEffect } from 'react';

// A chunk-load failure has a few shapes across browsers/bundlers: the DOMException name
// 'ChunkLoadError', Webpack's "Loading chunk N failed", or the dynamic-import "Failed to fetch
// dynamically imported module". Match any — but NARROWLY, so a normal TypeError never triggers a
// reload. (Everything else is a real error → fallback, no reload.)
function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: string }).name || '';
  const msg = (err as { message?: string }).message || '';
  if (name === 'ChunkLoadError') return true;
  return (
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /Loading CSS chunk/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /importing a module script failed/i.test(msg)
  );
}

const RELOAD_GUARD_KEY = 'mindy_chunk_reloaded';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const chunkError = isChunkLoadError(error);

  useEffect(() => {
    if (!chunkError) return;
    let alreadyReloaded = false;
    try {
      alreadyReloaded = sessionStorage.getItem(RELOAD_GUARD_KEY) === '1';
    } catch {
      // sessionStorage can throw in privacy modes — treat as "not yet reloaded" but the reload below
      // is still safe (a second manual reload is the user's call, not an auto-loop, if the stamp
      // can't persist). To stay loop-safe when we CAN'T persist the guard, do NOT auto-reload.
      alreadyReloaded = true;
    }
    if (alreadyReloaded) return; // reloaded once already (or can't guard) → show the fallback, no loop
    try {
      sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
    } catch {
      return; // couldn't set the guard → don't risk a loop
    }
    // New build's chunks are the fix — a hard reload fetches them.
    window.location.reload();
  }, [chunkError]);

  // Once a fetch succeeds after a reload, clear the guard so a LATER deploy in the same tab can
  // auto-recover again. Runs on any mount that isn't itself mid-reload.
  useEffect(() => {
    if (chunkError) return; // a chunk error is handled by the effect above; don't clear mid-recovery
    try {
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
    } catch {
      /* noop */
    }
  }, [chunkError]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b1020',
          color: '#e6eaf2',
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <div
            aria-hidden
            style={{
              width: 56,
              height: 56,
              margin: '0 auto 20px',
              borderRadius: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg,#1e3a8a,#7c3aed)',
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-6.2-8.6" />
              <path d="M21 3v6h-6" />
            </svg>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px', letterSpacing: '-0.01em' }}>
            {chunkError ? 'Updating to the latest version…' : 'Something went wrong'}
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: '#aab3c5', margin: '0 0 22px' }}>
            {chunkError
              ? 'A new version of Mindy just shipped. Reload to pick it up — your work is safe.'
              : 'This page hit an unexpected error. Reload to try again, or head back.'}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => {
                // The user chose to retry: clear the guard so reset() gets a clean slate, then try the
                // in-place recovery first, falling back to a full reload.
                try {
                  sessionStorage.removeItem(RELOAD_GUARD_KEY);
                } catch {
                  /* noop */
                }
                try {
                  reset();
                } catch {
                  window.location.reload();
                }
              }}
              style={{
                appearance: 'none',
                border: 0,
                cursor: 'pointer',
                background: '#7c3aed',
                color: '#fff',
                fontWeight: 700,
                fontSize: 14,
                padding: '11px 20px',
                borderRadius: 10,
              }}
            >
              Reload
            </button>
            <a
              href="/app"
              style={{
                textDecoration: 'none',
                background: 'transparent',
                color: '#e6eaf2',
                fontWeight: 600,
                fontSize: 14,
                padding: '11px 20px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
              }}
            >
              Go to Mindy
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
