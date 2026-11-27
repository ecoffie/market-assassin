// @vitest-environment jsdom
/** Call site: PanelContainer mounts the tips box once, above the active panel, only while NEXT_PUBLIC_TAB_TIPS is on. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('./ForecastsPanel', () => ({ default: () => <div data-testid="forecasts-panel">Upcoming Buys</div> }));
vi.mock('./CatalogTeaserFree', () => ({ default: () => <div data-testid="catalog-teaser">Teaser</div> }));
vi.mock('./TeamPanel', () => ({ default: () => <div data-testid="team-panel">Team</div> }));
vi.mock('./OsbpSmbResearchPanel', () => ({ default: () => <div data-testid="osbp-panel">OSBP</div> }));
vi.mock('./MindyChatPanel', () => ({ default: () => <div data-testid="chat-panel">Chat</div> }));

import PanelContainer, { tabTipsPanelId } from './index';
import { getTabTips } from '@/lib/app/tab-tips';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function render(props: Partial<Parameters<typeof PanelContainer>[0]> = {}) {
  await act(async () => {
    root.render(<PanelContainer activePanel="forecasts" email="a@b.com" tier="pro" {...props} />);
  });
  // Let the lazy panel resolve.
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return host.innerHTML;
}

beforeEach(() => {
  window.localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllEnvs();
});

describe('PanelContainer tab tips', () => {
  it('ON: shows the box above the Forecasts panel', async () => {
    vi.stubEnv('NEXT_PUBLIC_TAB_TIPS', 'on');
    await render();
    const boxEl = host.querySelector('[data-testid="tab-tips-box"]');
    const panelEl = host.querySelector('[data-testid="forecasts-panel"]');
    expect(boxEl?.textContent).toContain('How to use this tab');
    expect(panelEl).not.toBeNull();
    expect(boxEl!.compareDocumentPosition(panelEl!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelectorAll('[data-testid="tab-tips-box"]')).toHaveLength(1);
  });

  it('OFF (unset or any value but "on"): renders exactly the panel, as before', async () => {
    vi.stubEnv('NEXT_PUBLIC_TAB_TIPS', '');
    const off = await render();
    expect(off).toBe('<div data-testid="forecasts-panel">Upcoming Buys</div>');
    vi.stubEnv('NEXT_PUBLIC_TAB_TIPS', 'true');
    expect(await render()).toBe(off);
  });

  it('ON but the tab has no entry: no box', async () => {
    vi.stubEnv('NEXT_PUBLIC_TAB_TIPS', 'on');
    // A panel id with no tips entry (precondition asserted so a future entry fails loudly here).
    expect(getTabTips('chat')).toBeNull();
    expect(await render({ activePanel: 'chat' })).toBe('<div data-testid="chat-panel">Chat</div>');
  });

  it('ON but a free user sees the teaser instead of the panel: no box (tips describe the full panel)', async () => {
    vi.stubEnv('NEXT_PUBLIC_TAB_TIPS', 'on');
    expect(await render({ tier: 'free' })).toBe('<div data-testid="catalog-teaser">Teaser</div>');
  });

  it('resolves aliases to the panel actually rendered', () => {
    expect(tabTipsPanelId('today', 'a@b.com', 'pro', false)).toBe('dashboard');
    expect(tabTipsPanelId('today', 'a@b.com', 'pro', true)).toBe('today');
    expect(tabTipsPanelId('library', 'a@b.com', 'pro')).toBe('vault');
    expect(tabTipsPanelId('pipeline', 'a@b.com', 'free')).toBeNull();
    expect(tabTipsPanelId('forecasts', null, 'free')).toBe('forecasts');
  });
});
