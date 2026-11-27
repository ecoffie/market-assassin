// @vitest-environment jsdom
/**
 * Ask Mindy on the Grants tab, through the REAL GrantsPanel in jsdom (fetch routed by URL):
 *  - OFF (default): no box, and the page is byte-identical to the panel without the feature.
 *  - ON: the question becomes the tab's own /api/grants params, the answer fills the tab's normal
 *    grant cards with a "Mindy searched: …" line, and Clear restores the previous list without a request.
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

const EMAIL = 'grants-ask@example.com';
const DEFAULT_ROWS = [{ id: 'g1', oppNumber: 'DEFAULT-1', title: 'Default grant: community water systems', agency: 'EPA', agencyCode: 'EPA', status: 'posted', url: 'https://www.grants.gov/x/g1' }];
const ASK_ROWS = [
  { id: 'g2', oppNumber: 'HHS-1', title: 'Rural health outreach program', agency: 'HRSA', agencyCode: 'HHS-HRSA', status: 'posted', url: 'https://www.grants.gov/x/g2' },
  { id: 'g3', oppNumber: 'HHS-2', title: 'Maternal health research', agency: 'NIH', agencyCode: 'HHS-NIH11', status: 'posted', url: 'https://www.grants.gov/x/g3' },
];
const requests: string[] = [];
const grantRequests = () => requests.filter((r) => r.startsWith('/api/grants'));

async function routedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  requests.push(`${url.pathname}${url.search}`);
  if (url.pathname === '/api/grants') {
    if (!url.search) {
      return Response.json({ agencies: [{ code: 'HHS', name: 'Health and Human Services' }, { code: 'EPA', name: 'Environmental Protection Agency' }], categories: [] });
    }
    const rows = url.searchParams.get('keyword') === 'health' && url.searchParams.get('agency') === 'HHS' ? ASK_ROWS : DEFAULT_ROWS;
    return Response.json({ success: true, grants: rows, total: rows.length, hasMore: false, hasProfile: false, sortedByRelevance: false });
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
const keywordInput = () => Array.from(host.querySelectorAll('input')).find((i) => i.placeholder.startsWith('Search grants')) as HTMLInputElement;
const selects = () => Array.from(host.querySelectorAll('select')) as HTMLSelectElement[];

async function renderPanel() {
  const { default: GrantsPanel } = await import('./GrantsPanel');
  act(() => root.render(<GrantsPanel email={EMAIL} tier={'pro' as never} />));
  await flush();
}

async function ask(text: string) {
  const input = $('tab-ask-input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
  await flush();
}

describe('GrantsPanel — Ask Mindy on the tab', () => {
  it('OFF by default: no box, and the page is identical to the panel without the feature', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    await renderPanel();
    expect($('tab-ask')).toBeNull();
    expect(host.textContent).toContain('Default grant: community water systems');
    const offHtml = host.innerHTML;
    const offRequests = [...grantRequests()];

    act(() => root.unmount());
    root = createRoot(host);
    requests.length = 0;
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    boxControl.hideBox = true; // the feature ON, minus the box itself
    await renderPanel();
    expect(host.innerHTML).toBe(offHtml);
    expect(grantRequests()).toEqual(offRequests);
  });

  it('ON: the answer fills the tab\'s own list via /api/grants, with a summary line; Clear restores', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    const box = $('tab-ask');
    expect(box).not.toBeNull();
    // The box sits above the tab's own search form and list.
    expect(box!.compareDocumentPosition(keywordInput()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    requests.length = 0;
    await ask('HHS health grants');

    // Exactly one list request, to the tab's existing API, with the tab's existing params.
    expect(grantRequests()).toEqual([
      `/api/grants?keyword=health&agency=HHS&status=posted&limit=25&offset=0&sort=relevance&email=${encodeURIComponent(EMAIL)}`,
    ]);
    // Rows render as the tab's normal grant cards.
    expect(host.textContent).toContain('Rural health outreach program');
    expect(host.textContent).toContain('Maternal health research');
    expect(host.textContent).not.toContain('Default grant: community water systems');
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched: HHS · health · open now — 2 grants');
    // The tab's own Keyword box and Agency dropdown now show what Mindy searched.
    expect(keywordInput().value).toBe('health');
    expect(selects()[0].value).toBe('HHS');

    requests.length = 0;
    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    await flush();
    expect(grantRequests()).toEqual([]);
    expect(host.textContent).toContain('Default grant: community water systems');
    expect(host.textContent).not.toContain('Rural health outreach program');
    expect(keywordInput().value).toBe('');
    expect(selects()[0].value).toBe('');
  });

  it('ON: a question the tab cannot express makes no request and offers chat', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    requests.length = 0;
    await ask('NIH grants in Texas');
    expect(grantRequests()).toEqual([]);
    expect($('tab-ask-chat')?.textContent).toContain('Ask Mindy in chat instead');
    expect(host.textContent).toContain('Default grant: community water systems');
  });
});
