// @vitest-environment jsdom
/**
 * Ask Mindy on the Contacts tab, through the REAL RelationshipsPanel in jsdom (fetch routed by URL):
 *  - OFF (default): no box, and the page is byte-identical to the panel without the feature.
 *  - ON: the question becomes the tab's own /api/app/relationships params (sub-list + search + NAICS +
 *    agency boxes), the answer fills the tab's normal list with a "Mindy searched: …" line, and Clear
 *    restores the previous filters + rows without a request.
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

const EMAIL = 'contacts-ask@example.com';
const row = (id: string, name: string, type: string, agency: string) => ({
  id, contact_type: type, full_name: name, title: 'Contracting Officer', agency, organization: agency,
  source_record_id: id, created_at: '2026-11-01T00:00:00Z',
});
const SAVED = [row('s1', 'Saved Person', 'government_buyer', 'DEPT OF ENERGY')];
const SAVED_SMITH = [row('s2', 'Pat Smith', 'prime', 'Acme Corp')];
const NAVY_BUYERS = [
  row('b1', 'Navy Buyer One', 'government_buyer', 'DEPT OF THE NAVY'),
  row('b2', 'Navy Buyer Two', 'government_buyer', 'DEPT OF THE NAVY'),
];
const requests: string[] = [];
const relRequests = (mode: string) => requests.filter((r) => r.startsWith('/api/app/relationships?') && r.includes(`mode=${mode}`));

async function routedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  requests.push(`${url.pathname}${url.search}`);
  if (url.pathname === '/api/app/target-list') return Response.json({ success: true, targets: [] });
  if (url.pathname === '/api/app/relationships') {
    const mode = url.searchParams.get('mode');
    if (mode === 'pursuits') return Response.json({ success: true, pursuits: [] });
    if (mode === 'saved') {
      const contacts = url.searchParams.get('search') === 'smith' ? SAVED_SMITH : SAVED;
      return Response.json({ success: true, contacts, links: [] });
    }
    if (mode === 'candidates') {
      const hit = url.searchParams.get('agency') === 'navy' && url.searchParams.get('search') === 'contracting officers';
      const candidates = hit ? NAVY_BUYERS : [];
      return Response.json({ success: true, candidates, total: candidates.length, truncated: false });
    }
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
// The tab debounces its candidate search by 350 ms (existing behaviour) — wait it out.
const settle = async () => { await flush(); await act(async () => { await new Promise((r) => setTimeout(r, 420)); }); await flush(); };
const searchBox = () => Array.from(host.querySelectorAll('input')).find((i) => i.placeholder.startsWith('Name, agency, company')) as HTMLInputElement;
const agencyBox = () => Array.from(host.querySelectorAll('input')).find((i) => i.placeholder === 'VA, DHS, GSA') as HTMLInputElement | undefined;

async function renderPanel() {
  const { default: RelationshipsPanel } = await import('./RelationshipsPanel');
  act(() => root.render(<RelationshipsPanel email={EMAIL} tier={'pro' as never} />));
  await settle();
}

async function ask(q: string) {
  const input = $('tab-ask-input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, q); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
  await settle();
}

describe('RelationshipsPanel — Ask Mindy on the Contacts tab', () => {
  it('OFF by default: no box, and the page is identical to the panel without the feature', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    await renderPanel();
    expect($('tab-ask')).toBeNull();
    expect(host.textContent).toContain('Saved Person');
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

  it('ON: the answer fills the tab\'s own list via /api/app/relationships, with a summary line; Clear restores', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    const box = $('tab-ask');
    expect(box).not.toBeNull();
    // The box sits above the tab's list.
    const listHeading = Array.from(host.querySelectorAll('h2')).find((h) => /My Saved Contacts/.test(h.textContent || ''))!;
    expect(box!.compareDocumentPosition(listHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    requests.length = 0;
    await ask('contracting officers at the Navy');

    // My Saved Contacts can't filter by agency + words, so the question runs on Gov Buyers — ONE
    // candidate request with the tab's own params (the same request typing in the boxes sends).
    expect(relRequests('candidates')).toEqual([
      `/api/app/relationships?email=${encodeURIComponent(EMAIL)}&mode=candidates&type=government_buyer&search=contracting+officers&agency=navy`,
    ]);
    expect(host.textContent).toContain('Search results · Gov Buyers');
    expect(host.textContent).toContain('Navy Buyer One');
    expect(host.textContent).toContain('Navy Buyer Two');
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched: Navy · contracting officers — 2 contacts');
    // The tab's own boxes now show what Mindy searched.
    expect(searchBox().value).toBe('contracting officers');
    expect(agencyBox()?.value).toBe('navy');

    requests.length = 0;
    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    await settle();
    expect(requests).toEqual([]);
    expect(host.textContent).toContain('Saved Person');
    expect(host.textContent).not.toContain('Navy Buyer One');
    expect(searchBox().value).toBe('');
    expect(agencyBox()).toBeUndefined(); // back on My Saved Contacts, which has no Agency box
  });

  it('ON: a My Network question searches the saved list', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    requests.length = 0;
    await ask('Smith in my network');
    expect(relRequests('saved')).toEqual([`/api/app/relationships?email=${encodeURIComponent(EMAIL)}&mode=saved&type=all&search=smith`]);
    expect(relRequests('candidates')).toEqual([]);
    expect(host.textContent).toContain('Pat Smith');
    expect(host.textContent).not.toContain('Saved Person');
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched: My Saved Contacts · smith — 1 contact');
  });

  it('ON: a question the tab cannot express makes no request and offers chat', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    requests.length = 0;
    await ask('contracting officers in Virginia');
    expect(requests).toEqual([]);
    expect($('tab-ask-chat')?.textContent).toContain('Ask Mindy in chat instead');
    expect(host.textContent).toContain('Saved Person');
  });
});
