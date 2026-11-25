// @vitest-environment jsdom
/**
 * Research mode (Mindy Day 11/28): a turn can run for minutes. 'progress' events are STEPS shown in a calm panel —
 * timer, current step, count, Show steps, and a "still working" line after a quiet stretch — never as amber
 * warnings. When the answer arrives the panel collapses to "Researched · N steps · m:ss". 'notice' stays a warning.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
const enc = new TextEncoder();
const push = async (e: Record<string, unknown>) => { await act(async () => { ctrl!.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); await new Promise((r) => setTimeout(r, 10)); }); };

vi.mock('../authHeaders', () => ({
  authedFetch: vi.fn(async (url: string) => {
    if (url === '/api/app/chat') return { ok: true, status: 200, body: new ReadableStream({ start(c) { ctrl = c; } }), json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ success: true, sessions: [], suggestions: [] }) };
  }),
}));
vi.mock('../UpgradeModal', () => ({ UpgradeModal: () => null }));

import MindyChatPanel from './MindyChatPanel';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let clock = 1_000_000;
beforeEach(() => {
  clock = 1_000_000; vi.spyOn(Date, 'now').mockImplementation(() => clock);
  sessionStorage.clear(); document.body.innerHTML = ''; Element.prototype.scrollIntoView = () => {};
});
afterEach(() => { vi.restoreAllMocks(); });

async function ask(): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<MindyChatPanel email="pro@example.com" tier="pro" />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const ta = el.querySelector('textarea')!;
  const setVal = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => { setVal.call(ta, 'Assess Ridgeline Digital for Navy marketing work'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return el;
}
const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`);

describe('Ask Mindy /app: research progress', () => {
  it('steps show in the progress panel, de-duplicated, never as warnings; the answer collapses it to a summary', async () => {
    const el = await ask();
    await push({ type: 'session', sessionId: 's1' });
    await push({ type: 'progress', message: 'Checking open opportunities.' });
    clock += 5_000;
    await push({ type: 'progress', message: 'Checking contractor search.' });
    await push({ type: 'progress', message: 'Checking contractor search.' }); // parallel call, same tool
    expect(q(el, 'research-progress')).not.toBeNull();
    expect(q(el, 'research-current')!.textContent).toBe('Checking contractor search.');
    expect(q(el, 'research-progress')!.textContent).toContain('3 steps');
    expect(el.textContent).not.toContain('Thinking…');
    expect(el.querySelector('.text-amber-300\\/90')).toBeNull(); // not rendered as warnings

    await act(async () => { (q(el, 'research-steps-toggle') as HTMLButtonElement).click(); });
    const items = Array.from(q(el, 'research-steps')!.querySelectorAll('li')).map((li) => li.textContent);
    expect(items).toEqual(['Checking open opportunities.', 'Checking contractor search. ×2']);

    clock += 217_000; // 3:42 after the first step
    await push({ type: 'token', content: 'Start with the Navy recruiting campaign.' });
    await push({ type: 'done' });
    await act(async () => { ctrl!.close(); await new Promise((r) => setTimeout(r, 20)); });
    expect(q(el, 'research-progress')).toBeNull();
    expect(q(el, 'research-summary')!.textContent).toContain('Researched · 3 steps · 3:42');
    expect(q(el, 'research-steps')).toBeNull(); // the list opened while running closes on collapse
    expect(el.textContent).toContain('Start with the Navy recruiting campaign.');
  });

  it('a phase line is the headline, not a step', async () => {
    const el = await ask();
    await push({ type: 'progress', message: 'Checking open opportunities.' });
    await push({ type: 'progress', message: 'Writing the answer.', phase: 'writing' });
    expect(q(el, 'research-current')!.textContent).toBe('Writing the answer.');
    expect(q(el, 'research-progress')!.textContent).toContain('1 step');
  });

  it('after a quiet stretch it says it is still working, and the timer keeps moving', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const el = await ask();
    await push({ type: 'progress', message: 'Checking open opportunities.' });
    expect(q(el, 'research-still')).toBeNull();
    clock += 25_000;
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(q(el, 'research-still')!.textContent).toMatch(/Still working/);
    expect(q(el, 'research-elapsed')!.textContent).toBe('0:25');
    vi.useRealTimers();
  });

  it('a notice is still a warning, separate from the steps', async () => {
    const el = await ask();
    await push({ type: 'notice', message: 'Federal award data is unavailable right now.' });
    await push({ type: 'token', content: 'Partial answer.' });
    await push({ type: 'done' });
    await act(async () => { ctrl!.close(); await new Promise((r) => setTimeout(r, 20)); });
    expect(el.textContent).toContain('Federal award data is unavailable right now.');
    expect(q(el, 'research-summary')).toBeNull();
  });

  it('an ordinary answer with no steps shows Thinking… and no research panel', async () => {
    const el = await ask();
    expect(el.textContent).toContain('Thinking…');
    await push({ type: 'token', content: 'Hi.' });
    await push({ type: 'done' });
    await act(async () => { ctrl!.close(); await new Promise((r) => setTimeout(r, 20)); });
    expect(q(el, 'research-progress')).toBeNull();
    expect(q(el, 'research-summary')).toBeNull();
  });
});
