// @vitest-environment jsdom
/**
 * The pipeline tab coach highlights `[data-tip="pipeline-card"]` and `[data-tip="pipeline-draft"]`.
 * PipelinePanel opens in the LIST view, so both anchors must exist there — not only on Board cards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PipelinePanel from './PipelinePanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPPS = [
  {
    id: 'p1', user_email: 'demo@example.com', owner_email: 'demo@example.com', notice_id: 'N1',
    title: 'Cyber support services', agency: 'Department of Example', stage: 'pursuing', priority: 'high',
    response_deadline: '2099-01-15', docs_status: 'ready', docs_count: 2, created_at: '2026-11-01T00:00:00Z',
  },
  {
    id: 'p2', user_email: 'demo@example.com', owner_email: 'demo@example.com', notice_id: 'N2',
    title: 'Facilities maintenance', agency: 'Department of Example', stage: 'tracking', priority: 'medium',
    response_deadline: '2099-02-15', docs_status: 'none', docs_count: 0, created_at: '2026-11-02T00:00:00Z',
  },
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.startsWith('/api/pipeline') ? { opportunities: OPPS, stats: {} } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render() {
  await act(async () => {
    root.render(<PipelinePanel email="demo@example.com" tier="pro" onPanelChange={() => {}} />);
  });
  for (let i = 0; i < 20 && !document.querySelector('tbody tr'); i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  }
}

describe('pipeline tab coach anchors', () => {
  it('default List view: each row is a pipeline-card and its Draft / Upload button is a pipeline-draft', async () => {
    await render();
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows.length).toBe(2);
    const cards = Array.from(document.querySelectorAll('[data-tip="pipeline-card"]'));
    expect(cards.length).toBe(2);
    expect(cards.every(c => c.tagName === 'TR')).toBe(true);
    const drafts = Array.from(document.querySelectorAll('[data-tip="pipeline-draft"]'));
    expect(drafts.length).toBe(2); // pen (docs ready) + paperclip (no docs) — list shows it on every row
    expect(drafts.every(d => d.tagName === 'BUTTON' && d.closest('tr'))).toBe(true);
  });

  it('Board view keeps both anchors on the cards', async () => {
    await render();
    const boardBtn = Array.from(document.querySelectorAll('[data-tip="pipeline-view-toggle"] button'))
      .find(b => /board/i.test(b.textContent || '')) as HTMLButtonElement;
    expect(boardBtn).toBeTruthy();
    await act(async () => { boardBtn.click(); });
    const cards = Array.from(document.querySelectorAll('[data-tip="pipeline-card"]'));
    expect(cards.length).toBe(2);
    expect(cards.every(c => c.tagName === 'DIV')).toBe(true);
    // Board shows Draft only on Pursuing / Bidding / Submitted cards.
    expect(document.querySelectorAll('[data-tip="pipeline-draft"]').length).toBe(1);
  });
});
