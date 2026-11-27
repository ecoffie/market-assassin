// @vitest-environment jsdom
/**
 * Ask Mindy on the Forecasts tab, through the REAL ForecastsPanel in jsdom (fetch routed by URL):
 *  - OFF (default): no box, and the page is byte-identical to the panel without the feature.
 *  - ON: the question becomes the tab's own /api/forecasts params, the answer fills the tab's normal
 *    cards with a "Mindy searched: …" line, and Clear restores the previous list without a request.
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

const EMAIL = 'forecast-ask@example.com';
const PROFILE_ROWS = [{ id: 'p1', title: 'Profile forecast: data center support', agency: 'DOE', naics: '541512' }];
const ASK_ROWS = [
  { id: 'a1', title: 'Navy zero trust cybersecurity services', agency: 'NAVY', naics: '541512' },
  { id: 'a2', title: 'Shipboard cybersecurity assessment', agency: 'NAVY', naics: '541519' },
];
const requests: string[] = [];

async function routedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  requests.push(`${url.pathname}${url.search}`);
  if (url.pathname === '/api/forecasts') {
    if (!url.search) {
      return Response.json({ success: true, summary: { totalForecasts: 1234, activeSources: 11, estimatedSpendCoverage: '41.0%' }, byAgency: [{ agency: 'DOE', count: 10 }], topNaics: [] });
    }
    const rows = url.searchParams.get('search') === 'cybersecurity' ? ASK_ROWS : PROFILE_ROWS;
    return Response.json({ success: true, pagination: { total: rows.length, limit: 200, offset: 0, hasMore: false }, forecasts: rows });
  }
  if (url.pathname === '/api/alerts/preferences') return Response.json({ success: true, data: { naicsCodes: ['541512'], targetAgencies: [], locationStates: [] } });
  if (url.pathname === '/api/app/workspace') return Response.json({ success: true, settings: {}, profile: {} });
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

async function renderPanel() {
  const { default: ForecastsPanel } = await import('./ForecastsPanel');
  act(() => root.render(<ForecastsPanel email={EMAIL} tier={'pro' as never} />));
  await flush();
}

describe('ForecastsPanel — Ask Mindy on the tab', () => {
  it('OFF by default: no box, and the page is identical to the panel without the feature', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    await renderPanel();
    expect($('tab-ask')).toBeNull();
    expect(host.textContent).toContain('Profile forecast: data center support');
    const offHtml = host.innerHTML;
    const offRequests = [...requests];

    act(() => root.unmount());
    root = createRoot(host);
    requests.length = 0;
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    boxControl.hideBox = true; // the feature ON, minus the box itself
    await renderPanel();
    expect(host.innerHTML).toBe(offHtml);
    expect(requests).toEqual(offRequests);
  });

  it('ON: the answer fills the tab\'s own list via /api/forecasts, with a summary line; Clear restores', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    const box = $('tab-ask');
    expect(box).not.toBeNull();
    // The box sits above the tab's list (and its filter form).
    const listHeading = Array.from(host.querySelectorAll('h3')).find((h) => /Upcoming Buys Found/.test(h.textContent || ''))!;
    expect(box!.compareDocumentPosition(listHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    requests.length = 0;
    const input = $('tab-ask-input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setter.call(input, 'Navy cybersecurity forecasts'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
    await flush();

    // Exactly one request, to the tab's existing API, with the tab's existing params.
    expect(requests).toEqual(['/api/forecasts?agency=NAVY&search=cybersecurity&limit=200']);
    // Rows render as the tab's normal cards.
    expect(host.textContent).toContain('2 Upcoming Buys Found');
    expect(host.textContent).toContain('Navy zero trust cybersecurity services');
    expect(host.textContent).not.toContain('Profile forecast: data center support');
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched: Navy · cybersecurity — 2 upcoming buys');
    // The tab's own Keyword filter now shows what Mindy searched.
    expect((Array.from(host.querySelectorAll('input')).find((i) => i.placeholder === 'cybersecurity') as HTMLInputElement).value).toBe('cybersecurity');

    requests.length = 0;
    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    await flush();
    expect(requests).toEqual([]);
    expect(host.textContent).toContain('Profile forecast: data center support');
    expect(host.textContent).not.toContain('Navy zero trust cybersecurity services');
    expect((Array.from(host.querySelectorAll('input')).find((i) => i.placeholder === 'cybersecurity') as HTMLInputElement).value).toBe('');
  });

  it('ON: a question the tab cannot express makes no request and offers chat', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    requests.length = 0;
    const input = $('tab-ask-input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setter.call(input, 'how should I price a Navy bid'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
    await flush();
    expect(requests).toEqual([]);
    expect($('tab-ask-chat')?.textContent).toContain('Ask Mindy in chat instead');
    expect(host.textContent).toContain('Profile forecast: data center support');
  });
});
