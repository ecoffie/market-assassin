/**
 * POST /api/billing/trial-checkout { plan, cycle, source? } → { clientSecret, summary }
 *
 * Creates the Stripe Checkout Session (ui_mode 'custom') behind Mindy's own trial checkout page
 * (/start-trial). Public: buyers are usually not signed in. Rate-limited per IP. On any failure the
 * response says `fallbackUrl` — the plan's hosted payment link — so a buyer is never stranded.
 * The session copies the payment link's price, trial, metadata and redirect (lib/billing/trial-checkout).
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  ATTR_COOKIE, CHECKOUT_PRODUCTS, createCheckoutStart, parseAttributionCookie,
} from '@/lib/purchase-attribution';
import { createTrialSession, fallbackLink, parseCycle, parsePlan } from '@/lib/billing/trial-checkout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ATTRIBUTION_PRODUCT: Record<string, string> = { 'pro:monthly': 'mindy-pro-monthly', 'pro:annual': 'mindy-pro-annual' };

export async function POST(request: NextRequest) {
  let body: { plan?: string; cycle?: string; source?: string; email?: string } = {};
  try { body = await request.json(); } catch { /* defaults */ }
  const plan = parsePlan(body.plan);
  const cycle = parseCycle(body.cycle);
  const fallbackUrl = fallbackLink(plan, cycle);

  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const rl = await checkRateLimit(`trial-checkout:${ip}`, 20, 3600);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Too many attempts. Try again later.', fallbackUrl }, { status: 429 });

  // First-party attribution (same record the /checkout/<product> hop writes) — best effort.
  let clientReferenceId: string | null = null;
  const product = CHECKOUT_PRODUCTS[ATTRIBUTION_PRODUCT[`${plan}:${cycle}`] || ''];
  if (product) {
    const start = await createCheckoutStart({
      product,
      sourceUrl: request.headers.get('referer') || request.url,
      attribution: parseAttributionCookie(request.cookies.get(ATTR_COOKIE)?.value),
    }).catch(() => null);
    clientReferenceId = start?.id || null;
  }

  try {
    const result = await createTrialSession({
      plan, cycle, origin: request.nextUrl.origin, email: body.email || null, clientReferenceId, source: body.source || null,
    });
    if (!result) return NextResponse.json({ success: false, error: 'Checkout is not available right now.', fallbackUrl }, { status: 503 });
    return NextResponse.json({ success: true, ...result, fallbackUrl });
  } catch (e) {
    console.error('[trial-checkout] create failed:', (e as Error).message);
    return NextResponse.json({ success: false, error: 'Checkout is not available right now.', fallbackUrl }, { status: 502 });
  }
}
