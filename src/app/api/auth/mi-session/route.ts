import { NextRequest, NextResponse } from 'next/server';
import { verifyUserSession } from '@/lib/api-auth';
import { createMIAuthSessionToken } from '@/lib/two-factor-session';

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyUserSession(request);

    if (!auth.authenticated || !auth.email) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Supabase session required' },
        { status: 401 }
      );
    }

    const authenticatedAt = new Date().toISOString();

    return NextResponse.json({
      success: true,
      email: auth.email,
      authenticatedAt,
      sessionToken: createMIAuthSessionToken(auth.email),
    });
  } catch (error) {
    console.error('[MI Session] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create Mindy session' },
      { status: 500 }
    );
  }
}
