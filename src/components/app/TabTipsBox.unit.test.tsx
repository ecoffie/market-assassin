// @vitest-environment jsdom
/** "How to use this tab" box: hide, show again, remembered per tab, storage failures tolerated. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import TabTipsBox from './TabTipsBox';
import { tabTipsStorageKey } from '@/lib/app/tab-tips';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tips = { steps: ['Step one.', 'Step two.'], tip: 'A useful tip.' };
let host: HTMLDivElement;
let root: Root;

async function mount(panelId = 'forecasts') {
  await act(async () => { root.render(<TabTipsBox panelId={panelId} tips={tips} />); });
}
const box = () => host.querySelector('[data-testid="tab-tips-box"]');
const collapsed = () => host.querySelector('[data-testid="tab-tips-collapsed"]');
const button = () => host.querySelector('button') as HTMLButtonElement;

beforeEach(() => {
  window.localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('TabTipsBox', () => {
  it('shows the title, numbered steps, the tip and a Hide button', async () => {
    await mount();
    expect(box()?.textContent).toContain('How to use this tab');
    expect(Array.from(host.querySelectorAll('ol > li')).map(li => li.textContent)).toEqual(['Step one.', 'Step two.']);
    expect(host.querySelector('p')?.textContent).toBe('Tip: A useful tip.');
    expect(button().textContent).toContain('Hide');
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(button().getAttribute('aria-label')).toBe('Hide how to use this tab');
  });

  it('Hide collapses to a "?" button that brings the box back', async () => {
    await mount();
    await act(async () => { button().click(); });
    expect(box()).toBeNull();
    expect(collapsed()).not.toBeNull();
    expect(button().getAttribute('aria-label')).toBe('How to use this tab');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(window.localStorage.getItem(tabTipsStorageKey('forecasts'))).toBe('1');

    await act(async () => { button().click(); });
    expect(box()).not.toBeNull();
    expect(window.localStorage.getItem(tabTipsStorageKey('forecasts'))).toBeNull();
  });

  it('remembers hidden per tab', async () => {
    window.localStorage.setItem(tabTipsStorageKey('forecasts'), '1');
    await mount('forecasts');
    expect(collapsed()).not.toBeNull();
    await act(async () => { root.render(<TabTipsBox key="recompetes" panelId="recompetes" tips={tips} />); });
    expect(box()).not.toBeNull();
  });

  it('blocked storage: the box still shows and Hide still works for this view', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await mount();
    expect(box()).not.toBeNull();
    await act(async () => { button().click(); });
    expect(collapsed()).not.toBeNull();
  });
});
