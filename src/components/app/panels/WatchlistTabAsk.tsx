'use client';

/**
 * Ask Mindy on the Saved searches tab (Watchlist). The caller renders this ONLY when isTabAskEnabled().
 *
 * The tab's list lives in the framed Watchlist page (same origin, see saved/tab-ask-bridge.ts). The page
 * reports the saved searches it loaded; a question is parsed by the shared box (canonical discovery), the
 * adapter turns it into facets, and the matching ids go back to the page, which re-renders its OWN cards.
 * Clear sends `null` and the page shows every search again — no request either way.
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import TabAskBox from '@/components/app/TabAskBox';
import type { TabAskCount } from '@/lib/app/tab-ask';
import {
  WATCHLIST_ASK_MESSAGE,
  matchSavedSearches,
  parseWatchlistSearchesMessage,
  savedSearchesAskAdapter,
  type SavedSearchLite,
  type SavedSearchesAskParams,
} from '@/lib/app/tab-ask-adapters/saved-searches';

/** How long a question waits for the page to report its list (it may still be loading). */
export const WATCHLIST_LIST_WAIT_MS = 8000;

export default function WatchlistTabAsk({ frameRef }: { frameRef: RefObject<HTMLIFrameElement | null> }) {
  const listRef = useRef<SavedSearchLite[] | null>(null);
  const waiters = useRef<Array<(l: SavedSearchLite[]) => void>>([]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const list = parseWatchlistSearchesMessage(e.data);
      if (!list) return;
      listRef.current = list;
      const w = waiters.current.splice(0);
      for (const resolve of w) resolve(list);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameRef]);

  const post = useCallback((ids: string[] | null) => {
    try {
      frameRef.current?.contentWindow?.postMessage({ type: WATCHLIST_ASK_MESSAGE, ids }, window.location.origin);
    } catch { /* frame gone */ }
  }, [frameRef]);

  const onAsk = useCallback(async (params: SavedSearchesAskParams): Promise<TabAskCount> => {
    const list = listRef.current ?? await new Promise<SavedSearchLite[] | null>((resolve) => {
      const t = setTimeout(() => {
        waiters.current = waiters.current.filter((w) => w !== done);
        resolve(null);
      }, WATCHLIST_LIST_WAIT_MS);
      const done = (l: SavedSearchLite[]) => { clearTimeout(t); resolve(l); };
      waiters.current.push(done);
    });
    // The page never reported its searches (still loading / failed): unknown, never 0, list untouched.
    if (!list) return null;
    const ids = matchSavedSearches(list, params);
    post(ids);
    return { shown: ids.length, more: false };
  }, [post]);

  const onClear = useCallback(() => post(null), [post]);

  return (
    <div className="px-4 pt-4 pb-2 shrink-0">
      <TabAskBox adapter={savedSearchesAskAdapter} onAsk={onAsk} onClear={onClear} />
    </div>
  );
}
