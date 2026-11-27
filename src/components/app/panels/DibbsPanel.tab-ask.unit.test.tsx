// @vitest-environment jsdom
/**
 * Ask Mindy on the DIBBS tab, through the REAL DibbsPanel in jsdom (fetch routed by URL):
 *  - OFF (default): no box, and the page is byte-identical to the panel without the feature.
 *  - ON: the question becomes the tab's own /api/app/dibbs params, the answer fills the tab's normal
 *    RFQ cards with a "Mindy searched: …" line, and Clear restores the previous list without a request.
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

const EMAIL = 'dibbs-ask@example.com';
const rfq = (n: string, description: string) => ({
  solicitationNumber: n, nsn: null, fsc: null, description, quantity: null, unitOfIssue: null,
  returnByDate: null, buyer: null, status: null, url: `https://dibbs.example/${n}`, pdfUrl: null,
});
const DEFAULT_ROWS = [rfq('SPE-DEFAULT-1', 'VALVE, SAFETY RELIEF')];
const ASK_ROWS = [rfq('SPE-ASK-1', 'HOSE ASSEMBLY, HYDRAULIC'), rfq('SPE-ASK-2', 'HYDRAULIC HOSE ASSEMBLY KIT')];
const requests: string[] = [];
const dibbsRequests = () => requests.filter((r) => r.startsWith('/api/app/dibbs'));

async function routedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  requests.push(`${url.pathname}${url.search}`);
  if (url.pathname === '/api/app/dibbs') {
    const rows = url.searchParams.get('q') === 'hydraulic hose assembly' ? ASK_ROWS : DEFAULT_ROWS;
    return Response.json({ success: true, rfqs: rows, total: rows.length, hasMore: false, freshness: { warning: null } });
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
const keywordInput = () => Array.from(host.querySelectorAll('input')).find((i) => i.placeholder.startsWith('Keyword or solicitation')) as HTMLInputElement;

async function renderPanel() {
  const { default: DibbsPanel } = await import('./DibbsPanel');
  act(() => root.render(<DibbsPanel email={EMAIL} tier={'pro' as never} />));
  await flush();
}

async function ask(text: string) {
  const input = $('tab-ask-input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
  await flush();
}

describe('DibbsPanel — Ask Mindy on the tab', () => {
  it('OFF by default: no box, and the page is identical to the panel without the feature', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    await renderPanel();
    expect($('tab-ask')).toBeNull();
    expect(host.textContent).toContain('VALVE, SAFETY RELIEF');
    const offHtml = host.innerHTML;
    const offRequests = [...dibbsRequests()];

    act(() => root.unmount());
    root = createRoot(host);
    requests.length = 0;
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    boxControl.hideBox = true; // the feature ON, minus the box itself
    await renderPanel();
    expect(host.innerHTML).toBe(offHtml);
    expect(dibbsRequests()).toEqual(offRequests);
  });

  it('ON: the answer fills the tab\'s own list via /api/app/dibbs, with a summary line; Clear restores', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    const box = $('tab-ask');
    expect(box).not.toBeNull();
    // The box sits above the tab's own search form and list.
    expect(box!.compareDocumentPosition(keywordInput()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    requests.length = 0;
    await ask('hydraulic hose assembly RFQs');

    // Exactly one list request, to the tab's existing API, with the tab's existing params.
    expect(dibbsRequests()).toEqual([
      `/api/app/dibbs?email=${encodeURIComponent(EMAIL)}&sort=deadline&limit=50&offset=0&q=hydraulic+hose+assembly`,
    ]);
    // Rows render as the tab's normal RFQ cards.
    expect(host.textContent).toContain('HOSE ASSEMBLY, HYDRAULIC');
    expect(host.textContent).toContain('HYDRAULIC HOSE ASSEMBLY KIT');
    expect(host.textContent).not.toContain('VALVE, SAFETY RELIEF');
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched: hydraulic hose assembly — 2 RFQs');
    // The tab's own Keyword box now shows what Mindy searched.
    expect(keywordInput().value).toBe('hydraulic hose assembly');

    requests.length = 0;
    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    await flush();
    expect(dibbsRequests()).toEqual([]);
    expect(host.textContent).toContain('VALVE, SAFETY RELIEF');
    expect(host.textContent).not.toContain('HOSE ASSEMBLY, HYDRAULIC');
    expect(keywordInput().value).toBe('');
  });

  it('ON: a question the tab cannot express makes no request and offers chat', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    requests.length = 0;
    await ask('FSC 8415');
    expect(dibbsRequests()).toEqual([]);
    expect($('tab-ask-chat')?.textContent).toContain('Ask Mindy in chat instead');
    expect(host.textContent).toContain('VALVE, SAFETY RELIEF');
  });
});
