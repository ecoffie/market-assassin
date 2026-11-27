// @vitest-environment jsdom
/**
 * Billing must say plainly when there is nothing to cancel (Eric, 2026-11-27): a free account, and a paid plan that
 * is not a personal subscription (lifetime, team, bundle or grant), each get a clear line instead of an empty card.
 * A real subscription keeps its "Manage / cancel" button. Unknown stays unknown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

let payload: Record<string, unknown> = {};
vi.mock('@/components/app/authHeaders', () => ({
  authedFetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, ...payload }) })),
}));
vi.mock('@/components/NoRefundNote', () => ({ default: () => null }));

import SubscriptionsCard from './SubscriptionsCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(): Promise<HTMLElement> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<SubscriptionsCard email="pat@example.com" />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return el;
}
const sub = { id: 'sub_1', kind: 'app', planName: 'Mindy Pro', status: 'active', amount: 99, interval: 'month', currentPeriodEnd: null, cancelAtPeriodEnd: false, billedTo: 'pat@example.com' };

beforeEach(() => { document.body.innerHTML = ''; });

describe('Your subscriptions: nothing to cancel', () => {
  it('free plan: says there is nothing to cancel', async () => {
    payload = { plan: 'free', planLabel: 'Free', subscriptions: [] };
    const el = await render();
    expect(el.querySelector('[data-testid="nothing-to-cancel"]')?.textContent).toMatch(/free plan, so there.s nothing to cancel/);
    expect(el.textContent).not.toContain('Manage / cancel');
  });

  it('lifetime (paid plan, no personal subscription): says lifetime access, nothing to cancel', async () => {
    payload = { plan: 'pro', planLabel: 'Pro', subscriptions: [] };
    const el = await render();
    const note = el.querySelector('[data-testid="nothing-to-cancel"]')?.textContent || '';
    expect(note).toMatch(/lifetime access/);
    expect(note).toMatch(/nothing to cancel/);
  });

  it('a real subscription keeps Manage / cancel and no "nothing to cancel" line', async () => {
    payload = { plan: 'pro', planLabel: 'Pro', subscriptions: [sub] };
    const el = await render();
    expect(el.textContent).toContain('Manage / cancel');
    expect(el.querySelector('[data-testid="nothing-to-cancel"]')).toBeNull();
  });

  it('subscriptions unknown: never claims there is nothing to cancel', async () => {
    payload = { plan: 'free', planLabel: 'Free', subscriptions: null };
    const el = await render();
    expect(el.querySelector('[data-testid="nothing-to-cancel"]')).toBeNull();
    expect(el.textContent).toMatch(/couldn.t check your paid subscriptions/);
  });
});
