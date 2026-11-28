// @vitest-environment jsdom
/**
 * Ask Mindy "take me to…" through the real /app chat panel: an app.navigate action becomes an "Open …" card under the
 * answer, nothing navigates without a click, an unknown destination renders nothing, and the request says surface:'app'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const RICH = '<!doctype html><h2>The read</h2><p>Pathways first</p><table><tr><td>Federal Highway Administration</td></tr></table>';

let sse: string[] = [];
const urls: string[] = [];
const bodies: Array<Record<string, unknown>> = [];
vi.mock('../authHeaders', () => ({
  authedFetch: vi.fn(async (url: string, _email?: string, init?: { body?: string }) => {
    urls.push(url);
    if (url === '/api/app/chat' && init?.body) bodies.push(JSON.parse(init.body));
    if (url === '/api/app/chat') {
      const enc = new TextEncoder();
      return { ok: true, status: 200, body: new ReadableStream({ start(c) { for (const l of sse) c.enqueue(enc.encode(`data: ${l}\n\n`)); c.close(); } }), json: async () => ({}) };
    }
    if (url.startsWith('/api/app/vault/documents/preview')) {
      return { ok: true, status: 200, json: async () => ({ success: true, html: RICH, title: 'RBA Federal Market Profile', version: 1 }) };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, sessions: [], suggestions: [] }) };
  }),
}));
vi.mock('../UpgradeModal', () => ({ UpgradeModal: () => null }));

import MindyChatPanel from './MindyChatPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function ask(onPanelChange?: (panel: string, ctx?: Record<string, unknown>) => void): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<MindyChatPanel email="pro@example.com" tier="pro" onPanelChange={onPanelChange as never} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const ta = el.querySelector('textarea')!;
  const setVal = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => { setVal.call(ta, 'Federal market profile for RBA'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  return el;
}


beforeEach(() => { urls.length = 0; bodies.length = 0; sessionStorage.clear(); document.body.innerHTML = ''; Element.prototype.scrollIntoView = () => {}; });

describe('MindyChatPanel: navigation cards', () => {
  it('an app.navigate action renders an Open card; a click opens Settings → Alerts & matching', async () => {
    sse = [
      JSON.stringify({ type: 'token', content: "It's in Settings → Alerts & matching." }),
      JSON.stringify({ type: 'action', id: 'n1', name: 'app.navigate', args: { destination: 'alert_settings' } }),
      JSON.stringify({ type: 'done' }),
    ];
    const nav = vi.fn();
    const el = await ask(nav);
    expect(nav).not.toHaveBeenCalled();
    const btn = el.querySelector('[data-testid="nav-action"]') as HTMLButtonElement;
    expect(btn.textContent).toContain('Open Settings → Alerts & matching');
    await act(async () => { btn.click(); });
    expect(nav).toHaveBeenCalledWith('settings', { section: 'alerts' });
    expect(bodies[0]?.surface).toBe('app');
  });

  it('an unknown destination, a URL or another action name renders nothing', async () => {
    sse = [
      JSON.stringify({ type: 'token', content: 'Here you go.' }),
      JSON.stringify({ type: 'action', id: 'n1', name: 'app.navigate', args: { destination: 'admin' } }),
      JSON.stringify({ type: 'action', id: 'n2', name: 'app.navigate', args: { destination: 'https://evil.example' } }),
      JSON.stringify({ type: 'action', id: 'n3', name: 'map.search', args: { q: 'cyber' } }),
      JSON.stringify({ type: 'done' }),
    ];
    const el = await ask(vi.fn());
    expect(el.querySelector('[data-testid="nav-actions"]')).toBeNull();
    expect(el.querySelector('[data-testid="nav-action"]')).toBeNull();
  });

  it('at most three cards, each action id once', async () => {
    sse = [
      JSON.stringify({ type: 'token', content: 'Places.' }),
      ...['my_documents', 'my_pursuits', 'alert_settings', 'billing'].map((d, i) => JSON.stringify({ type: 'action', id: `n${i}`, name: 'app.navigate', args: { destination: d } })),
      JSON.stringify({ type: 'action', id: 'n0', name: 'app.navigate', args: { destination: 'my_documents' } }),
      JSON.stringify({ type: 'done' }),
    ];
    const el = await ask(vi.fn());
    expect(el.querySelectorAll('[data-testid="nav-action"], [data-testid="nav-action-locked"]').length).toBe(3);
  });
});
