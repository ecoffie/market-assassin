// @vitest-environment jsdom
/**
 * Ask Mindy on the Knowledge Base tab, through the REAL KnowledgeBasePanel in jsdom (fetch routed by URL):
 *  - OFF (default): no box, and the page is byte-identical to the panel without the feature.
 *  - ON: the question becomes the tab's own /api/app/knowledge-base `q`, the answer fills the tab's normal
 *    document list with a "Mindy searched: …" line, and Clear restores the previous list without a request.
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

const EMAIL = 'kb-ask@example.com';
const doc = (id: string, title: string) => ({ id, title, docType: 'template', docTypeLabel: 'Template', summary: '', naics: null, words: 100, pages: null });
const ALL_DOCS = [doc('d1', 'Winning proposal: data center support')];
const ASK_DOCS = [doc('a1', 'Capability statement template'), doc('a2', 'Capability statement examples')];
const FACETS = [{ docType: 'template', label: 'Template', count: 40 }];
const requests: string[] = [];

async function routedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  requests.push(`${url.pathname}${url.search}`);
  if (url.pathname === '/api/app/knowledge-base') {
    const asked = url.searchParams.get('q') === 'capability statement';
    const rows = asked ? ASK_DOCS : ALL_DOCS;
    return Response.json({ success: true, total: asked ? 2 : 40, docs: rows, facets: FACETS });
  }
  if (url.pathname === '/api/app/rag-doc') return Response.json({ full_text: `Body of ${url.searchParams.get('id')}` });
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
// The tab's document LIST (left pane) — the preview pane on the right keeps whichever doc is open.
const listText = () => Array.from(host.querySelectorAll('button')).map((b) => b.textContent || '').join('\n');
const searchInput = () => Array.from(host.querySelectorAll('input')).find((i) => i.placeholder === 'Search the knowledge base…') as HTMLInputElement;

async function renderPanel() {
  const { default: KnowledgeBasePanel } = await import('./KnowledgeBasePanel');
  act(() => root.render(<KnowledgeBasePanel email={EMAIL} />));
  await flush();
}

async function ask(question: string) {
  const input = $('tab-ask-input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(input, question); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ($('tab-ask-submit') as HTMLButtonElement).click(); });
  await flush();
}

describe('KnowledgeBasePanel — Ask Mindy on the tab', () => {
  it('OFF by default: no box, and the page is identical to the panel without the feature', async () => {
    delete process.env.NEXT_PUBLIC_TAB_ASK;
    await renderPanel();
    expect($('tab-ask')).toBeNull();
    expect(host.textContent).toContain('Winning proposal: data center support');
    const offHtml = host.innerHTML;
    const offRequests = [...requests];

    act(() => root.unmount());
    root = createRoot(host);
    requests.length = 0;
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    boxControl.hideBox = true; // the feature ON, minus the box itself (its wrapper div stays empty)
    await renderPanel();
    expect(host.innerHTML.replace('<div class="mb-4"></div>', '')).toBe(offHtml);
    expect(requests).toEqual(offRequests);
  });

  it('ON: the answer fills the tab\'s own list via /api/app/knowledge-base; Clear restores without a request', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    const box = $('tab-ask');
    expect(box).not.toBeNull();
    expect(box!.compareDocumentPosition(searchInput()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    requests.length = 0;
    await ask('capability statement documents');

    const listCalls = requests.filter((r) => r.startsWith('/api/app/knowledge-base'));
    expect(listCalls).toEqual([`/api/app/knowledge-base?email=${encodeURIComponent(EMAIL)}&q=capability+statement`]);
    expect(listText()).toContain('Capability statement template');
    expect(listText()).toContain('Capability statement examples');
    expect(listText()).not.toContain('Winning proposal: data center support');
    expect($('tab-ask-summary')?.textContent).toContain('Mindy searched: “capability statement” in titles and summaries — 2 documents');
    expect(searchInput().value).toBe('capability statement');

    requests.length = 0;
    act(() => { ($('tab-ask-clear') as HTMLButtonElement).click(); });
    await flush();
    expect(requests).toEqual([]);
    expect(listText()).toContain('Winning proposal: data center support');
    expect(listText()).not.toContain('Capability statement examples');
    expect(host.textContent).toContain('All (40)');
    expect(searchInput().value).toBe('');
  });

  it('ON: a question the tab cannot express makes no request and offers chat', async () => {
    process.env.NEXT_PUBLIC_TAB_ASK = 'on';
    await renderPanel();
    requests.length = 0;
    await ask('Navy cybersecurity proposals');
    expect(requests).toEqual([]);
    expect($('tab-ask-chat')?.textContent).toContain('Ask Mindy in chat instead');
    expect(host.textContent).toContain('Winning proposal: data center support');
  });
});
