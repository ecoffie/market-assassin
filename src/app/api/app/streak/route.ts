/**
 * POST /api/app/streak — record today's Mindy visit for the signed-in person and return their
 * login streak (owner, 2026-11-19). The streak belongs to the PERSON signed in (a coach's own
 * visits), never to an active client workspace. The day is decided here, never by the client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { checkInStreak } from '@/lib/streaks/checkin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = requireMIAuthSession(request);
  if (!auth.ok) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const email = String(auth.session.email || '').toLowerCase().trim();
  if (!email.includes('@')) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const result = await checkInStreak(email);
  return NextResponse.json({ success: true, ...result });
}
