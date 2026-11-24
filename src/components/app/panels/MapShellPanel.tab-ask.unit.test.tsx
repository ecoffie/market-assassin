// @vitest-environment jsdom
/**
 * Ask Mindy on the Saved searches tab, through the REAL MapShellPanel (panel 'watchlist') in jsdom:
 *  - OFF (default): the panel is exactly the framed page, as before — no box.
 *  - ON: the box sits above the framed Watchlist; a question is matched against the searches the page
 *    reported and only the matching ids are sent back to the page (which renders its own cards); the
 *    summary line counts them; Clear sends `null`. A question the tab cannot express never reaches the page.
 *  - ON for the Map / Saved tabs: unchanged (this tab only).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WATCHLIST_ASK_MESSAGE, WATCHLIST_SEARCHES_MESSAGE } from '@/lib/app/tab-ask-adapters/saved-searches';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const prevFlag = process.env.NEXT_PUBLIC_TAB_ASK;
beforeEach(() => {
  window.history.replaceState(null, '', '/app?panel=watchlist');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  if (prevFlag === undefined) delete process.env.NEXT_PUBLIC_TAB_ASK; else process.env.NEXT_PUBLIC_TAB_ASK = prevFlag;
});

const $ = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

async function render(panel: 'map' | 'watchlist' | 'saved') {
  const { default: MapShellPanel } = await import('./MapShellPanel');
  act(() => root.render(<MapShellPanel panel={panel} />));
  await flush();
}

async function askQuestion(q: string) {
  const input = $('tab-ask-input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, q); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
  await flush();
}

const SEARCHES = [
  { id: 's1', name: 'Navy cyber', filters: { agency: 'Department of the Navy', q: 'cybersecurity' } },
  { id: 's2', name: 'All-agency IT', filters: { naics: '541512' } },
  { id: 's3', name: 'Army cyber', filters: { agency: 'ARMY', q: 'cybersecurity' } },
];

describe('MapShellPanel (Saved searches) — Ask Mindy on the tab', () => {
  it('OFF by default: the panel is just the framed Watchlist, identical to before', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    await render('watchlist');
    expect($('tab-ask')).toBeNull();
    expect(host.children.length).toBe(1);
    expect(host.firstElementChild?.tagName).toBe('IFRAME');
    expect(host.firstElementChild?.getAttribute('data-testid')).toBe('map-shell-watchlist');
  });

  it('ON: only the Saved searches tab gets the box; Map and Saved are unchanged', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    for (const p of ['map', 'saved'] as const) {
      await render(p);
      expect($('tab-ask')).toBeNull();
      expect(host.children.length).toBe(1);
      expect(host.firstElementChild?.tagName).toBe('IFRAME');
    }
  });

  it('ON: the answer narrows the page\'s own list to the matching searches, with a summary; Clear restores', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await render('watchlist');
    const box = $('tab-ask');
    const frame = $('map-shell-watchlist') as HTMLIFrameElement;
    expect(box).not.toBeNull();
    expect(box!.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const frameWin = frame.contentWindow!;
    const toFrame: unknown[] = [];
    frameWin.postMessage = ((msg: unknown) => { toFrame.push(msg); }) as typeof frameWin.postMessage;

    // A list from anything but the framed page is ignored; the framed page's list is used.
    act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: WATCHLIST_SEARCHES_MESSAGE, searches: [{ id: 'x', name: 'Navy x', filters: { agency: 'NAVY' } }] }, origin: window.location.origin, source: window })); });
    act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: WATCHLIST_SEARCHES_MESSAGE, searches: SEARCHES }, origin: window.location.origin, source: frameWin })); });

    await askQuestion('Navy cybersecurity');
    expect(toFrame).toEqual([{ type: WATCHLIST_ASK_MESSAGE, ids: ['s1'] }]);
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched your saved searches for: Navy · cybersecurity — 1 saved search');

    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    expect(toFrame[1]).toEqual({ type: WATCHLIST_ASK_MESSAGE, ids: null });
  });

  it('ON: a question the tab cannot express never reaches the page and offers chat', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await render('watchlist');
    const frameWin = ($('map-shell-watchlist') as HTMLIFrameElement).contentWindow!;
    const toFrame: unknown[] = [];
    frameWin.postMessage = ((msg: unknown) => { toFrame.push(msg); }) as typeof frameWin.postMessage;
    act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: WATCHLIST_SEARCHES_MESSAGE, searches: SEARCHES }, origin: window.location.origin, source: frameWin })); });
    await askQuestion('how should I price a Navy bid');
    expect(toFrame).toEqual([]);
    expect($('tab-ask-chat')?.textContent).toContain('Ask Mindy in chat instead');
  });

  it('ON: if the page never reports its list, the count is unavailable (never 0) and the list is untouched', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    const { WATCHLIST_LIST_WAIT_MS } = await import('./WatchlistTabAsk');
    await render('watchlist');
    const frameWin = ($('map-shell-watchlist') as HTMLIFrameElement).contentWindow!;
    const toFrame: unknown[] = [];
    frameWin.postMessage = ((msg: unknown) => { toFrame.push(msg); }) as typeof frameWin.postMessage;
    vi.useFakeTimers();
    const input = $('tab-ask-input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setter.call(input, 'Navy'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(WATCHLIST_LIST_WAIT_MS + 10); });
    expect(toFrame).toEqual([]);
    const summary = $('tab-ask-summary')?.textContent || '';
    expect(summary).toContain('saved searches count unavailable');
    expect(summary).not.toMatch(/\b0 saved/);
  });
});
