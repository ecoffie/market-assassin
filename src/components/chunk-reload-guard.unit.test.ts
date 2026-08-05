/**
 * ChunkReloadGuard + global-error auto-recovery (Eric 2026-08-05). The invariants that keep a
 * deploy-swap self-heal from becoming a reload LOOP or from masking a real bug:
 *   1. ONLY a chunk-load error triggers a reload — a plain TypeError/ReferenceError must not.
 *   2. It reloads AT MOST ONCE — a sessionStorage once-guard; if the same chunk error fires after the
 *      reload (a genuinely broken build, not a deploy swap), it must NOT reload again.
 *   3. When the guard can't be persisted (privacy mode → storage throws), it must NOT auto-reload
 *      (fail safe, never loop).
 *   4. Both the boundary (global-error.tsx) and the global listener (ChunkReloadGuard.tsx) share the
 *      SAME guard key, so they can't double-reload each other.
 *
 * The components are 'use client' and touch window/sessionStorage (unavailable in the node test env),
 * so we test a PURE MIRROR of the detector + once-guard against an injected fake storage, then
 * source-assert that the real components wire exactly these invariants.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Pure mirror of the detection + once-guard (must match the components' logic) ──
function isChunkLoadErrorMirror(err: unknown, fallbackMsg?: string): boolean {
  const name = (err as { name?: string })?.name || '';
  const msg = (err as { message?: string })?.message || fallbackMsg || '';
  if (name === 'ChunkLoadError') return true;
  const s = String(msg);
  return (
    /ChunkLoadError/i.test(s) ||
    /Loading chunk [\w-]+ failed/i.test(s) ||
    /Loading CSS chunk/i.test(s) ||
    /Failed to fetch dynamically imported module/i.test(s) ||
    /error loading dynamically imported module/i.test(s) ||
    /importing a module script failed/i.test(s)
  );
}

type FakeStore = { get: (k: string) => string | null; set: (k: string, v: string) => void };
function reloadOnceMirror(store: FakeStore | null, doReload: () => void): void {
  let already = false;
  try {
    already = (store ? store.get('mindy_chunk_reloaded') : null) === '1';
    if (!store) throw new Error('no storage'); // simulate "can't persist" → fail safe
  } catch {
    already = true;
  }
  if (already) return;
  try {
    store!.set('mindy_chunk_reloaded', '1');
  } catch {
    return;
  }
  doReload();
}

describe('chunk detector — only real chunk errors, nothing else', () => {
  it('matches every known chunk-load shape', () => {
    expect(isChunkLoadErrorMirror({ name: 'ChunkLoadError', message: 'x' })).toBe(true);
    expect(isChunkLoadErrorMirror({ message: 'Loading chunk 483 failed.' })).toBe(true);
    expect(isChunkLoadErrorMirror({ message: 'Loading CSS chunk 12 failed' })).toBe(true);
    expect(isChunkLoadErrorMirror({ message: 'Failed to fetch dynamically imported module: https://x/y.js' })).toBe(true);
    expect(isChunkLoadErrorMirror({ message: 'error loading dynamically imported module' })).toBe(true);
    expect(isChunkLoadErrorMirror(null, 'Importing a module script failed.')).toBe(true);
  });
  it('does NOT match ordinary runtime errors (those must reach the normal boundary, never reload)', () => {
    expect(isChunkLoadErrorMirror({ name: 'TypeError', message: "Cannot read properties of undefined (reading 'x')" })).toBe(false);
    expect(isChunkLoadErrorMirror({ name: 'ReferenceError', message: 'foo is not defined' })).toBe(false);
    expect(isChunkLoadErrorMirror({ message: 'Network request failed' })).toBe(false);
    expect(isChunkLoadErrorMirror(null)).toBe(false);
    expect(isChunkLoadErrorMirror(undefined)).toBe(false);
  });
});

describe('once-guard — reload at most once, fail safe without storage', () => {
  it('reloads on the FIRST chunk error, then never again (no loop)', () => {
    const mem: Record<string, string> = {};
    const store: FakeStore = { get: (k) => mem[k] ?? null, set: (k, v) => { mem[k] = v; } };
    let reloads = 0;
    reloadOnceMirror(store, () => reloads++); // first chunk error
    reloadOnceMirror(store, () => reloads++); // reload landed, SAME error fires again → broken build
    reloadOnceMirror(store, () => reloads++);
    expect(reloads).toBe(1); // exactly one auto-reload, ever
  });
  it('does NOT auto-reload when storage is unavailable (privacy mode → fail safe, no loop)', () => {
    let reloads = 0;
    reloadOnceMirror(null, () => reloads++);
    expect(reloads).toBe(0);
  });
});

describe('the real components wire these invariants', () => {
  const dir = __dirname;
  const guard = readFileSync(join(dir, 'ChunkReloadGuard.tsx'), 'utf8');
  const globalErr = readFileSync(join(dir, '..', 'app', 'global-error.tsx'), 'utf8');

  it('both files share the SAME once-guard key (so they cannot double-reload)', () => {
    expect(guard).toContain("'mindy_chunk_reloaded'");
    expect(globalErr).toContain("'mindy_chunk_reloaded'");
  });
  it('ChunkReloadGuard listens for window error + unhandledrejection and reloads once', () => {
    expect(guard).toContain("window.addEventListener('error'");
    expect(guard).toContain("window.addEventListener('unhandledrejection'");
    expect(guard).toContain('window.location.reload()');
    // guarded: sets the stamp before reloading (the reloadOnce helper)
    expect(guard).toMatch(/setItem\(RELOAD_GUARD_KEY, ?'1'\)[\s\S]{0,120}window\.location\.reload\(\)/);
  });
  it('global-error auto-reloads ONLY on a chunk error (non-chunk → fallback, no reload)', () => {
    expect(globalErr).toContain('isChunkLoadError');
    // the auto-reload effect bails immediately when it's NOT a chunk error, and the reload is the last
    // statement of that same effect — so a non-chunk error can never reach reload().
    expect(globalErr).toMatch(/if \(!chunkError\) return;[\s\S]{0,900}window\.location\.reload\(\)/);
  });
  it('ChunkReloadGuard is mounted in the root layout', () => {
    const layout = readFileSync(join(dir, '..', 'app', 'layout.tsx'), 'utf8');
    expect(layout).toContain('ChunkReloadGuard');
    expect(layout).toMatch(/<ChunkReloadGuard\s*\/>/);
  });
});
