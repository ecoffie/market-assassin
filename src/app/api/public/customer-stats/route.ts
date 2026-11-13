/**
 * GET /api/public/customer-stats — aggregate federal contract statistics for Mindy members, for
 * the public /customers page. Totals and buckets of 3+ companies only: no names, UEIs or emails.
 * A missing, stale or pre-2026-11-13 snapshot returns { available: false }, never zeros.
 */
import { NextResponse } from 'next/server';
import { readMemberProof } from '@/lib/admin/member-wins-snapshot';
import { toCustomerStats } from '@/lib/admin/member-proof-format';

export const dynamic = 'force-dynamic';

export async function GET() {
  const stats = toCustomerStats(await readMemberProof());
  return NextResponse.json(stats ? { available: true, ...stats } : { available: false }, {
    headers: { 'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
