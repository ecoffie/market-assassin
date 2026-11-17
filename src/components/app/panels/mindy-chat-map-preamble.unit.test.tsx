// @vitest-environment jsdom
/**
 * A Map conversation opened in the full workspace (/app?panel=chat): the Map's hidden
 * "[Current map view — …]" preamble is machine context for the model. It is never shown in the
 * customer's bubble, and the next question still sends it to the model in history.
 * Defect found live on prod 8bc5d3516 (Agent 4, 2026-11-17).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const VIEW = '[Current map view — 12 Open Now opps in view; in VA. Location: the map is filtered to VA. Answer for THIS view when the question is about "these"/"this"/"here".]\n\n';
const TYPED = 'Who buys janitorial work here?';

const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
vi.mock('../authHeaders', () => ({
  authedFetch: vi.fn(async (url: string, _email: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.startsWith('/api/app/chat-sessions') && url.includes('sessionId=')) {
      return { ok: true, status: 200, json: async () => ({ success: true, messages: [{ id: 'm1', role: 'user', content: VIEW + TYPED }, { id: 'm2', role: 'assistant', content: 'The Army buys most of it.' }] }) };
    }
    if (url === '/api/app/chat') {
      const enc = new TextEncoder();
      return { ok: true, status: 200, body: new ReadableStream({ start(c) { c.enqueue(enc.encode('data: {"type":"done"}\n\n')); c.close(); } }), json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, sessions: [], suggestions: [] }) };
  }),
}));
vi.mock('../UpgradeModal', () => ({ UpgradeModal: () => null }));

import MindyChatPanel from './MindyChatPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<MindyChatPanel email="pro@example.com" tier="pro" />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return el;
}

beforeEach(() => {
  calls.length = 0; sessionStorage.clear(); document.body.innerHTML = ''; Element.prototype.scrollIntoView = () => {};
  sessionStorage.setItem('mindy_chat_handoff', JSON.stringify({ v: 1, sessionId: 'sess-1', context: null }));
});

describe('Map view preamble in the full workspace', () => {
  it('the user bubble shows only what the customer typed', async () => {
    const el = await mount();
    expect(el.textContent).toContain(TYPED);
    expect(el.textContent).toContain('The Army buys most of it.');
    expect(el.textContent).not.toContain('Current map view');
    expect(el.textContent).not.toContain('Answer for THIS view');
  });
  it('the next question still sends the preamble to the model in history', async () => {
    const el = await mount();
    const ta = el.querySelector('textarea')!;
    const setVal = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => { setVal.call(ta, 'And in MD?'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const send = calls.find((c) => c.url === '/api/app/chat');
    expect(send).toBeTruthy();
    const history = send!.body!.history as Array<{ role: string; content: string }>;
    expect(history.find((h) => h.role === 'user')!.content).toBe(VIEW + TYPED);
    expect(send!.body!.message).toBe('And in MD?');
  });
});
