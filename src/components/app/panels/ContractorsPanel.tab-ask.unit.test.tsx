// @vitest-environment jsdom
/**
 * Ask Mindy on the Contractors tab, through the REAL ContractorsPanel in jsdom (fetch routed by URL):
 *  - OFF (default): no box, and the page is byte-identical to the panel without the feature.
 *  - ON: the question becomes the tab's own /api/contractors/search-bq params, the answer fills the
 *    tab's normal contractor cards with a "Mindy searched: …" line, and Clear restores the previous
 *    list without a request.
 *  - A capability in words ("janitorial contractors") is never turned into a name search: no request,
 *    chat handoff instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
  usePathname: () => '/app',
}));

// When `hideBox` is set the shared box renders nothing — used to prove OFF == "panel without the feature".
const boxControl = { hideBox: false };
vi.mock('@/components/app/TabAskBox', async () => {
  const real = await vi.importActual<typeof import('@/components/app/TabAskBox')>('@/components/app/TabAskBox');
  const Wrapped = (props: Parameters<typeof real.default>[0]) => (boxControl.hideBox ? null : real.default(props));
  return { default: Wrapped };
});

const EMAIL = 'contractors-ask@example.com';
const row = (company: string, uei: string) => ({
  uei, company, city: 'Reston', state: 'VA', total_contract_value: 1000000, contract_value_num: 1000000,
  contract_count: 12, agencies_count: 3, slug: company.toLowerCase().replace(/\s+/g, '-'), source: 'usaspending', capability: null,
});
const PROFILE_ROWS = [row('Profile Systems Integrator LLC', 'PROFILEUEI01')];
const ASK_ROWS = [row('Leidos Inc', 'LEIDOSUEI001'), row('Leidos Biomedical Research', 'LEIDOSUEI002')];
const requests: string[] = [];

async function routedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  requests.push(`${url.pathname}${url.search}`);
  if (url.pathname === '/api/contractors/search-bq') {
    if (url.searchParams.get('limit') === '1') return Response.json({ success: true, totalCount: 317000, filteredCount: 317000, contractors: [] });
    const rows = url.searchParams.get('search') === 'leidos' ? ASK_ROWS : PROFILE_ROWS;
    return Response.json({ success: true, status: 'success_nonzero', totalCount: rows.length, filteredCount: rows.length, contractors: rows });
  }
  if (url.pathname === '/api/alerts/preferences') return Response.json({ success: true, data: { naicsCodes: ['541512'], targetAgencies: [] } });
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
const companyInput = () => Array.from(host.querySelectorAll('input')).find((i) => i.placeholder === 'Search by company…') as HTMLInputElement;

async function renderPanel() {
  const { default: ContractorsPanel } = await import('./ContractorsPanel');
  act(() => root.render(<ContractorsPanel email={EMAIL} tier={'pro' as never} />));
  await flush();
}

async function askBox(question: string) {
  const input = $('tab-ask-input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, question); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
  await flush();
}

describe('ContractorsPanel — Ask Mindy on the tab', () => {
  it('OFF by default: no box, and the page is identical to the panel without the feature', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    await renderPanel();
    expect($('tab-ask')).toBeNull();
    expect(host.textContent).toContain('Profile Systems Integrator LLC');
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

  it('ON: the answer fills the tab\'s own list via /api/contractors/search-bq, with a summary line; Clear restores', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    const box = $('tab-ask');
    expect(box).not.toBeNull();
    // The box sits above the tab's filter form and list.
    const firstCard = Array.from(host.querySelectorAll('[role="button"]')).find((el) => /Profile Systems Integrator/.test(el.textContent || ''))!;
    expect(box!.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    requests.length = 0;
    await askBox('companies named Leidos');

    // Exactly one request, to the tab's existing API, with the tab's existing params.
    expect(requests).toEqual(['/api/contractors/search-bq?search=leidos&sortBy=contract_value&limit=25&offset=0']);
    // Rows render as the tab's normal cards.
    expect(host.textContent).toContain('Leidos Inc');
    expect(host.textContent).toContain('Leidos Biomedical Research');
    expect(host.textContent).not.toContain('Profile Systems Integrator LLC');
    expect(host.textContent).toContain('of 2 contractors');
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched: name contains “leidos” — 2 contractors');
    // The tab's own Company name filter now shows what Mindy searched.
    expect(companyInput().value).toBe('leidos');

    requests.length = 0;
    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    await flush();
    expect(requests).toEqual([]);
    expect(host.textContent).toContain('Profile Systems Integrator LLC');
    expect(host.textContent).not.toContain('Leidos Inc');
    expect(companyInput().value).toBe('');
  });

  it('ON: a NAICS question uses the tab\'s NAICS filter', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    requests.length = 0;
    await askBox('top contractors in NAICS 236220');
    expect(requests).toEqual(['/api/contractors/search-bq?naics=236220&sortBy=contract_value&limit=25&offset=0']);
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched: NAICS 236220 — 1 contractor');
  });

  it('ON: a capability in words is not guessed at — no request, chat handoff', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    requests.length = 0;
    await askBox('janitorial contractors');
    expect(requests).toEqual([]);
    expect($('tab-ask-chat')?.textContent).toContain('Ask Mindy in chat instead');
    expect(host.textContent).toContain('Profile Systems Integrator LLC');
  });

  it('ON: a failed load reads "count unavailable", never 0', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      requests.push(`${url.pathname}${url.search}`);
      return Response.json({ success: true, status: 'unavailable', totalCount: null, filteredCount: null, contractors: [] });
    }));
    await askBox('Booz Allen');
    expect($('tab-ask-summary')?.textContent).toContain('contractors count unavailable');
    expect($('tab-ask-summary')?.textContent).not.toMatch(/\b0 contractors\b/);
  });
});
