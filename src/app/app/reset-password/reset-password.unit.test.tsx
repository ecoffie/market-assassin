// @vitest-environment jsdom
/**
 * Regression: the 8s "reset session did not load" fallback fired even after the
 * recovery session loaded, replacing the form with an error mid-typing (customer
 * report 2026-10-05). The fallback must only fire when no session ever arrives.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let sessionResult: { data: { session: unknown } } = { data: { session: null } };

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/mindy/MindyLogo', () => ({ MindyLogo: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    auth: {
      getSession: () => Promise.resolve(sessionResult),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}));

import MIResetPasswordPage from './page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(MIResetPasswordPage));
  });
  // let getSession() resolve
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '', '/app/reset-password');
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('reset-password load timeout', () => {
  it('keeps the form after 8s once the recovery session has loaded', async () => {
    sessionResult = { data: { session: { user: { id: 'u1' } } } };
    await mount();
    expect(container.querySelector('form')).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(container.querySelector('form')).not.toBeNull();
    expect(container.textContent).not.toContain('Reset session did not load');
  });

  it('still shows the fallback error when no session ever arrives', async () => {
    sessionResult = { data: { session: null } };
    await mount();
    expect(container.querySelector('form')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(8_000);
    });

    expect(container.textContent).toContain('Reset session did not load');
  });
});
