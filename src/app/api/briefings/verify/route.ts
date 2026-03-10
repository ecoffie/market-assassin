/**
 * Lightweight briefing access check
 * POST /api/briefings/verify
 * Body: { email: string }
 * Returns: { hasAccess: boolean }
 */

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ hasAccess: false }, { status: 400 });
    }

    const hasAccess = await kv.get(`briefings:${email.toLowerCase().trim()}`);
    return NextResponse.json({ hasAccess: !!hasAccess });
  } catch {
    return NextResponse.json({ hasAccess: false }, { status: 500 });
  }
}
