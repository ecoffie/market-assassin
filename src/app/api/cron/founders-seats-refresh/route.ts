/**
 * GET /api/cron/founders-seats-refresh — recompute the Founders seat count and
 * cache it in KV. Full Stripe scan (slow), so this runs on a cron, not per page.
 * Auth: ?password=ADMIN_PASSWORD or CRON_SECRET bearer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { refreshFoundersSeats } from '@/lib/mindy/founders-seats';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '');
  if (password !== process.env.ADMIN_PASSWORD && cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const seats = await refreshFoundersSeats();
    return NextResponse.json({ success: true, ...seats });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'refresh failed' }, { status: 500 });
  }
}
