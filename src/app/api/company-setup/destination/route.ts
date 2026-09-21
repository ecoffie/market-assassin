/**
 * GET /api/company-setup/destination — where leaving setup should land.
 *
 * Setup is OPTIONAL. Skipping must return the user to whatever they originally came to do,
 * so this is a thin wrapper over the one shared resolver rather than a second opinion
 * about destinations.
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolvePostSignupDestination } from '@/lib/mindy/post-signup-destination';

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const d = resolvePostSignupDestination({
    next: p.get('next'),
    intent: p.get('intent'),
    purchaseNext: p.get('purchase_next'),
  });
  return NextResponse.json({ success: true, path: d.path, intent: d.intent, reason: d.reason });
}
