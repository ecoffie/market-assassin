// @vitest-environment jsdom
/**
 * Research mode for everyone, labelled BETA: a research turn's {type:'mode', mode:'research', beta:true, label}
 * event tags that answer ("Research · Beta") in its header and on its progress line; a reopened research answer
 * (sessions route research_mode {label}) keeps the tag; standard answers never get one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
const enc = new TextEncoder();
const push = async (e: Record<string, unknown>) => { await act(async () => { ctrl!.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); await new Promise((r) => setTimeout(r, 10)); }); };
let reopened: Array<Record<string, unknown>> = [];

vi.mock('../authHeaders', () => ({
  authedFetch: vi.fn(async (url: string) => {
    if (url === '/api/app/chat') return { ok: true, status: 200, body: new ReadableStream({ start(c) { ctrl = c; } }), json: async () => ({}) };
    if (url.startsWith('/api/app/chat-sessions') && url.includes('sessionId=')) return { ok: true, status: 200, json: async () => ({ success: true, messages: reopened }) };
    return { ok: true, status: 200, json: async () => ({ success: true, sessions: [], suggestions: [] }) };
  }),
}));
vi.mock('../UpgradeModal', () => ({ UpgradeModal: () => null }));

import MindyChatPanel from './MindyChatPanel';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => { sessionStorage.clear(); document.body.innerHTML = ''; Element.prototype.scrollIntoView = () => {}; reopened = []; });

async function mount(): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<MindyChatPanel email="pro@example.com" tier="pro" />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}
async function ask(el: HTMLElement, q: string) {
  const ta = el.querySelector('textarea')!;
  const setVal = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => { setVal.call(ta, q); ta.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}
const tags = (el: HTMLElement) => [...el.querySelectorAll('[data-testid="research-beta-tag"]')].map((t) => t.textContent);

describe('Ask Mindy /app: Research · Beta tag', () => {
  it('a research turn is tagged in its header and on its progress line, and keeps the tag after the answer', async () => {
    const el = await mount();
    await ask(el, 'Assess Ridgeline Digital');
    await push({ type: 'mode', mode: 'research', beta: true, label: 'Research · Beta' });
    await push({ type: 'progress', message: 'Checking company registration.' });
    expect(tags(el)).toEqual(['Research · Beta']);
    expect(el.querySelector('[data-testid="research-progress-tag"]')?.textContent).toBe('Research · Beta');
    await push({ type: 'token', content: 'Start with the Navy recruiting campaign.' });
    await push({ type: 'done' });
    await act(async () => { ctrl!.close(); await new Promise((r) => setTimeout(r, 20)); });
    expect(tags(el)).toEqual(['Research · Beta']);
  });

  it('a standard turn (no mode event) has no tag; a non-beta or malformed mode event adds none', async () => {
    const el = await mount();
    await ask(el, 'hello');
    await push({ type: 'mode', mode: 'research', beta: false, label: 'Research' });
    await push({ type: 'mode', mode: 'standard' });
    await push({ type: 'token', content: 'Hi.' });
    await push({ type: 'done' });
    await act(async () => { ctrl!.close(); await new Promise((r) => setTimeout(r, 20)); });
    expect(tags(el)).toEqual([]);
  });

  it('the label is shown as plain text and bounded', async () => {
    const el = await mount();
    await ask(el, 'q');
    await push({ type: 'mode', mode: 'research', beta: true, label: '<img src=x onerror=alert(1)>'.repeat(3) });
    expect(tags(el)).toEqual(['Research · Beta']); // over 40 characters → the default
    expect(el.querySelector('[data-testid="research-beta-tag"] img')).toBeNull();
  });

  it('a reopened research answer keeps its tag; other answers in the conversation do not get one', async () => {
    reopened = [
      { id: 'u1', role: 'user', content: 'Assess Ridgeline' },
      { id: 'a1', role: 'assistant', content: 'Research answer.', research_mode: { label: 'Research · Beta' } },
      { id: 'u2', role: 'user', content: 'thanks' },
      { id: 'a2', role: 'assistant', content: 'Standard answer.' },
    ];
    sessionStorage.setItem('mindy_chat_handoff', JSON.stringify({ v: 1, sessionId: 'sess-r' }));
    const el = await mount();
    expect(el.textContent).toContain('Standard answer.');
    expect(tags(el)).toEqual(['Research · Beta']);
  });
});
