// @vitest-environment jsdom
/**
 * Regression (2026-10-10): "Show me my market" was unresponsive on /welcome/company?next=/learn.
 *
 * Reproduced on production with the customer's exact inputs — company "Revo Constructions",
 * description "Roofing", certifications "None of these", location "Nationwide": the button was
 * DISABLED (`description.trim().length < 8`; "Roofing" is 7), clicking sent no request, and nothing
 * on screen said why. /api/suggest-codes accepts 2+ characters and answers "Roofing" with 238160
 * Roofing Contractors, so the page was stricter than its own API. A failed lookup also threw out of
 * try/finally into nowhere.
 *
 * These tests render the REAL page and drive it with those inputs.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeWorkIssue, MIN_DESCRIPTION_CHARS } from '@/lib/profile/company-setup-input';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('next=/learn') }));
vi.mock('@/components/app/authHeaders', () => ({
  authedFetch: vi.fn(() => Promise.reject(new Error('not used on screen 1'))),
  storedMIEmail: () => '',
}));

import CompanySetupPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
const loc = { href: '' };

const ROOFING = {
  success: true,
  naicsSuggestions: [
    { code: '238160', name: 'Roofing Contractors' },
    { code: '236220', name: 'Commercial and Institutional Building Construction' },
  ],
  keywords: [],
};
const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(CompanySetupPage)); });
  await act(async () => { await Promise.resolve(); });
}
const btn = (re: RegExp) => [...container.querySelectorAll('button')].find((b) => re.test(b.textContent || '')) as HTMLButtonElement;
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  await act(async () => { el.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function click(el: HTMLElement) {
  await act(async () => { el.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
/** The customer's exact inputs. */
async function fillRevo(description = 'Roofing') {
  await type(container.querySelector('input[placeholder="Acme Roofing LLC"]') as HTMLInputElement, 'Revo Constructions');
  await type(container.querySelector('textarea') as HTMLTextAreaElement, description);
  await click(btn(/^None of these$/));
  expect((container.querySelector('input[type=radio]') as HTMLInputElement).checked).toBe(true); // Nationwide
}
const calls = (path: string) => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith(path));

beforeEach(() => {
  fetchMock = vi.fn((url: string) => {
    if (String(url).startsWith('/api/suggest-codes')) return json(ROOFING);
    if (String(url).startsWith('/api/company-setup/destination')) return json({ success: true, path: '/learn' });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  loc.href = '';
  Object.defineProperty(window, 'location', { configurable: true, value: loc });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe('"Show me my market" with the reported inputs', () => {
  it('is clickable, sends the lookup, and shows Mindy’s codes', async () => {
    await mount();
    await fillRevo();
    const show = btn(/Show me my market/);
    expect(show.disabled).toBe(false);
    await click(show);
    expect(calls('/api/suggest-codes')).toHaveLength(1);
    expect(JSON.parse(calls('/api/suggest-codes')[0][1].body)).toEqual({ description: 'Roofing' });
    expect(container.textContent).toContain("Here's what Mindy found");
    expect(container.textContent).toContain('238160');
    expect(container.textContent).toContain('Roofing Contractors');
  });

  it('the requirement is visible before anyone clicks', async () => {
    await mount();
    expect(container.querySelector('#descHint')?.textContent).toMatch(/A word or two is enough/);
    expect(container.querySelector('textarea')?.getAttribute('aria-describedby')).toBe('descHint');
  });
});

describe('an unusable description is explained, never a silent disabled button', () => {
  for (const d of ['', '   ', '7', 'x']) {
    it(JSON.stringify(d), async () => {
      await mount();
      await fillRevo(d);
      const show = btn(/Show me my market/);
      expect(show.disabled).toBe(false);
      await click(show);
      expect(calls('/api/suggest-codes')).toHaveLength(0);
      const alert = container.querySelector('[role=alert]');
      expect(alert?.textContent).toMatch(/Roofing/);
      expect(container.textContent).toContain('Help Mindy understand your company');
    });
  }
});

describe('a failed lookup says so and stays on the screen', () => {
  it('HTTP 500', async () => {
    fetchMock.mockImplementation((url: string) => (String(url).startsWith('/api/suggest-codes') ? json({ success: false }, 500) : json({ path: '/learn' })));
    await mount(); await fillRevo(); await click(btn(/Show me my market/));
    expect(container.querySelector('[role=alert]')?.textContent).toMatch(/couldn’t look up your market/);
    expect(container.textContent).toContain('Help Mindy understand your company');
    expect(btn(/Show me my market/).disabled).toBe(false);
  });
  it('network failure', async () => {
    fetchMock.mockImplementation((url: string) => (String(url).startsWith('/api/suggest-codes') ? Promise.reject(new TypeError('Failed to fetch')) : json({ path: '/learn' })));
    await mount(); await fillRevo(); await click(btn(/Show me my market/));
    expect(container.querySelector('[role=alert]')?.textContent).toMatch(/couldn’t look up your market/);
  });
  it('the API’s own message is shown when it gives one', async () => {
    fetchMock.mockImplementation(() => json({ success: false, error: 'Please enter what you want to research.' }, 400));
    await mount(); await fillRevo(); await click(btn(/Show me my market/));
    expect(container.querySelector('[role=alert]')?.textContent).toBe('Please enter what you want to research.');
  });
});

describe('Skip for now returns to /learn, never a loop', () => {
  it('via the destination route', async () => {
    await mount(); await click(btn(/^Skip for now/));
    expect(loc.href).toBe('/learn');
  });
  it('even when the destination request fails (local resolver, not the Map)', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    await mount(); await click(btn(/^Skip for now/));
    expect(loc.href).toBe('/learn');
  });
});

describe('one rule for page and API', () => {
  it('describeWorkIssue accepts one industry word', () => {
    expect(describeWorkIssue('Roofing')).toBeNull();
    expect(describeWorkIssue('HVAC')).toBeNull();
    expect(describeWorkIssue('')).toMatch(/Roofing/);
    expect(describeWorkIssue('7')).toMatch(/two letters/);
  });
  it('the API floor and the page rule share MIN_DESCRIPTION_CHARS; no hidden 8-character gate remains', () => {
    const api = readFileSync(join(process.cwd(), 'src/app/api/suggest-codes/route.ts'), 'utf8');
    const page = readFileSync(join(process.cwd(), 'src/app/welcome/company/page.tsx'), 'utf8');
    expect(MIN_DESCRIPTION_CHARS).toBe(2);
    expect(api).toContain('description.trim().length < MIN_DESCRIPTION_CHARS');
    expect(page).not.toMatch(/length\s*<\s*8/);
    expect(page).toMatch(/disabled=\{busy\}/);
  });
});
