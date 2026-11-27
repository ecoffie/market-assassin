// @vitest-environment jsdom
/**
 * Ask Mindy on the Alerts tab, through the REAL AlertsPanel in jsdom (fetch routed by URL):
 *  - OFF (default): no box, and the page is byte-identical to the panel without the feature.
 *  - ON: the question becomes the tab's own search box + state dropdown, ONE load of the tab's existing
 *    /api/app/opportunities (no duplicate from the debounced auto-load), the answer fills the tab's
 *    normal cards with a "Mindy searched: …" line, and Clear restores the previous list without a request.
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

const EMAIL = 'alerts-ask@example.com';
const row = (id: string, title: string, popState: string) => ({
  id, title, popState, department: 'GENERAL SERVICES ADMINISTRATION', noticeType: 'Solicitation',
  url: `https://sam.gov/opp/${id}/view`, postedDate: '2026-01-02', responseDeadline: '2026-02-02',
});
const PROFILE_ROWS = [row('p1', 'Profile feed: data center support', 'VA')];
const ASK_ROWS = [
  row('a1', 'Janitorial services, Tampa federal building', 'FL'),
  row('a2', 'Janitorial and custodial services, Miami', 'FL'),
  row('a3', 'Janitorial services, Dallas', 'TX'),
];
const requests: string[] = [];

async function routedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  requests.push(`${url.pathname}${url.search}`);
  if (url.pathname === '/api/app/opportunities') {
    const rows = url.searchParams.get('q') === 'janitorial' ? ASK_ROWS : PROFILE_ROWS;
    return Response.json({ success: true, count: rows.length, opportunities: rows, searchCriteria: { naicsCodes: ['541512'], keywords: ['data center'] } });
  }
  if (url.pathname === '/api/cta/codes') return Response.json({ success: true, ctas: [] });
  if (url.pathname === '/api/pipeline') return Response.json({ success: true, data: [] });
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
// Long enough to outlast the panel's 350 ms debounced auto-load, so a duplicate request would show up.
const settle = async () => {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const feedRequests = () => requests.filter((r) => r.startsWith('/api/app/opportunities?'));
const searchBox = () => host.querySelector('input[type="search"]') as HTMLInputElement;
const stateSelect = () => host.querySelector('select[aria-label="Filter by state"]') as HTMLSelectElement;

async function renderPanel() {
  const { default: AlertsPanel } = await import('./AlertsPanel');
  act(() => root.render(<AlertsPanel email={EMAIL} tier={'pro' as never} />));
  await settle();
}

async function ask(question: string) {
  const input = $('tab-ask-input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, question); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
  await settle();
}

describe('AlertsPanel — Ask Mindy on the tab', () => {
  it('OFF by default: no box, and the page is identical to the panel without the feature', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    await renderPanel();
    expect($('tab-ask')).toBeNull();
    expect(host.textContent).toContain('Profile feed: data center support');
    const offHtml = host.innerHTML;
    const offRequests = [...requests];

    act(() => root.unmount());
    root = createRoot(host);
    requests.length = 0;
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    boxControl.hideBox = true; // the feature ON, minus the box itself
    await renderPanel();
    expect(host.innerHTML).toBe(offHtml);
    // useDodaacNames caches its directory at module level, so only the FIRST render ever fetches it.
    const noDirectory = (rs: string[]) => rs.filter((r) => r !== '/api/app/dodaac-directory');
    expect(noDirectory(requests)).toEqual(noDirectory(offRequests));
    expect(offRequests).toContain('/api/app/opportunities?email=alerts-ask%40example.com&limit=1000');
  });

  it('ON: the answer fills the tab\'s own list via /api/app/opportunities, with a summary line; Clear restores', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    const box = $('tab-ask');
    expect(box).not.toBeNull();
    // The box sits above the tab's own controls and list.
    expect(box!.compareDocumentPosition(searchBox()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    requests.length = 0;
    await ask('janitorial services in Florida');

    // Exactly ONE feed load, with the tab's existing params — no duplicate from the debounced auto-load.
    expect(feedRequests()).toEqual([`/api/app/opportunities?email=${encodeURIComponent(EMAIL)}&limit=1000&q=janitorial&keywordOnly=true`]);
    // Rows render as the tab's normal cards, narrowed by the tab's own state dropdown.
    expect(host.textContent).toContain('Janitorial services, Tampa federal building');
    expect(host.textContent).toContain('Janitorial and custodial services, Miami');
    expect(host.textContent).not.toContain('Janitorial services, Dallas');
    expect(host.textContent).not.toContain('Profile feed: data center support');
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched: janitorial · FL — 2 open opportunities');
    // The tab's own controls show what Mindy searched.
    expect(searchBox().value).toBe('janitorial');
    expect(stateSelect().value).toBe('FL');

    requests.length = 0;
    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    await settle();
    expect(feedRequests()).toEqual([]);
    expect(host.textContent).toContain('Profile feed: data center support');
    expect(host.textContent).not.toContain('Janitorial services, Tampa federal building');
    expect(searchBox().value).toBe('');
    expect(stateSelect().value).toBe('');
  });

  it('ON: a question the tab cannot express makes no request and offers chat', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    requests.length = 0;
    await ask('Navy cybersecurity');
    expect(feedRequests()).toEqual([]);
    expect($('tab-ask-chat')?.textContent).toContain('Ask Mindy in chat instead');
    expect($('tab-ask-handoff')?.textContent).toMatch(/buyer/);
    expect(host.textContent).toContain('Profile feed: data center support');
  });
});
