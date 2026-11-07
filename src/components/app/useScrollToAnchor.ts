'use client';

import { useEffect, useRef, useState } from 'react';

export type AnchorScrollState = 'idle' | 'waiting' | 'found' | 'missing';

/**
 * Scroll ONCE to `anchorId` when a deep link names a section. Panels render their sections
 * after data loads, so the element may not exist on the first paint — poll briefly, then give
 * up and report `missing` (the caller says so instead of pretending it landed).
 *
 * Latches after the first successful scroll: if the caller's anchor later changes (a section
 * re-renders under a different id as the user works), we never yank the page again.
 */
export function useScrollToAnchor(anchorId: string | null, timeoutMs = 8000): AnchorScrollState {
  // The result is keyed to the anchor it was produced for, so a new anchor reads 'waiting'
  // without a synchronous setState in the effect.
  const [result, setResult] = useState<{ anchor: string; state: 'found' | 'missing' } | null>(null);

  const landedRef = useRef(false);

  useEffect(() => {
    if (!anchorId || landedRef.current || typeof document === 'undefined') return;
    let cancelled = false;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (cancelled) return;
      const el = document.getElementById(anchorId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        landedRef.current = true;
        setResult({ anchor: anchorId, state: 'found' });
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        setResult({ anchor: anchorId, state: 'missing' });
        return;
      }
      timer = setTimeout(tick, 250);
    };
    timer = setTimeout(tick, 50);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [anchorId, timeoutMs]);

  if (result?.state === 'found') return 'found';
  if (!anchorId) return 'idle';
  return result && result.anchor === anchorId ? result.state : 'waiting';
}
