/**
 * GUARD — share attribution survives the EXISTING paid path, unchanged:
 *   gca_attr cookie (written by the Map) → /checkout/[product] → CheckoutStart in KV
 *   → client_reference_id on the Stripe link → webhook getCheckoutStart → savePurchase.attribution
 *
 * Real route + real purchase-attribution lib; only KV is an in-memory Map.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const store = new Map<string, unknown>();
vi.mock('@vercel/kv', () => ({
  kv: {
    set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); return 'OK'; }),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    sadd: vi.fn(async () => 1),
  },
}));

const S = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const X = '0fdb5f972b2a46648adf2e2b8a6558ce';

describe('share → checkout → purchase attribution', () => {
  it('the Map-written first touch reaches the checkout record and back out at the webhook', async () => {
    const { CHECKOUT_PRODUCTS, getCheckoutStart } = await import('@/lib/purchase-attribution');
    const productId = Object.keys(CHECKOUT_PRODUCTS).find((k) => {
      const p = CHECKOUT_PRODUCTS[k]; return p.type === 'stripe_payment_link' && p.checkoutUrl && !p.checkoutUrl.includes('REPLACE_ME');
    })!;
    expect(productId).toBeTruthy();

    const attr = {
      first_touch: { entry: 'share', share_id: S, notice_id: X, utm_source: 'share', utm_medium: 'share', captured_at: '2026-09-20T11:00:00Z' },
      last_touch: { entry: 'direct', utm_source: 'direct', captured_at: '2026-09-21T09:00:00Z' },
      visit_count: 3,
    };
    const { GET } = await import('@/app/checkout/[product]/route');
    const res = await GET(
      new NextRequest(`https://getmindy.ai/checkout/${productId}`, { headers: { cookie: `gca_attr=${encodeURIComponent(JSON.stringify(attr))}` } }),
      { params: Promise.resolve({ product: productId }) },
    );
    const location = res.headers.get('location')!;
    const ref = new URL(location).searchParams.get('client_reference_id')!;
    expect(ref).toBeTruthy();

    // What the webhook does with session.client_reference_id:
    const start = await getCheckoutStart(ref);
    expect(start?.attribution.first_touch).toMatchObject({ share_id: S, notice_id: X, entry: 'share' });
  });

  it('the webhook copies checkoutStart.attribution verbatim into the purchase record', () => {
    const hook = readFileSync(join(process.cwd(), 'src/app/api/stripe-webhook/route.ts'), 'utf8');
    expect(hook).toContain('attribution: checkoutStart?.attribution,');
    expect(hook).toContain('session.client_reference_id || session.metadata?.attribution_id');
  });
});
