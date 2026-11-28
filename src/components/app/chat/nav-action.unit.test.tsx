// @vitest-environment jsdom
/**
 * Ask Mindy "take me to…" in /app (Phase A, Eric 2026-11-28). The server proposes app.navigate with a DESTINATION
 * from a fixed list; the client maps it through NAV_DESTINATIONS only. Unknown or malformed actions render nothing,
 * nothing navigates without a click, and a locked page keeps its lock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NAV_DESTINATIONS, NAV_DESTINATION_KEYS, parseNavAction } from '@/lib/app/nav-destinations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nav = (destination: unknown, extra: Record<string, unknown> = {}) => ({ type: 'action', id: 'a1', name: 'app.navigate', args: { destination, ...extra } });

describe('parseNavAction: only known destinations, never a model-supplied place', () => {
  it.each(NAV_DESTINATION_KEYS)('%s maps to its fixed panel', (d) => {
    expect(parseNavAction(nav(d))?.target).toEqual(NAV_DESTINATIONS[d]);
  });

  it.each([
    ['an unknown destination', nav('admin')],
    ['a URL as destination', nav('https://evil.example/phish')],
    ['a path as destination', nav('/app?panel=settings&section=billing')],
    ['a panel id instead of a destination', nav('vault')],
    ['an inherited key', nav('constructor')],
    ['an extra arg (url)', nav('billing', { url: 'https://evil.example' })],
    ['a different action name', { ...nav('billing'), name: 'map.search' }],
    ['a bad id', { ...nav('billing'), id: 'x y <script>' }],
    ['no args', { type: 'action', id: 'a1', name: 'app.navigate' }],
    ['not an action', { ...nav('billing'), type: 'token' }],
  ])('%s → null', (_label, evt) => {
    expect(parseNavAction(evt)).toBeNull();
  });

  it('the four destinations are the approved ones', () => {
    expect(NAV_DESTINATION_KEYS).toEqual(['my_documents', 'my_pursuits', 'alert_settings', 'billing']);
    expect(NAV_DESTINATIONS.alert_settings).toMatchObject({ panel: 'settings', context: { section: 'alerts' } });
    expect(NAV_DESTINATIONS.billing).toMatchObject({ panel: 'settings', context: { section: 'billing' } });
    expect(NAV_DESTINATIONS.my_documents).toMatchObject({ panel: 'vault', context: { section: 'documents' } });
    expect(NAV_DESTINATIONS.my_pursuits).toMatchObject({ panel: 'pipeline' });
  });
});

describe('NavActionCard', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  async function mount(destination: string, tier: 'free' | 'pro', onPanelChange = vi.fn()) {
    const { NavActionCard } = await import('./NavActionCard');
    const el = document.createElement('div');
    document.body.appendChild(el);
    await act(async () => { createRoot(el).render(<NavActionCard action={parseNavAction(nav(destination))!} tier={tier} onPanelChange={onPanelChange} />); });
    return { el, onPanelChange };
  }

  it('does not navigate on render; a click opens the page with its section', async () => {
    const { el, onPanelChange } = await mount('alert_settings', 'pro');
    expect(onPanelChange).not.toHaveBeenCalled();
    const btn = el.querySelector('[data-testid="nav-action"]') as HTMLButtonElement;
    expect(btn.textContent).toContain('Open Settings → Alerts & matching');
    await act(async () => { btn.click(); });
    expect(onPanelChange).toHaveBeenCalledWith('settings', { section: 'alerts' });
  });

  it.each(['free', 'pro'] as const)('opens exactly when the sidebar would (%s)', async (tier) => {
    const { clickActionFor } = await import('@/components/app/nav-groups');
    for (const d of NAV_DESTINATION_KEYS) {
      document.body.innerHTML = '';
      const { el } = await mount(d, tier);
      const sidebarLocks = clickActionFor(NAV_DESTINATIONS[d].panel, { userTier: tier }) === 'upgrade';
      expect(!!el.querySelector('[data-testid="nav-action"]')).toBe(!sidebarLocks);
      expect(!!el.querySelector('[data-testid="nav-action-locked"]')).toBe(sidebarLocks);
    }
  });

  it('a locked page shows a plain line and never navigates', async () => {
    vi.resetModules();
    vi.doMock('@/components/app/nav-groups', () => ({ clickActionFor: () => 'upgrade' }));
    const { el, onPanelChange } = await mount('my_pursuits', 'free');
    expect(el.querySelector('[data-testid="nav-action"]')).toBeNull();
    expect(el.querySelector('[data-testid="nav-action-locked"]')?.textContent).toContain('My Pursuits needs a paid plan');
    expect(onPanelChange).not.toHaveBeenCalled();
    vi.doUnmock('@/components/app/nav-groups');
    vi.resetModules();
  });
});
