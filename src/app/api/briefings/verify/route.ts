/**
 * Lightweight briefing access check
 * POST /api/briefings/verify
 * Body: { email: string }
 * Returns: { hasAccess: boolean }
 */

import { NextResponse } from 'next/server';
import { hasProAccess } from '@/lib/access/resolve-access';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ hasAccess: false }, { status: 400 });
    }

    // Pro access = paid OR active trial (MINDY_TRIAL_OPEN).
    const hasAccess = await hasProAccess(email);
    return NextResponse.json({ hasAccess });
  } catch {
    return NextResponse.json({ hasAccess: false }, { status: 500 });
  }
}
