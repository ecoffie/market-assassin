// @vitest-environment jsdom
/**
 * Ask Mindy on the Partner Finder tab, through the REAL PartnerFinderPanel in jsdom (fetch routed by URL):
 *  - OFF (default): no box, and the page is byte-identical to the panel without the feature.
 *  - ON: the question becomes the tab's own /api/app/capability-search params, the answer fills the
 *    tab's normal match cards with a "Mindy searched: …" line, and Clear restores without a request.
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

const EMAIL = 'partner-ask@example.com';
const match = (uei: string, name: string, label: string) => ({
  rollup_uei: uei, rollup_name: name, state: 'VA', capability_label: label, capability_summary: null,
  specialty_tier: 'focused', award_count: 7, total_obligated: 1_200_000, similarity: 0.61,
});
const BEFORE_ROWS = [match('UEI-B1', 'Firebreak Crews LLC', 'Wildland fire suppression')];
const ASK_ROWS = [
  match('UEI-A1', 'Shield Cyber Inc', 'Network defense and SOC'),
  match('UEI-A2', 'Old Dominion Secure', 'Cybersecurity assessment'),
];
const requests: string[] = [];

async function routedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  if (url.pathname === '/api/app/capability-search') {
    requests.push(`${url.pathname}${url.search}`);
    const rows = url.searchParams.get('q') === 'cybersecurity' ? ASK_ROWS : BEFORE_ROWS;
    return Response.json({ success: true, matches: rows, scanned: 71000, anchor: null });
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
const setter = () => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
const typeInto = (input: HTMLInputElement, v: string) => act(() => { setter().call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })); });
const describeInput = () => Array.from(host.querySelectorAll('input')).find((i) => /Describe the work/.test(i.placeholder)) as HTMLInputElement;
const stateInput = () => Array.from(host.querySelectorAll('input')).find((i) => i.placeholder === 'State (e.g. VA)') as HTMLInputElement;

async function renderPanel() {
  const { default: PartnerFinderPanel } = await import('./PartnerFinderPanel');
  act(() => root.render(<PartnerFinderPanel email={EMAIL} tier={'pro' as never} />));
  await flush();
}

/** Run the tab's own search form, the way a user would, so there is a list on screen before asking. */
async function searchByHand(q: string) {
  typeInto(describeInput(), q);
  const find = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Find') as HTMLButtonElement;
  await act(async () => { find.click(); });
  await flush();
}

describe('PartnerFinderPanel — Ask Mindy on the tab', () => {
  it('OFF by default: no box, and the page is identical to the panel without the feature', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    await renderPanel();
    expect($('tab-ask')).toBeNull();
    expect($('tab-ask-slot')).toBeNull();
    await searchByHand('wildland firefighting crews');
    expect(host.textContent).toContain('Firebreak Crews LLC');
    const offHtml = host.innerHTML;
    const offRequests = [...requests];

    act(() => root.unmount());
    root = createRoot(host);
    requests.length = 0;
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    boxControl.hideBox = true; // the feature ON, minus the box itself
    await renderPanel();
    await searchByHand('wildland firefighting crews');
    // Only difference allowed: the (now empty) spacing slot the box lives in when the switch is ON.
    expect(host.innerHTML.replace('<div class="mb-4" data-testid="tab-ask-slot"></div>', '')).toBe(offHtml);
    expect(requests).toEqual(offRequests);
  });

  it('ON: the answer fills the tab\'s own list via /api/app/capability-search, with a summary line; Clear restores', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    await searchByHand('wildland firefighting crews');
    expect(host.textContent).toContain('Firebreak Crews LLC');
    const box = $('tab-ask');
    expect(box).not.toBeNull();
    // The box sits above the tab's list (and its search controls).
    const firstCard = Array.from(host.querySelectorAll('span')).find((s) => s.textContent === 'Firebreak Crews LLC')!;
    expect(box!.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    requests.length = 0;
    typeInto($('tab-ask-input') as HTMLInputElement, 'cybersecurity partners in Virginia');
    await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
    await flush();

    // Exactly one request, to the tab's existing API, with the tab's existing params.
    expect(requests).toEqual(['/api/app/capability-search?q=cybersecurity&state=VA&limit=25']);
    // Rows render as the tab's normal match cards.
    expect(host.textContent).toContain('2 matches from 71,000 profiles');
    expect(host.textContent).toContain('Shield Cyber Inc');
    expect(host.textContent).not.toContain('Firebreak Crews LLC');
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched: cybersecurity · VA — 2 partner matches');
    // The tab's own inputs now show what Mindy searched.
    expect(describeInput().value).toBe('cybersecurity');
    expect(stateInput().value).toBe('VA');

    requests.length = 0;
    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    await flush();
    expect(requests).toEqual([]);
    expect(host.textContent).toContain('Firebreak Crews LLC');
    expect(host.textContent).not.toContain('Shield Cyber Inc');
    expect(describeInput().value).toBe('wildland firefighting crews');
    expect(stateInput().value).toBe('');
  });

  it('ON: a question the tab cannot express makes no request and offers chat', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    requests.length = 0;
    typeInto($('tab-ask-input') as HTMLInputElement, 'Navy cybersecurity partners');
    await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
    await flush();
    expect(requests).toEqual([]);
    expect($('tab-ask-chat')?.textContent).toContain('Ask Mindy in chat instead');
  });
});
