// @vitest-environment jsdom
/**
 * Ask Mindy on the Saved searches tab — the Watchlist PAGE side.
 *  - OFF (default), or outside the app shell: the served page is byte-identical to the page without it.
 *  - ON in the app shell: the real page script reports its loaded saved searches to the app and, given
 *    ids, re-renders its OWN cards with only those; Clear (`null`) restores every card without a request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';
import { WATCHLIST_TAB_ASK_ANCHORS, applyWatchlistTabAsk } from './tab-ask-bridge';
import { WATCHLIST_ASK_MESSAGE, WATCHLIST_SEARCHES_MESSAGE } from '@/lib/app/tab-ask-adapters/saved-searches';

const prevFlag = process.env.NEXT_PUBLIC_TAB_ASK;
afterEach(() => {
  if (prevFlag === undefined) delete process.env.NEXT_PUBLIC_TAB_ASK; else process.env.NEXT_PUBLIC_TAB_ASK = prevFlag;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const page = async (url: string) => (await GET(new Request(url))).text();
const SHELL = 'http://localhost/opportunity-map/saved?shell=app';

describe('Watchlist page — Ask Mindy bridge', () => {
  it('OFF by default: the page is exactly what it was without the feature (shell and standalone)', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    const offShell = await page(SHELL);
    const offPlain = await page('http://localhost/opportunity-map/saved');
    expect(offShell).not.toContain('askPostList');
    expect(offShell).not.toContain(WATCHLIST_SEARCHES_MESSAGE);
    // ON outside the app shell (no box there) is also untouched.
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    expect(await page('http://localhost/opportunity-map/saved')).toBe(offPlain);
    // ON inside the shell differs ONLY by the bridge: removing it gives back the OFF page.
    const onShell = await page(SHELL);
    let undone = onShell;
    for (const [a, b] of WATCHLIST_TAB_ASK_ANCHORS) undone = undone.replace(b, () => a);
    expect(undone).toBe(offShell);
    expect(onShell).not.toBe(offShell);
  });

  it('every anchor exists exactly once; a page missing one is served unchanged (fails off)', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    const html = await page(SHELL);
    for (const [a] of WATCHLIST_TAB_ASK_ANCHORS) expect(html.split(a).length - 1, a).toBe(1);
    const broken = html.replace("var SORT='new', VIEW='list';", "var SORT='new',VIEW='list';");
    expect(applyWatchlistTabAsk(broken)).toBe(broken);
    expect(applyWatchlistTabAsk(html)).not.toBe(html);
  });

  it('ON: the real page reports its searches, shows only the asked ids with its own cards, and Clear restores', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    const html = await page(SHELL);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const main = scripts.find((s) => s.includes('askPostList'))!;
    expect(main).toBeTruthy();
    expect(() => new Function(main)).not.toThrow();

    // The page's DOM, a signed-in token, and its two list APIs.
    document.body.innerHTML = '<div id="greeting"></div><div id="subline"></div><div id="kpis" hidden></div><div id="body"></div>';
    const token = `${btoa(JSON.stringify({ email: 'watch-ask@example.com' }))}.sig`;
    localStorage.setItem('mi_beta_auth_token', token);
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(input), 'http://localhost');
      requests.push(`${init?.method || 'GET'} ${u.pathname}`);
      if (u.pathname === '/api/app/watchlist-brief') return Response.json({ success: true, searches: [], totals: { newListings: 0, marketValue: 0, closingWeek: 0 } });
      if (u.pathname === '/api/app/saved-searches' && (init?.method || 'GET') === 'GET') {
        return Response.json({ searches: [
          { id: 's1', name: 'Navy cyber', filters: { agency: 'Department of the Navy', q: 'cybersecurity' } },
          { id: 's2', name: 'Florida janitorial', filters: { q: 'janitorial', state: 'FL' } },
        ] });
      }
      return Response.json({ success: true });
    }));

    // The app (parent window) — a real second window so source/origin checks are the real ones.
    const parentFrame = document.createElement('iframe');
    document.documentElement.appendChild(parentFrame);
    const parentWin = parentFrame.contentWindow!;
    const posted: unknown[] = [];
    parentWin.postMessage = ((msg: unknown) => { posted.push(msg); }) as typeof parentWin.postMessage;
    const prevParent = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, get: () => parentWin });
    try {
      new Function(main)();
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));

      const rows = () => [...document.querySelectorAll('#rows .row')].map((r) => r.getAttribute('data-id'));
      expect(rows()).toEqual(['s1', 's2']);
      expect(posted).toContainEqual({ type: WATCHLIST_SEARCHES_MESSAGE, searches: [
        { id: 's1', name: 'Navy cyber', filters: { agency: 'Department of the Navy', q: 'cybersecurity' } },
        { id: 's2', name: 'Florida janitorial', filters: { q: 'janitorial', state: 'FL' } },
      ] });

      // A message from anyone other than the app is ignored.
      window.dispatchEvent(new MessageEvent('message', { data: { type: WATCHLIST_ASK_MESSAGE, ids: ['s2'] }, origin: 'https://evil.example', source: parentWin }));
      expect(rows()).toEqual(['s1', 's2']);

      const before = requests.length;
      window.dispatchEvent(new MessageEvent('message', { data: { type: WATCHLIST_ASK_MESSAGE, ids: ['s2'] }, origin: location.origin, source: parentWin }));
      expect(rows()).toEqual(['s2']);
      expect(document.querySelector('#rows .row .rname')?.textContent).toContain('Florida janitorial');
      expect(document.body.textContent).toContain('Showing 1 of 2 that match your question');

      window.dispatchEvent(new MessageEvent('message', { data: { type: WATCHLIST_ASK_MESSAGE, ids: [] }, origin: location.origin, source: parentWin }));
      expect(rows()).toEqual([]);
      expect(document.body.textContent).toContain('None of your saved searches match that question');

      window.dispatchEvent(new MessageEvent('message', { data: { type: WATCHLIST_ASK_MESSAGE, ids: null }, origin: location.origin, source: parentWin }));
      expect(rows()).toEqual(['s1', 's2']);
      expect(document.body.textContent).toContain('Track the markets that matter to you.');
      expect(requests.length).toBe(before); // asking and clearing never refetch
    } finally {
      if (prevParent) Object.defineProperty(window, 'parent', prevParent);
      localStorage.clear();
    }
  });
});
