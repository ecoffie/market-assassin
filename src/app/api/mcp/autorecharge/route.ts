/**
 * /api/mcp/autorecharge — the dashboard controls for "card on file, refill when low".
 *
 * GET  (requireUserAuth) → the user's current settings (never returns Stripe ids).
 * POST (requireUserAuth):
 *   { action: 'update', enabled?, thresholdCredits?, refillPackage? } → save settings.
 *   { action: 'setup' }  → start a Stripe setup Checkout to save a card; returns { url }.
 *   { action: 'disable' } → turn it off (keeps the saved card for later).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserAuth } from '@/lib/api-auth';
import {
  getAutoRecharge,
  setAutoRecharge,
  createSetupCheckout,
  THRESHOLD_MIN,
  THRESHOLD_MAX,
} from '@/lib/mcp/autorecharge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Strip server-only fields (Stripe ids) before returning to the browser. */
function publicView(s: Awaited<ReturnType<typeof getAutoRecharge>>) {
  return {
    enabled: s.enabled,
    thresholdCredits: s.thresholdCredits,
    refillPackage: s.refillPackage,
    hasCard: s.hasCard,
    cardBrand: s.cardBrand,
    cardLast4: s.cardLast4,
    paused: s.paused,
    lastRechargeAt: s.lastRechargeAt,
    thresholdMin: THRESHOLD_MIN,
    thresholdMax: THRESHOLD_MAX,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireUserAuth(request);
  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const settings = await getAutoRecharge(auth.email);
  return NextResponse.json({ success: true, settings: publicView(settings) });
}

export async function POST(request: NextRequest) {
  const auth = await requireUserAuth(request);
  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const email = auth.email;
  const body = await request.json().catch(() => ({}));
  const action = body?.action;

  if (action === 'setup') {
    try {
      const origin = new URL(request.url).origin;
      const url = await createSetupCheckout(email, origin);
      return NextResponse.json({ success: true, url });
    } catch (err) {
      console.error('[mcp:autorecharge] setup checkout failed', err);
      return NextResponse.json({ error: 'Could not start card setup' }, { status: 500 });
    }
  }

  if (action === 'disable') {
    const settings = await setAutoRecharge(email, { enabled: false });
    return NextResponse.json({ success: true, settings: publicView(settings) });
  }

  if (action === 'update') {
    // Can't enable without a saved card — the client should route to 'setup' first.
    if (body.enabled === true) {
      const current = await getAutoRecharge(email);
      if (!current.hasCard) {
        return NextResponse.json({ error: 'no_card', message: 'Save a card first (action: setup).' }, { status: 409 });
      }
    }
    const settings = await setAutoRecharge(email, {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      thresholdCredits: typeof body.thresholdCredits === 'number' ? body.thresholdCredits : undefined,
      refillPackage: typeof body.refillPackage === 'string' ? body.refillPackage : undefined,
    });
    return NextResponse.json({ success: true, settings: publicView(settings) });
  }

  return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
}
