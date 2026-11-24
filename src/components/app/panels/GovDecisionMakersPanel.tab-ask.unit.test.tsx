// @vitest-environment jsdom
/**
 * Ask Mindy on the Decision Makers tab, through the REAL GovDecisionMakersPanel in jsdom (fetch routed
 * by URL):
 *  - OFF (default): no box, and the page is byte-identical to the panel without the feature.
 *  - ON: the question becomes the tab's own /api/app/federal-contacts params (agency + search), the
 *    answer fills the tab's normal table with a "Mindy searched: …" line, with ONE list request, and
 *    Clear restores the previous filters + rows without a list request.
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

const EMAIL = 'dm-ask@example.com';
const contact = (id: string, name: string, agencyName: string, title = 'Contracting Officer') => ({
  id, contact_fullname: name, contact_title: title, contact_email: null, contact_phone: null,
  department_ind_agency: agencyName, office: null, sub_tier: null, role_category: null,
  roleCategory: 'Contracting Officer', role: title, pocLabel: null, subAgency: null, derivedOffice: null,
  dodaac: null, instrumentType: null,
});
const DEFAULT_ROWS = [contact('d1', 'Default Person', 'DEPT OF ENERGY', 'Program Analyst')];
const ASK_ROWS = [
  contact('n1', 'Navy Officer One', 'DEPT OF DEFENSE'),
  contact('n2', 'Navy Officer Two', 'DEPT OF DEFENSE'),
];
const requests: string[] = [];
const listRequests = () => requests.filter((r) => r.startsWith('/api/app/federal-contacts?') && !r.includes('facets='));

async function routedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  requests.push(`${url.pathname}${url.search}`);
  if (url.pathname === '/api/app/target-list') return Response.json({ targets: [] });
  if (url.pathname === '/api/app/federal-contacts') {
    const facet = url.searchParams.get('facets');
    if (facet === 'agencies') return Response.json({ success: true, agencyDetail: [{ name: 'DEPT OF DEFENSE', count: 900 }, { name: 'DEPT OF ENERGY', count: 50 }] });
    if (facet) return Response.json({ success: true, officeDetail: [], subAgencies: [], offices: [] });
    const asked = url.searchParams.get('agency') === 'Department of the Navy';
    const rows = asked ? ASK_ROWS : DEFAULT_ROWS;
    return Response.json({ success: true, total: rows.length, emailableTotal: 0, contacts: rows });
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
const searchBox = () => Array.from(host.querySelectorAll('input')).find((i) => i.placeholder.startsWith('Search by name or title')) as HTMLInputElement;
const agencySelect = () => host.querySelector('select') as HTMLSelectElement;

async function renderPanel() {
  const { default: GovDecisionMakersPanel } = await import('./GovDecisionMakersPanel');
  act(() => root.render(<GovDecisionMakersPanel email={EMAIL} tier={'pro' as never} />));
  await flush();
}

async function askQuestion(q: string) {
  const input = $('tab-ask-input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, q); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
  await flush();
}

describe('GovDecisionMakersPanel — Ask Mindy on the tab', () => {
  it('OFF by default: no box, and the page is identical to the panel without the feature', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    await renderPanel();
    expect($('tab-ask')).toBeNull();
    expect(host.textContent).toContain('Default Person');
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

  it('ON: the answer fills the tab\'s own table via /api/app/federal-contacts, with a summary; Clear restores', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    const box = $('tab-ask');
    expect(box).not.toBeNull();
    // The box sits above the tab's search box and table.
    expect(box!.compareDocumentPosition(searchBox()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.textContent).toContain('Default Person');

    requests.length = 0;
    await askQuestion('contracting officers at the Navy');

    // Exactly ONE list request, to the tab's existing API, with the tab's existing params.
    expect(listRequests()).toEqual([
      `/api/app/federal-contacts?email=${encodeURIComponent(EMAIL)}&search=contracting+officers&agency=Department+of+the+Navy&limit=100`,
    ]);
    // Rows render in the tab's normal table.
    expect(host.querySelectorAll('tbody tr').length).toBe(2);
    expect(host.textContent).toContain('Navy Officer One');
    expect(host.textContent).not.toContain('Default Person');
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched: Navy · contracting officers — 2 decision makers');
    // The tab's own filters show what Mindy searched.
    expect(searchBox().value).toBe('contracting officers');
    expect(agencySelect().value).toBe('Department of the Navy');

    requests.length = 0;
    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    await flush();
    expect(listRequests()).toEqual([]);
    expect(host.textContent).toContain('Default Person');
    expect(host.textContent).not.toContain('Navy Officer One');
    expect(searchBox().value).toBe('');
    expect(agencySelect().value).toBe('');

    // The tab's own filters still drive the list afterwards (no stale "skip" left behind).
    requests.length = 0;
    act(() => {
      const sel = agencySelect();
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, 'DEPT OF ENERGY');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(listRequests()).toEqual([`/api/app/federal-contacts?email=${encodeURIComponent(EMAIL)}&agency=DEPT+OF+ENERGY&limit=100`]);
  });

  it('ON: a question the tab cannot express makes no request and offers chat', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    requests.length = 0;
    await askQuestion('contracting officers in Virginia');
    expect(requests).toEqual([]);
    expect($('tab-ask-handoff')?.textContent).toContain('can’t be filtered by location');
    expect($('tab-ask-chat')?.textContent).toContain('Ask Mindy in chat instead');
    expect(host.textContent).toContain('Default Person');
  });

  it('ON: a failed load reports the count as unavailable, never 0', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('agency=Department+of+the+Navy') && !u.includes('facets=')) throw new Error('network');
      return routedFetch(input);
    }));
    await askQuestion('contracting officers at the Navy');
    const s = $('tab-ask-summary')?.textContent || '';
    expect(s).toContain('count unavailable');
    expect(s).not.toMatch(/\b0 decision makers/);
  });
});
