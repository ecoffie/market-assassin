// @vitest-environment jsdom
/**
 * Ask Mindy on the Pricing Intel tab, through the REAL PricingIntelPanel in jsdom (fetch routed by URL):
 *  - OFF (default): no box, and the page is byte-identical to the panel without the feature.
 *  - ON: the question becomes the tab's own /api/app/pricing-intel param (naics or keyword), the answer
 *    fills the tab's normal labor-category table with a "Mindy searched: …" line, and Clear restores
 *    the previous report without a request.
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

const EMAIL = 'pricing-ask@example.com';
const cat = (category: string, median: number) => ({
  category, recordCount: 40, median, percentile25: median - 10, percentile75: median + 10,
  min: median - 30, max: median + 30, avg: median, nextYearMedian: null,
});
const report = (naicsCode: string, naicsDescription: string, cats: ReturnType<typeof cat>[]) => ({
  laborCategories: cats,
  businessSizeComparison: { smallBusiness: { median: 100, count: 10, avg: 100 }, largeBusiness: { median: 110, count: 10, avg: 110 }, gapPercent: 9.1 },
  rateDistribution: [],
  priceToWinGuidance: { aggressiveRate: 90, competitiveRate: 100, premiumRate: 120 },
  topVendors: [],
  naicsCode, naicsDescription, totalRecordsAnalyzed: 80,
});
const NAICS_REPORT = report('541512', 'Computer Systems Design Services', [cat('Systems Analyst', 101)]);
const ROLE_REPORT = report('', 'Labor categories: software engineer', [cat('Software Engineer II', 132), cat('Software Engineer III', 151)]);
const requests: string[] = [];

async function routedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  if (url.pathname === '/api/app/pricing-intel') {
    requests.push(`${url.pathname}${url.search}`);
    const data = url.searchParams.get('keyword') ? ROLE_REPORT : NAICS_REPORT;
    return Response.json({ success: true, data });
  }
  if (url.pathname === '/api/app/workspace') return Response.json({ user: { naics_codes: ['541512'] } });
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
const typeInto = (input: HTMLInputElement, v: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const naicsInput = () => Array.from(host.querySelectorAll('input')).find((i) => i.placeholder === '541512') as HTMLInputElement | undefined;
const roleInput = () => Array.from(host.querySelectorAll('input')).find((i) => i.placeholder === 'Software Engineer, Project Manager') as HTMLInputElement | undefined;

async function renderPanel() {
  const { default: PricingIntelPanel } = await import('./PricingIntelPanel');
  act(() => root.render(<PricingIntelPanel email={EMAIL} tier={'pro' as never} />));
  await flush();
}

/** Run the tab's own NAICS report (pre-filled from the profile), so there is a report on screen. */
async function runByHand() {
  const run = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Run Pricing Intel') as HTMLButtonElement;
  await act(async () => { run.click(); });
  await flush();
}

describe('PricingIntelPanel — Ask Mindy on the tab', () => {
  it('OFF by default: no box, and the page is identical to the panel without the feature', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    await renderPanel();
    expect($('tab-ask')).toBeNull();
    await runByHand();
    expect(host.textContent).toContain('Systems Analyst');
    const offHtml = host.innerHTML;
    const offRequests = [...requests];

    act(() => root.unmount());
    root = createRoot(host);
    requests.length = 0;
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    boxControl.hideBox = true; // the feature ON, minus the box itself
    await renderPanel();
    await runByHand();
    expect(host.innerHTML).toBe(offHtml);
    expect(requests).toEqual(offRequests);
  });

  it('ON: the answer fills the tab\'s own table via /api/app/pricing-intel, with a summary line; Clear restores', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    await runByHand();
    expect(host.textContent).toContain('Systems Analyst');
    const box = $('tab-ask');
    expect(box).not.toBeNull();
    const tableHeading = Array.from(host.querySelectorAll('h3')).find((h) => h.textContent === 'Labor Categories')!;
    expect(box!.compareDocumentPosition(tableHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    requests.length = 0;
    typeInto($('tab-ask-input') as HTMLInputElement, 'labor rates for software engineer');
    await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
    await flush();

    // Exactly one request, to the tab's existing API, with the tab's existing Labor Category param.
    expect(requests).toEqual([`/api/app/pricing-intel?email=${encodeURIComponent(EMAIL)}&keyword=software%20engineer`]);
    // Rows render as the tab's normal labor-category table.
    expect(host.textContent).toContain('Software Engineer III');
    expect(host.textContent).toContain('2 shown · sorted by record count');
    expect(host.textContent).not.toContain('Systems Analyst');
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched: roles “software engineer” — 2 labor categories');
    // The tab switched to its own "By Labor Category" mode with the role filled in.
    expect(roleInput()?.value).toBe('software engineer');

    requests.length = 0;
    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    await flush();
    expect(requests).toEqual([]);
    expect(host.textContent).toContain('Systems Analyst');
    expect(host.textContent).not.toContain('Software Engineer III');
    expect(naicsInput()?.value).toBe('541512');
  });

  it('ON: a question the tab cannot express makes no request and offers chat', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    requests.length = 0;
    typeInto($('tab-ask-input') as HTMLInputElement, 'what should I charge for a help desk technician');
    await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
    await flush();
    expect(requests).toEqual([]);
    expect($('tab-ask-chat')?.textContent).toContain('Ask Mindy in chat instead');
  });
});
