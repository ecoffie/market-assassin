// @vitest-environment jsdom
/**
 * Ask Mindy (/app chat): a pasted screenshot goes with exactly ONE turn as images:[{media_type, data}] and is
 * never kept — not in the transcript, the history sent on later turns, browser storage or a retry. Paste only
 * exists where the server says it will read the image (Agent 4 conditions, 2026-11-25).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const B64 = 'iVBORw0KGgoSCREENSHOTBYTES';
let caps: Record<string, unknown> = { screenshots: true };
let chatStatus = 200;
let refusalBody: unknown = {};
const bodies: Array<Record<string, unknown>> = [];

vi.mock('../authHeaders', () => ({
  authedFetch: vi.fn(async (url: string, _email: string, init?: RequestInit) => {
    if (url === '/api/app/chat') {
      bodies.push(JSON.parse(String(init?.body)));
      if (chatStatus !== 200) return { ok: false, status: chatStatus, body: null, json: async () => refusalBody };
      const enc = new TextEncoder();
      const lines = [JSON.stringify({ type: 'token', content: 'That is EFS Digital.' }), JSON.stringify({ type: 'done' })];
      return { ok: true, status: 200, body: new ReadableStream({ start(c) { for (const l of lines) c.enqueue(enc.encode(`data: ${l}\n\n`)); c.close(); } }), json: async () => ({}) };
    }
    if (url.startsWith('/api/app/chat/capabilities')) return { ok: true, status: 200, json: async () => caps };
    return { ok: true, status: 200, json: async () => ({ success: true, sessions: [], suggestions: [] }) };
  }),
}));
vi.mock('../UpgradeModal', () => ({ UpgradeModal: () => null }));
vi.mock('@/lib/chat/screenshot-client', async (orig) => {
  const real = await orig<typeof import('@/lib/chat/screenshot-client')>();
  return {
    ...real,
    prepareScreenshot: vi.fn(async (f: File) => f.type === 'image/png'
      ? { ok: true, shot: { id: `s-${Math.random()}`, media_type: 'image/png', data: f.name === 'huge.png' ? 'A'.repeat(2_000_000) : B64, previewUrl: 'blob:local/1', bytes: 20 } }
      : { ok: false, reason: 'type' }),
  };
});

import MindyChatPanel from './MindyChatPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function mount(tier = 'pro'): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<MindyChatPanel email="pro@example.com" tier={tier} />); });
  await tick();
  return el;
}
const ta = (el: HTMLElement) => el.querySelector('textarea')!;
async function type(el: HTMLElement, v: string) {
  const setVal = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => { setVal.call(ta(el), v); ta(el).dispatchEvent(new Event('input', { bubbles: true })); });
}
async function paste(el: HTMLElement, files: File[]) {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: { items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })), files } });
  await act(async () => { ta(el).dispatchEvent(ev); });
  await tick();
  return ev;
}
async function enter(el: HTMLElement) {
  await act(async () => { ta(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await tick(60);
}
const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });

beforeEach(() => {
  bodies.length = 0; caps = { screenshots: true }; chatStatus = 200; refusalBody = {};
  sessionStorage.clear(); localStorage.clear(); document.body.innerHTML = '';
  Element.prototype.scrollIntoView = () => {};
  URL.revokeObjectURL = vi.fn();
});

describe('Ask Mindy /app: pasted screenshots', () => {
  it('a pasted screenshot is sent once as images:[{media_type,data}] and the transcript keeps only a marker', async () => {
    const el = await mount();
    const ev = await paste(el, [png()]);
    expect(ev.defaultPrevented).toBe(true);
    expect(el.querySelectorAll('[data-testid="chat-screenshot-remove"]').length).toBe(1);

    await type(el, 'Who is this company?');
    await enter(el);
    expect(bodies[0].images).toEqual([{ media_type: 'image/png', data: B64 }]);
    expect(bodies[0].message).toBe('Who is this company?');
    expect(el.textContent).toContain('[screenshot attached]');
    expect(el.querySelector('[data-testid="chat-screenshots"]')).toBeNull(); // composer cleared

    // Next turn: no image, and the history it sends carries the marker but never the bytes.
    await type(el, 'What do they sell?');
    await enter(el);
    expect(bodies[1].images).toBeUndefined();
    expect(JSON.stringify(bodies[1].history)).toContain('[screenshot attached]');
    expect(JSON.stringify(bodies[1])).not.toContain(B64);
    // Nothing in browser storage, nothing in the rendered page.
    const stored = JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage });
    expect(stored).not.toContain(B64);
    expect(el.innerHTML).not.toContain(B64);
  });

  it('a screenshot with no typed text still sends, with a plain default question', async () => {
    const el = await mount();
    await paste(el, [png()]);
    const send = Array.from(el.querySelectorAll('button')).find((b) => /Send/.test(b.textContent || ''))!;
    expect(send.disabled).toBe(false);
    await act(async () => { send.click(); });
    await tick(60);
    expect(bodies[0].message).toMatch(/screenshot/i);
    expect(bodies[0].images).toHaveLength(1);
  });

  it('at most 3 screenshots; a 4th gets a plain note', async () => {
    const el = await mount();
    await paste(el, [png(), png()]);
    await paste(el, [png(), png()]);
    expect(el.querySelectorAll('[data-testid="chat-screenshot-remove"]').length).toBe(3);
    expect(el.querySelector('[data-testid="chat-screenshot-note"]')?.textContent).toMatch(/up to 3/);
  });

  it('removing a chip drops it from the next send', async () => {
    const el = await mount();
    await paste(el, [png()]);
    await act(async () => { (el.querySelector('[data-testid="chat-screenshot-remove"]') as HTMLButtonElement).click(); });
    await type(el, 'hello');
    await enter(el);
    expect(bodies[0].images).toBeUndefined();
  });

  it('an unsupported file type is refused in plain English and nothing is attached', async () => {
    const el = await mount();
    await paste(el, [new File(['x'], 'a.gif', { type: 'image/gif' })]);
    expect(el.querySelectorAll('[data-testid="chat-screenshot-remove"]').length).toBe(0);
    expect(el.querySelector('[data-testid="chat-screenshot-note"]')?.textContent).toMatch(/PNG, JPEG or WebP/);
  });

  it('a server refusal gives back the typed text and the screenshot, with a plain note and no bubbles', async () => {
    chatStatus = 413;
    const el = await mount();
    await paste(el, [png()]);
    await type(el, 'Research EFS Digital');
    await enter(el);
    expect(ta(el).value).toBe('Research EFS Digital');
    expect(el.querySelectorAll('[data-testid="chat-screenshot-remove"]').length).toBe(1);
    expect(el.querySelector('[data-testid="chat-screenshot-note"]')?.textContent).toMatch(/still here/);
    expect(el.textContent).not.toContain('[screenshot attached]');
  });

  it("the server's customer-safe refusal message is shown as plain text (RM-4: 400/413/415 {error, message})", async () => {
    chatStatus = 415;
    refusalBody = { error: 'image_type', message: 'That image is not a PNG, JPEG or WebP screenshot.' };
    const el = await mount();
    await paste(el, [png()]);
    await type(el, 'Who is this?');
    await enter(el);
    expect(el.querySelector('[data-testid="chat-screenshot-note"]')?.textContent).toBe('That image is not a PNG, JPEG or WebP screenshot.');
    expect(ta(el).value).toBe('Who is this?');
  });

  it('without the server capability, pasting an image does nothing and a turn never carries images', async () => {
    caps = { screenshots: false };
    const el = await mount();
    const ev = await paste(el, [png()]);
    expect(ev.defaultPrevented).toBe(false);
    expect(el.querySelector('[data-testid="chat-screenshots"]')).toBeNull();
    await type(el, 'hello');
    await enter(el);
    expect(bodies[0].images).toBeUndefined();
  });

  it('a free account never gets paste, even if the capability says yes', async () => {
    const el = await mount('free');
    const ev = await paste(el, [png()]);
    expect(ev.defaultPrevented).toBe(false);
    expect(el.querySelector('[data-testid="chat-screenshots"]')).toBeNull();
  });

  it('an ordinary text paste is left alone', async () => {
    const el = await mount();
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: { items: [{ kind: 'string', type: 'text/plain' }], files: [] } });
    await act(async () => { ta(el).dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(false);
  });

  it('screenshots too large to send together are refused before sending; text and screenshots stay', async () => {
    const el = await mount();
    const huge = () => new File([new Uint8Array([1])], 'huge.png', { type: 'image/png' });
    await paste(el, [huge(), huge()]);
    await type(el, 'Who are these?');
    await enter(el);
    expect(bodies).toHaveLength(0);
    expect(el.querySelector('[data-testid="chat-screenshot-note"]')?.textContent).toMatch(/too large to send together/);
    expect(el.querySelectorAll('[data-testid="chat-screenshot-remove"]').length).toBe(2);
    expect(ta(el).value).toBe('Who are these?');
  });
});
