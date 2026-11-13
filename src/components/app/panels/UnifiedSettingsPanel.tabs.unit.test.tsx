// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Settings is tabbed. Through the real panel: a deep link opens the right tab, switching tabs
 * keeps the URL in sync, and an unsaved Profile edit survives a switch to another tab (every
 * tab stays mounted) and is flagged on the tab bar.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/account/CreditsConsole', () => ({ default: () => <div data-testid="credits-console" /> }));
vi.mock('@/components/billing/SubscriptionsCard', () => ({ default: () => <div data-testid="subscriptions" /> }));
vi.mock('./TargetingCard', () => ({ default: () => <div data-testid="targeting" /> }));

const EMAIL = 'tabs@example.com';

async function stubFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input), 'http://localhost');
  if (url.pathname === '/api/app/workspace') {
    return Response.json({
      success: true,
      workspace: { name: 'Test' },
      settings: { display_name: 'Ada' },
      profile: { notification: { naics_codes: ['541511'], keywords: [], agencies: [], aggregated_profile: {} } },
    });
  }
  if (url.pathname === '/api/alerts/preferences') return Response.json({ data: { frequency: 'daily', locationStates: [] } });
  return Response.json({});
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); // jsdom has no layout
  vi.stubGlobal('fetch', vi.fn(stubFetch));
  window.history.replaceState(null, '', '/app?panel=settings&section=credits&tab=billing');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const tabBtn = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent?.startsWith(label));
const panel = (id: string) => host.querySelector<HTMLElement>(`#settings-tab-${id}`)!;

async function render(section?: 'credits' | 'profile') {
  const { ToastHost } = await import('@/components/app/Toast');
  const { default: UnifiedSettingsPanel } = await import('./UnifiedSettingsPanel');
  await act(async () => { root.render(<ToastHost><UnifiedSettingsPanel email={EMAIL} tier="pro" initialSection={section} /></ToastHost>); });
  for (let i = 0; i < 200 && !tabBtn('Profile'); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}

describe('Settings tabs (actual panel)', () => {
  it('section=credits opens Billing & credits; the other tabs are hidden', async () => {
    await render('credits');
    expect(tabBtn('Billing & credits')?.getAttribute('aria-selected')).toBe('true');
    expect(panel('billing').className).not.toMatch(/\bhidden\b/);
    expect(panel('matching').className).toMatch(/\bhidden\b/);
    expect(host.querySelector('#settings-credits')).toBeTruthy();
  });

  it('no section opens Alerts & matching', async () => {
    await render();
    expect(tabBtn('Alerts & matching')?.getAttribute('aria-selected')).toBe('true');
  });

  it('switching tabs syncs the URL and keeps unsaved Profile edits', async () => {
    await render('profile');
    const name = panel('profile').querySelector<HTMLInputElement>('input[placeholder="John Doe"]')!;
    expect(name.value).toBe('Ada');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(name, 'Grace');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(tabBtn('Profile')?.querySelector('[aria-label="unsaved changes"]')).toBeTruthy();

    await act(async () => { tabBtn('Account')!.click(); });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('section')).toBe('account');
    expect(params.has('tab')).toBe(false);
    expect(panel('profile').className).toMatch(/\bhidden\b/);

    await act(async () => { tabBtn('Profile')!.click(); });
    expect(panel('profile').querySelector<HTMLInputElement>('input[placeholder="John Doe"]')!.value).toBe('Grace');
  });
});
