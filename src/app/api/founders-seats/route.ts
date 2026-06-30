/**
 * GET /api/founders-seats — public, fast (reads the KV cache).
 * Returns { cap, taken, remaining, ... } for the Founders landing page counter.
 * The count is recomputed by /api/cron/founders-seats-refresh.
 */
import { NextResponse } from 'next/server';
import { getFoundersSeats } from '@/lib/mindy/founders-seats';

export const dynamic = 'force-dynamic';

export async function GET() {
  const seats = await getFoundersSeats();
  return NextResponse.json(seats, {
    // Edge/CDN cache 5 min — the count moves slowly and the cron refreshes it.
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  });
}
