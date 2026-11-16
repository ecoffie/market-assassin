// @vitest-environment jsdom
/**
 * /app Ask Mindy panel picks up the Map drawer's "Open in full workspace" handoff: it loads that session,
 * shows the attached notice as a removable chip, sends only its id with the next question, and never
 * auto-sends.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
vi.mock('../authHeaders', () => ({
  authedFetch: vi.fn(async (url: string, _email: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.startsWith('/api/app/chat-sessions') && url.includes('sessionId=')) {
      return { ok: true, status: 200, json: async () => ({ success: true, messages: [{ id: 'm1', role: 'user', content: 'earlier question' }, { id: 'm2', role: 'assistant', content: 'earlier answer' }] }) };
    }
    if (url === '/api/pipeline') return { ok: true, status: 200, json: async () => ({ success: true, opportunity: { id: 'p-9' } }) };
    if (url === '/api/app/chat') {
      const enc = new TextEncoder();
      return { ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(enc.encode('data: {"type":"done"}\n\n')); c.close(); } }), json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, sessions: [], suggestions: [] }) };
  }),
}));
vi.mock('../UpgradeModal', () => ({ UpgradeModal: () => null }));

import MindyChatPanel from './MindyChatPanel';

const NID = '6ba812a7e0284f79bc44c4932777c340';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<MindyChatPanel email="pro@example.com" tier="pro" />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return el;
}

beforeEach(() => { calls.length = 0; sessionStorage.clear(); document.body.innerHTML = ''; Element.prototype.scrollIntoView = () => {}; });

describe('MindyChatPanel map handoff', () => {
  it('loads the session, shows the notice chip, consumes the key, and does not auto-send', async () => {
    sessionStorage.setItem('mindy_chat_handoff', JSON.stringify({ v: 1, sessionId: 'sess-1', context: { kind: 'opportunity', notice_id: NID, title: 'Janitorial, USCG Key West', deadline: '2026-12-04T17:00:00Z' } }));
    const el = await mount();
    expect(sessionStorage.getItem('mindy_chat_handoff')).toBeNull();
    expect(calls.some((c) => c.url.includes('sessionId=sess-1'))).toBe(true);
    expect(el.textContent).toContain('earlier answer');
    const chip = el.querySelector('[data-testid="attached-opp"]')!;
    expect(chip.textContent).toContain('Janitorial, USCG Key West');
    expect(chip.textContent).toContain('due 2026-12-04');
    expect(calls.some((c) => c.url === '/api/app/chat')).toBe(false);
  });
  it('the next question carries only the notice id; removing the chip drops it', async () => {
    sessionStorage.setItem('mindy_chat_handoff', JSON.stringify({ v: 1, sessionId: null, context: { kind: 'opportunity', notice_id: NID, title: 'T', deadline: '' } }));
    const el = await mount();
    const ta = el.querySelector('textarea')!;
    const setVal = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    const send = async (q: string) => {
      await act(async () => { setVal.call(ta, q); ta.dispatchEvent(new Event('input', { bubbles: true })); });
      await act(async () => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    };
    await send('Who held this before?');
    const first = calls.filter((c) => c.url === '/api/app/chat')[0];
    expect(first.body!.context).toEqual({ kind: 'opportunity', notice_id: NID });
    expect(JSON.stringify(first.body)).not.toContain('"T"');
    await act(async () => { (el.querySelector('[aria-label="Remove this opportunity from the question"]') as HTMLButtonElement).click(); });
    expect(el.querySelector('[data-testid="attached-opp"]')).toBeNull();
    await send('Next?');
    const second = calls.filter((c) => c.url === '/api/app/chat')[1];
    expect(second.body!.context).toBeUndefined();
  });
  it('no handoff → no chip', async () => {
    const el = await mount();
    expect(el.querySelector('[data-testid="attached-opp"]')).toBeNull();
  });
});

describe('MindyChatPanel Start a proposal', () => {
  it('only on click: tracks the notice and opens Proposals on that pursuit in-app', async () => {
    sessionStorage.setItem('mindy_chat_handoff', JSON.stringify({ v: 1, sessionId: null, context: { kind: 'opportunity', notice_id: NID, title: 'T', deadline: '' } }));
    const onPanelChange = vi.fn();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(<MindyChatPanel email="pro@example.com" tier="pro" onPanelChange={onPanelChange} />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(calls.some((c) => c.url === '/api/pipeline')).toBe(false);
    const btn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent === 'Start a proposalSaves to My Pursuits')!;
    await act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 20)); });
    const post = calls.find((c) => c.url === '/api/pipeline')!;
    expect(post.body).toMatchObject({ user_email: 'pro@example.com', notice_id: NID, source: 'ask_mindy' });
    expect(onPanelChange).toHaveBeenCalledWith('proposals', { pursuit_id: 'p-9' });
  });
});
