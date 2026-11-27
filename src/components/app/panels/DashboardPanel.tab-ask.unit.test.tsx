// @vitest-environment jsdom
/**
 * Ask Mindy on the Dashboard tab (Today's Intel), through the REAL DashboardPanel in jsdom:
 *  - OFF (default): no box, and the page is byte-identical to the panel without the feature.
 *  - ON: the question becomes the tab's own Search box text + filter chip, the answer is the tab's
 *    normal briefing cards with a "Mindy searched: …" line, no request is made, and Clear restores.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
// Self-fetching cards around the list are not what this test is about; render them as nothing.
vi.mock('@/components/briefings/ProfileStatsBar', () => ({ default: () => null }));
vi.mock('./TodaysLensHero', () => ({ default: () => null }));
vi.mock('./TargetingCard', () => ({ default: () => null }));
vi.mock('./StartHereCard', () => ({ default: () => null }));
vi.mock('./HiddenWorkNudge', () => ({ default: () => null }));
vi.mock('./TodaysThree', () => ({ default: () => null }));
vi.mock('../CollabHotCard', () => ({ CollabHotCard: () => null }));

// When `hideBox` is set the shared box renders nothing — used to prove OFF == "panel without the feature".
const boxControl = { hideBox: false };
vi.mock('@/components/app/TabAskBox', async () => {
  const real = await vi.importActual<typeof import('@/components/app/TabAskBox')>('@/components/app/TabAskBox');
  const Wrapped = (props: Parameters<typeof real.default>[0]) => (boxControl.hideBox ? null : real.default(props));
  return { default: Wrapped };
});

const EMAIL = 'dashboard-ask@example.com';
const item = (id: string, title: string, category: string, signals: string[] = []) => ({ id, title, subtitle: 'DEPT OF ENERGY', description: title, category, signals });
const BRIEFING = {
  topItems: [{
    title: 'Top',
    items: [
      item('i1', 'Zero trust cybersecurity support', 'Urgent', ['5 days left']),
      item('i2', 'Data center facilities maintenance', 'Opportunity'),
      item('i3', 'Cybersecurity assessment teaming partner', 'Teaming'),
      item('i4', 'Janitorial services for HQ', 'Opportunity'),
    ],
  }],
};
const requests: string[] = [];

async function routedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  requests.push(`${url.pathname}`);
  if (url.pathname === '/api/briefings/latest') {
    return Response.json({ success: true, briefings: [{ id: 'b1', briefing_date: '2026-11-26', briefing_type: 'daily', generated_at: '2026-11-26T07:00:00Z', items_count: 4, content: BRIEFING }] });
  }
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

const dataRequests = () => requests.filter((r) => r !== '/api/mindy/engagement');
const $ = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const searchBox = () => Array.from(host.querySelectorAll('input')).find((i) => i.placeholder === 'Search opportunities, agencies, keywords...') as HTMLInputElement;
const shown = () => Array.from(host.querySelectorAll('div.text-sm.text-faint'))
  .map((d) => (d.textContent || '').match(/^(\d+) shown$/)?.[1])
  .find(Boolean);

async function renderPanel() {
  const { default: DashboardPanel } = await import('./DashboardPanel');
  act(() => root.render(<DashboardPanel email={EMAIL} tier={'pro' as never} />));
  await flush();
}

async function askBox(question: string) {
  const input = $('tab-ask-input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, question); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
  await flush();
}

describe('DashboardPanel — Ask Mindy on the tab', () => {
  it('OFF by default: no box, and the page is identical to the panel without the feature', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    await renderPanel();
    expect($('tab-ask')).toBeNull();
    expect(host.textContent).toContain('Zero trust cybersecurity support');
    const offHtml = host.innerHTML;
    const offRequests = [...requests].sort();

    act(() => root.unmount());
    root = createRoot(host);
    requests.length = 0;
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    boxControl.hideBox = true; // the feature ON, minus the box itself
    await renderPanel();
    expect(host.innerHTML).toBe(offHtml);
    expect([...requests].sort()).toEqual(offRequests);
  });

  it('ON: the answer fills the tab\'s own list via its Search box + chip, with a summary line; Clear restores', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    const box = $('tab-ask');
    expect(box).not.toBeNull();
    // The box sits above the tab's list (and its Search box).
    const listHeading = Array.from(host.querySelectorAll('h3')).find((h) => /Top Opportunities to Review/.test(h.textContent || ''))!;
    expect(box!.compareDocumentPosition(listHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box!.compareDocumentPosition(searchBox()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shown()).toBe('4');

    requests.length = 0;
    await askBox('urgent cybersecurity opportunities');
    // The tab's filters are client-side over the loaded briefing: no data request. (The tab's existing
    // best-fit impression beacon fires for the new set of shown items, exactly as typing in Search does.)
    expect(dataRequests()).toEqual([]);
    expect(searchBox().value).toBe('cybersecurity');
    expect(host.textContent).toContain('filtered: urgent (1)');
    expect(shown()).toBe('1');
    expect(host.textContent).toContain('Zero trust cybersecurity support');
    expect(host.textContent).not.toContain('Cybersecurity assessment teaming partner');
    expect(host.textContent).not.toContain('Janitorial services for HQ');
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched today’s briefing: urgent · cybersecurity — 1 briefing item');

    // A second question builds on the same snapshot; the count matches the rendered list.
    await askBox('cybersecurity');
    expect(shown()).toBe('2');
    expect($('tab-ask-summary')?.textContent).toContain('— 2 briefing items');

    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    await flush();
    expect(dataRequests()).toEqual([]);
    expect(searchBox().value).toBe('');
    expect(shown()).toBe('4');
    expect(host.textContent).not.toContain('filtered:');
  });

  it('ON: a question the tab cannot express makes no request, leaves the list alone, and offers chat', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    requests.length = 0;
    await askBox('Navy cybersecurity');
    expect(requests).toEqual([]);
    expect($('tab-ask-chat')?.textContent).toContain('Ask Mindy in chat instead');
    expect(searchBox().value).toBe('');
    expect(shown()).toBe('4');
  });
});
