// @vitest-environment jsdom
/**
 * Ask Mindy on the OSBP "Find Capable Small Businesses" tab, through the REAL OsbpSmbResearchPanel in jsdom:
 *  - OFF (default): no box, and the page is byte-identical to the panel without the feature.
 *  - ON: the question becomes the tab's own /api/app/osbp/smb-search psc/naics (the $ ceiling stays the
 *    user's), the answer fills the tab's normal list with a summary line, and Clear restores with no request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const boxControl = { hideBox: false };
vi.mock('@/components/app/TabAskBox', async () => {
  const real = await vi.importActual<typeof import('@/components/app/TabAskBox')>('@/components/app/TabAskBox');
  const Wrapped = (props: Parameters<typeof real.default>[0]) => (boxControl.hideBox ? null : real.default(props));
  return { default: Wrapped };
});

const EMAIL = 'osbp-ask@example.com';
const row = (uei: string, name: string) => ({
  recipient_uei: uei, recipient_name: name, total_obligated: 2_000_000, award_count: 4, agency_count: 1,
  set_asides: '', won_set_aside: false, psc_exact: true, psc_family: false, naics_match: false,
  match_score: 3, match_reason: 'Won this exact PSC',
});
const ASK_ROWS = [row('UEI1', 'Puget Marine Repair LLC'), row('UEI2', 'Harbor Hull Works Inc')];
const requests: string[] = [];

async function routedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  requests.push(`${url.pathname}${url.search}`);
  if (url.pathname === '/api/app/osbp/smb-search') {
    return Response.json({ success: true, total: 7, results: ASK_ROWS });
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

const $ = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const pscInput = () => Array.from(host.querySelectorAll('input')).find((i) => i.placeholder === 'J998 (ship repair)') as HTMLInputElement;
const naicsInput = () => Array.from(host.querySelectorAll('input')).find((i) => i.placeholder === '336611') as HTMLInputElement;

async function renderPanel() {
  const { default: OsbpSmbResearchPanel } = await import('./OsbpSmbResearchPanel');
  act(() => root.render(<OsbpSmbResearchPanel email={EMAIL} />));
  await flush();
}

async function ask(question: string) {
  const input = $('tab-ask-input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, question); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
  await flush();
}

describe('OsbpSmbResearchPanel — Ask Mindy on the tab', () => {
  it('OFF by default: no box, and the page is identical to the panel without the feature', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    await renderPanel();
    expect($('tab-ask')).toBeNull();
    expect(host.textContent).toContain('Find Capable Small Businesses');
    const offHtml = host.innerHTML;
    const offRequests = [...requests];

    act(() => root.unmount());
    root = createRoot(host);
    requests.length = 0;
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    boxControl.hideBox = true;
    await renderPanel();
    expect(host.innerHTML).toBe(offHtml);
    expect(requests).toEqual(offRequests);
  });

  it('ON: the answer fills the tab\'s own list via /api/app/osbp/smb-search; Clear restores without a request', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    const box = $('tab-ask');
    expect(box).not.toBeNull();
    expect(box!.compareDocumentPosition(pscInput()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    requests.length = 0;
    await ask('small businesses for PSC J998');

    // Exactly one request, to the tab's existing API, with the tab's existing params (default $25M ceiling).
    expect(requests).toEqual([
      `/api/app/osbp/smb-search?email=${encodeURIComponent(EMAIL)}&limit=50&offset=0&psc=J998&maxObligated=25000000`,
    ]);
    expect(host.textContent).toContain('7 Capable Businesses · PSC J998 · ≤$25M');
    expect(host.textContent).toContain('Puget Marine Repair LLC');
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched: PSC J998 — 2+ capable businesses (showing the first 2)');
    expect(pscInput().value).toBe('J998');
    expect(naicsInput().value).toBe('');

    requests.length = 0;
    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    await flush();
    expect(requests).toEqual([]);
    expect(host.textContent).not.toContain('Puget Marine Repair LLC');
    expect(pscInput().value).toBe('');
  });

  it('ON: a question the tab cannot express makes no request and offers chat', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    requests.length = 0;
    await ask('ship repair firms near Bremerton');
    expect(requests).toEqual([]);
    expect($('tab-ask-chat')?.textContent).toContain('Ask Mindy in chat instead');
  });
});
