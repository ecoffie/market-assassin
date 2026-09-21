import { NextRequest, NextResponse } from 'next/server';
import { verifyUserSession } from '@/lib/api-auth';
import { ensureMindyFreeProfile } from '@/lib/mindy/free-profile';

export async function POST(request: NextRequest) {
  const auth = await verifyUserSession(request);

  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  try {
    await ensureMindyFreeProfile(auth.email);
    return NextResponse.json({ success: true, email: auth.email });
  } catch (error) {
    console.error('[Mindy Complete Signup] Failed to complete signup:', error);
    return NextResponse.json({ success: false, error: 'Unable to complete signup' }, { status: 500 });
  }
}
