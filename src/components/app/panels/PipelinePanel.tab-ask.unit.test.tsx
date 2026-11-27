// @vitest-environment jsdom
/**
 * Ask Mindy on the Pipeline tab, through the REAL PipelinePanel in jsdom (fetch routed by URL):
 *  - OFF (default): no box, and the page is byte-identical to the panel without the feature.
 *  - ON: the question narrows the pursuits the tab already loaded from /api/pipeline (no new request),
 *    the answer fills the tab's normal list with a "Mindy searched: …" line, and Clear restores it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// When `hideBox` is set the shared box renders nothing — used to prove OFF == "panel without the feature".
const boxControl = { hideBox: false };
vi.mock('@/components/app/TabAskBox', async () => {
  const real = await vi.importActual<typeof import('@/components/app/TabAskBox')>('@/components/app/TabAskBox');
  const Wrapped = (props: Parameters<typeof real.default>[0]) => (boxControl.hideBox ? null : real.default(props));
  return { default: Wrapped };
});

const EMAIL = 'pipeline-ask@example.com';
const PURSUITS = [
  { id: 'p1', title: 'Navy zero trust cybersecurity services', agency: 'DEPT OF THE NAVY', naics_code: '541512', stage: 'tracking', user_email: EMAIL, created_at: '2026-10-01T00:00:00Z' },
  { id: 'p2', title: 'VA cloud migration support', agency: 'VETERANS AFFAIRS, DEPARTMENT OF', naics_code: '541519', stage: 'pursuing', user_email: EMAIL, created_at: '2026-10-02T00:00:00Z' },
  { id: 'p3', title: 'Army janitorial services', agency: 'ARMY', naics_code: '561720', stage: 'bidding', user_email: EMAIL, created_at: '2026-10-03T00:00:00Z' },
];
const requests: string[] = [];

async function routedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  requests.push(`${url.pathname}${url.search}`);
  if (url.pathname === '/api/pipeline') return Response.json({ opportunities: PURSUITS, stats: {} });
  if (url.pathname === '/api/teaming') return Response.json({ partners: [] });
  if (url.pathname === '/api/app/pursuit-changes') return Response.json({ success: true, byPursuit: {} });
  if (url.pathname === '/api/app/library') return Response.json({ success: true, entries: [] });
  return Response.json({});
}

let root: Root;
let host: HTMLDivElement;
const prevFlag = process.env.NEXT_PUBLIC_TAB_ASK;
beforeEach(() => {
  requests.length = 0;
  boxControl.hideBox = false;
  vi.stubGlobal('fetch', vi.fn(routedFetch));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  if (prevFlag === undefined) delete process.env.NEXT_PUBLIC_TAB_ASK; else process.env.NEXT_PUBLIC_TAB_ASK = prevFlag;
});

const $ = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
// The DoDAAC office directory is fetched once per module (cached across renders), so it is not a
// per-render request and is left out of the OFF/ON comparison.
const perRender = (r: string[]) => r.filter((u) => !u.startsWith('/api/app/dodaac-directory')).sort();
const listText = () => host.querySelector('tbody')?.textContent || '';

async function renderPanel() {
  const { default: PipelinePanel } = await import('./PipelinePanel');
  act(() => root.render(<PipelinePanel email={EMAIL} tier={'pro' as never} />));
  await flush();
}

async function ask(question: string) {
  const input = $('tab-ask-input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, question); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
  await flush();
}

describe('PipelinePanel — Ask Mindy on the tab', () => {
  it('OFF by default: no box, and the page is identical to the panel without the feature', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    await renderPanel();
    expect($('tab-ask')).toBeNull();
    expect(listText()).toContain('Navy zero trust cybersecurity services');
    const offHtml = host.innerHTML;
    const offRequests = perRender(requests);

    act(() => root.unmount());
    root = createRoot(host);
    requests.length = 0;
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    boxControl.hideBox = true; // the feature ON, minus the box itself
    await renderPanel();
    expect(host.innerHTML).toBe(offHtml);
    expect(perRender(requests)).toEqual(offRequests);
  });

  it('ON: the answer narrows the tab\'s own list with no request, with a summary line; Clear restores', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    const box = $('tab-ask');
    expect(box).not.toBeNull();
    // The box sits above the tab's list.
    const table = host.querySelector('table')!;
    expect(box!.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    requests.length = 0;
    await ask('my Navy cybersecurity pursuits');
    // The pursuits are already loaded; the tab filters them in the browser, so no request is made.
    expect(requests).toEqual([]);
    expect(listText()).toContain('Navy zero trust cybersecurity services');
    expect(listText()).not.toContain('VA cloud migration support');
    expect(listText()).not.toContain('Army janitorial services');
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched your pursuits for: Navy · cybersecurity — 1 pursuit');

    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    await flush();
    expect(requests).toEqual([]);
    expect(listText()).toContain('Navy zero trust cybersecurity services');
    expect(listText()).toContain('VA cloud migration support');
    expect(listText()).toContain('Army janitorial services');
  });

  it('ON: a question the tab cannot express makes no request, leaves the list, and offers chat', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    requests.length = 0;
    await ask('how should I price a Navy bid');
    expect(requests).toEqual([]);
    expect($('tab-ask-chat')?.textContent).toContain('Ask Mindy in chat instead');
    expect(listText()).toContain('VA cloud migration support');
  });
});
