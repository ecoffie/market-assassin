// @vitest-environment jsdom
/**
 * "Sign in to save your selections — nothing was saved." had nothing to click (Joseph Boyd,
 * 2026-10-25). It now carries a Sign in link that returns to THIS page, with its own ?next=.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authed = vi.fn();
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('next=/learn/describe-your-work') }));
vi.mock('@/components/app/authHeaders', () => ({
  authedFetch: (...a: unknown[]) => authed(...a),
  storedMIEmail: () => 'jb@example.com',
}));

import CompanySetupPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const loc = { href: '', pathname: '/welcome/company', search: '?next=/learn/describe-your-work' };
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
const btn = (re: RegExp) => [...container.querySelectorAll('button')].find((b) => re.test(b.textContent || '')) as HTMLButtonElement;
async function click(el: HTMLElement) {
  await act(async () => { el.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function reachConfirm() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(CompanySetupPage)); });
  await type(container.querySelector('textarea') as HTMLTextAreaElement, 'Roofing');
  await click(btn(/^None of these$/));
  await click(btn(/Show me my market/));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => (String(url).startsWith('/api/suggest-codes')
    ? json({ success: true, naicsSuggestions: [{ code: '238160', name: 'Roofing Contractors' }], keywords: [] })
    : json({ success: true, path: '/learn' }))));
  loc.href = '';
  Object.defineProperty(window, 'location', { configurable: true, value: loc });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); authed.mockReset(); });

describe('a 401 save offers sign-in that comes back here', () => {
  it('401 → "nothing was saved" + Sign in → /app?next=<this page + its next>, and no navigation', async () => {
    authed.mockImplementation(() => json({ success: false, error: 'Unauthorized' }, 401));
    await reachConfirm();
    await click(btn(/Confirm selections/));
    const alert = container.querySelector('[role=alert]')!;
    expect(alert.textContent).toContain('nothing was saved');
    const a = alert.querySelector('a')!;
    expect(a.textContent).toBe('Sign in');
    expect(a.getAttribute('href')).toBe(`/app?next=${encodeURIComponent('/welcome/company?next=/learn/describe-your-work')}`);
    expect(loc.href).toBe('');
  });

  it('a non-auth failure (500) does not offer sign-in', async () => {
    authed.mockImplementation(() => json({ success: false }, 500));
    await reachConfirm();
    await click(btn(/Confirm selections/));
    const alert = container.querySelector('[role=alert]')!;
    expect(alert.textContent).toContain('couldn’t save');
    expect(alert.querySelector('a')).toBeNull();
  });
});
