// @vitest-environment jsdom
/**
 * /pricing shows the Mindy Day annual line only while the window is open (Nov 28 – Dec 5 2026,
 * New York). The date check runs on the SERVER (PricingPage), and the numbers come from the
 * allowance constants.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PricingPage from '@/app/pricing/page';
import SimplePricing from './SimplePricing';
import { PRO_MONTHLY_CREDITS, TEAM_MONTHLY_CREDITS } from '@/lib/mcp/packages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

async function render(el: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(el); });
  return host;
}

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove();
  root = null; host = null;
  vi.useRealTimers();
});

const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };
const promo = (el: HTMLElement) => el.querySelector('[data-mindy-day-promo]');

describe('/pricing Mindy Day line', () => {
  it('with the monthly-only Team seat card on, offers Pro annual only (no Team annual claim)', async () => {
    vi.stubEnv('NEXT_PUBLIC_TEAM_SEAT_PRICING', 'on');
    try {
      at('2026-11-29T15:00:00Z');
      const p = promo(await render(PricingPage()));
      expect(p).not.toBeNull();
      expect(p!.textContent).toContain('Pro');
      expect(p!.textContent).toContain((PRO_MONTHLY_CREDITS * 2).toLocaleString('en-US'));
      expect(p!.textContent).not.toContain((TEAM_MONTHLY_CREDITS * 2).toLocaleString('en-US'));
      expect(p!.textContent).not.toMatch(/Team/);
      expect(p!.querySelector('a[data-mindy-day-cta]')?.textContent).toBe('Start Pro annual');
    } finally { vi.unstubAllEnvs(); }
  });

  it('shows inside the window, with doubled numbers from the constants, next to the Monthly/Annual toggle', async () => {
    at('2026-12-01T15:00:00Z');
    const el = await render(PricingPage());
    const p = promo(el);
    expect(p).not.toBeNull();
    expect(p!.textContent).toContain('Dec 5');
    expect(p!.textContent).toContain((PRO_MONTHLY_CREDITS * 2).toLocaleString('en-US'));
    expect(p!.textContent).toContain((TEAM_MONTHLY_CREDITS * 2).toLocaleString('en-US'));
    expect(p!.previousElementSibling?.getAttribute('aria-label')).toBe('Billing period');
  });

  it('shows from 00:00 Nov 28 New York time', async () => {
    at('2026-11-28T05:00:00Z');
    expect(promo(await render(PricingPage()))).not.toBeNull();
  });

  it('is hidden before the window (Nov 27 23:59 New York)', async () => {
    at('2026-11-28T04:59:00Z');
    expect(promo(await render(PricingPage()))).toBeNull();
  });

  it('is hidden after the window (00:00 Dec 6 New York)', async () => {
    at('2026-12-06T05:00:00Z');
    expect(promo(await render(PricingPage()))).toBeNull();
  });

  it('SimplePricing renders nothing extra without a promo line (default)', async () => {
    const el = await render(<SimplePricing proCredits={1500} teamCredits={7000} forecastsLabel="33,000+" faqs={[]} />);
    expect(promo(el)).toBeNull();
  });
});
