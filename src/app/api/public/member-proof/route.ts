/** GET /api/public/member-proof — the derived social-proof numbers, or { available: false }. */
import { NextResponse } from 'next/server';
import { readMemberProof } from '@/lib/admin/member-wins-snapshot';

export const dynamic = 'force-dynamic';

export async function GET() {
  const p = await readMemberProof();
  return NextResponse.json(p ? { available: true, ...p } : { available: false }, {
    headers: { 'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
