// @vitest-environment jsdom
/**
 * Ask Mindy on the Recompetes tab, through the REAL RecompetesPanel in jsdom (fetch routed by URL):
 *  - OFF (default): no box, and the page + requests are identical to the panel without the feature.
 *  - ON: the question becomes the tab's own /api/recompete params, the answer fills the tab's normal
 *    Expiring Awards cards with a "Mindy searched: …" line, and Clear restores the previous list
 *    without a request.
 *  - A question the tab cannot express (a buyer, words) makes no request and offers chat.
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
// The DoDAAC directory is a module-level cache; keep it out so two renders make the same requests.
vi.mock('@/components/app/useDodaacNames', () => ({ useDodaacNames: () => new Map<string, string>() }));

const EMAIL = 'recompete-ask@example.com';
function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
const row = (id: string, description: string, naics: string, state: string) => ({
  contract_id: `CONT_${id}`, piid: id, incumbent_name: `${id} INCUMBENT LLC`, awarding_agency: 'Department of Veterans Affairs',
  naics_code: naics, description, total_obligation: 1_000_000, period_of_performance_start: '2022-01-01',
  period_of_performance_current_end: inDays(200), place_of_performance_state: state,
});
const PROFILE_ROWS = [row('P1', 'Profile recompete: data center support', '541512', 'MD')];
const ASK_ROWS = [
  row('A1', 'Hospital network modernization', '541512', 'VA'),
  row('A2', 'Clinic help desk services', '541512', 'VA'),
];
const requests: string[] = [];

async function routedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  requests.push(`${url.pathname}${url.search}`);
  if (url.pathname === '/api/recompete') {
    const rows = url.searchParams.get('state') === 'VA' ? ASK_ROWS : PROFILE_ROWS;
    return Response.json({ success: true, contracts: rows, pagination: { total: rows.length, capped: false } });
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
const recompeteRequests = () => requests.filter((r) => r.startsWith('/api/recompete'));

async function renderPanel() {
  const { default: RecompetesPanel } = await import('./RecompetesPanel');
  act(() => root.render(<RecompetesPanel email={EMAIL} tier={'pro' as never} />));
  await flush();
}

async function askQuestion(text: string) {
  const input = $('tab-ask-input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
  await flush();
}

const naicsInput = () => Array.from(host.querySelectorAll('input')).find((i) => i.placeholder === '541512, 236, 238') as HTMLInputElement;

describe('RecompetesPanel — Ask Mindy on the tab', () => {
  it('OFF by default: no box, and the page + requests are identical to the panel without the feature', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    await renderPanel();
    expect($('tab-ask')).toBeNull();
    expect(host.textContent).toContain('Profile recompete: data center support');
    // The profile request is exactly what the panel sent before this feature existed.
    expect(recompeteRequests()).toEqual(['/api/recompete?naics=541512&months=24&limit=200&sort=value&order=desc']);
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

  it('ON: the answer fills the tab\'s own Expiring Awards list via /api/recompete; Clear restores', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    const box = $('tab-ask');
    expect(box).not.toBeNull();
    const listHeading = Array.from(host.querySelectorAll('h3')).find((h) => /Expiring Awards/.test(h.textContent || ''))!;
    expect(box!.compareDocumentPosition(listHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    requests.length = 0;
    await askQuestion('541512 expiring contracts in Virginia, small business');

    // Exactly one request, to the tab's existing API, with the tab's existing params.
    expect(requests).toEqual(['/api/recompete?naics=541512&months=24&state=VA&eligibleFor=SB-Total&limit=200&sort=value&order=desc']);
    // Rows render as the tab's normal cards.
    expect(host.textContent).toContain('2 Expiring Awards');
    expect(host.textContent).toContain('Hospital network modernization');
    expect(host.textContent).not.toContain('Profile recompete: data center support');
    expect($('tab-ask-summary')?.textContent)
      .toContain('Mindy searched: NAICS 541512 · Small business · VA — 2 expiring contracts (Small business plus contracts with no set-aside recorded)');
    expect(naicsInput().value).toBe('541512');

    requests.length = 0;
    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    await flush();
    expect(requests).toEqual([]);
    expect(host.textContent).toContain('Profile recompete: data center support');
    expect(host.textContent).not.toContain('Hospital network modernization');
    expect(host.textContent).toContain('Using saved profile');
  });

  it('ON: a failed load reads "count unavailable", never 0', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return Response.json({ success: false, error: 'boom' });
    }));
    await askQuestion('541512 in Virginia');
    const summary = $('tab-ask-summary')?.textContent || '';
    expect(summary).toContain('expiring contracts count unavailable');
    expect(summary).not.toMatch(/— 0 /);
  });

  it('ON: a buyer or a words-only question makes no request and offers chat', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    for (const text of ['Navy cybersecurity recompetes', 'janitorial in Florida']) {
      requests.length = 0;
      await askQuestion(text);
      expect(requests, text).toEqual([]);
      expect($('tab-ask-chat')?.textContent).toContain('Ask Mindy in chat instead');
      expect(host.textContent).toContain('Profile recompete: data center support');
    }
  });
});
