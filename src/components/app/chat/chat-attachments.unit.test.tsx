// @vitest-environment jsdom
/**
 * Ask Mindy attach UI: says formats are saved privately, uploads to the conversation (minting one
 * when the chat is new), shows the server's refusal reason (CUI/classified/too large) and keeps nothing,
 * removes a file from the conversation, reloads per conversation. The panel shows it only behind the flag.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const SID = '0b0b0b0b-1111-4222-8333-444444444444';
const calls: Array<{ url: string; method: string; file?: string }> = [];
const next = { post: { status: 201, body: { success: true, document: { id: 'd1', filename: 'rfp.pdf', page_count: 3 } } } as { status: number; body: Record<string, unknown> } };

vi.mock('../authHeaders', () => ({
  authedFetch: vi.fn(async (url: string, _email: string, init?: { method?: string; body?: FormData }) => {
    const method = init?.method || 'GET';
    const f = init?.body instanceof FormData ? (init.body.get('file') as File | null) : null;
    calls.push({ url, method, file: f?.name });
    if (method === 'POST') return { ok: next.post.status < 300, status: next.post.status, json: async () => next.post.body };
    if (method === 'DELETE') return { ok: true, status: 200, json: async () => ({ success: true }) };
    return { ok: true, status: 200, json: async () => ({ success: true, documents: url.includes(SID) ? [{ id: 'd0', filename: 'earlier.docx' }] : [] }) };
  }),
}));

import { ChatAttachments } from './ChatAttachments';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

async function mount(props: { sessionId: string | null; ensure?: () => string }) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  const ensure = props.ensure ?? vi.fn(() => SID);
  await act(async () => { root.render(<ChatAttachments email="pro@example.com" sessionId={props.sessionId} ensureSessionId={ensure} />); });
  await tick();
  return { el, root, ensure };
}
async function pick(el: HTMLElement, name: string, size = 10) {
  const input = el.querySelector('[data-testid="attach-input"]') as HTMLInputElement;
  const file = new File(['x'.repeat(size)], name, { type: 'application/pdf' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await tick();
}

beforeEach(() => { calls.length = 0; next.post = { status: 201, body: { success: true, document: { id: 'd1', filename: 'rfp.pdf', page_count: 3 } } }; });
afterEach(() => { document.body.innerHTML = ''; });

describe('ChatAttachments', () => {
  it('names the allowed formats and that they are saved privately', async () => {
    const { el } = await mount({ sessionId: null });
    expect(el.textContent).toMatch(/PDF, Word, Excel, or CSV/i);
    expect(el.textContent).toMatch(/saved privately/i);
  });

  it('accept list includes spreadsheet uploads (xlsx/xls/csv)', async () => {
    const { el } = await mount({ sessionId: null });
    const input = el.querySelector('[data-testid="attach-input"]') as HTMLInputElement;
    expect(input.accept).toContain('.xlsx');
    expect(input.accept).toContain('.csv');
  });

  it('new chat: mints a conversation, uploads to it, shows the chip', async () => {
    const { el, ensure } = await mount({ sessionId: null });
    await pick(el, 'rfp.pdf');
    expect(ensure).toHaveBeenCalled();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toContain(`session_id=${SID}`);
    expect(post.file).toBe('rfp.pdf');
    expect(el.querySelectorAll('[data-testid="attached-doc"]')).toHaveLength(1);
  });

  it('a refused file shows the server reason and adds no chip', async () => {
    next.post = { status: 422, body: { success: false, error: 'prohibited_marking', message: 'This file carries a CUI (Controlled Unclassified Information) marking, so Mindy did not accept it. Nothing from this file was saved.' } };
    const { el } = await mount({ sessionId: SID });
    const before = el.querySelectorAll('[data-testid="attached-doc"]').length;
    await pick(el, 'roster.docx');
    expect(el.querySelector('[data-testid="attach-error"]')?.textContent).toMatch(/CUI.*Nothing from this file was saved/);
    expect(el.querySelectorAll('[data-testid="attached-doc"]')).toHaveLength(before);
  });

  it('over 4 MB is stopped before upload with a clear message', async () => {
    const { el } = await mount({ sessionId: SID });
    await pick(el, 'big.pdf', 4 * 1024 * 1024 + 1);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(el.querySelector('[data-testid="attach-error"]')?.textContent).toMatch(/up to 4 MB/);
  });

  it('reopening a conversation lists its documents; remove sends DELETE for that conversation', async () => {
    const { el } = await mount({ sessionId: SID });
    expect(el.textContent).toContain('earlier.docx');
    const btn = el.querySelector('button[aria-label^="Remove earlier.docx"]') as HTMLButtonElement;
    await act(async () => { btn.click(); });
    await tick();
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(del.url).toContain(`session_id=${SID}`);
    expect(del.url).toContain('id=d0');
    expect(el.textContent).not.toContain('earlier.docx');
  });
});
