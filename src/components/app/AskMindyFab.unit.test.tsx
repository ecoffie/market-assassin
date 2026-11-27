// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import AskMindyFab, { shouldShowAskMindyFab, HIDE_HELP_WIDGET_CSS } from './AskMindyFab';
import { helpWidgetScript } from '@/lib/support/help-widget';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(activePanel: string, isMapShell: boolean, onOpen = vi.fn()) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<AskMindyFab activePanel={activePanel} isMapShell={isMapShell} onOpen={onOpen} />));
  return { host, onOpen, cleanup: () => { act(() => root.unmount()); host.remove(); } };
}

describe('AskMindyFab', () => {
  it('shows on a normal tab and opens Ask Mindy on click', () => {
    const { host, onOpen, cleanup } = render('forecasts', false);
    const btn = host.querySelector('[data-testid="ask-mindy-fab"]') as HTMLButtonElement;
    expect(btn?.textContent).toBe('Ask Mindy');
    act(() => btn.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('is hidden on the chat panel and over the in-app map', () => {
    expect(shouldShowAskMindyFab('chat', false)).toBe(false);
    expect(shouldShowAskMindyFab('map', true)).toBe(false);
    expect(shouldShowAskMindyFab('dashboard', false)).toBe(true);
  });

  it('always hides a Get help button that is already on the page', () => {
    const { host, cleanup } = render('chat', false);
    expect(host.querySelector('style')?.textContent).toBe(HIDE_HELP_WIDGET_CSS);
    cleanup();
  });
});

describe('Get help widget', () => {
  const excluded = () => {
    const m = helpWidgetScript().match(/function excluded\(\)\{[^}]*\}/);
    if (!m) throw new Error('excluded() not found');
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function('location', 'return (' + m[0].replace('function excluded()', 'function()') + ')()') as (l: { pathname: string; search: string }) => boolean;
  };

  it('stays off the signed-in app page only', () => {
    const f = excluded();
    expect(f({ pathname: '/app', search: '' })).toBe(true);
    expect(f({ pathname: '/app/', search: '?panel=forecasts' })).toBe(true);
    expect(f({ pathname: '/app/signup', search: '' })).toBe(false);
    expect(f({ pathname: '/pricing', search: '' })).toBe(false);
    expect(f({ pathname: '/', search: '' })).toBe(false);
  });
});
