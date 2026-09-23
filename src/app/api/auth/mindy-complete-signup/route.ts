import { NextRequest, NextResponse } from 'next/server';
import { verifyUserSession } from '@/lib/api-auth';
import { ensureMindyFreeProfile } from '@/lib/mindy/free-profile';
import { scheduleAttributionClaim } from '@/lib/attribution/claim-from-request';

export async function POST(request: NextRequest) {
  const auth = await verifyUserSession(request);

  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  try {
    await ensureMindyFreeProfile(auth.email);
    // The email setup-password path verifies here and never mints an MI token, so the
    // share/anonymous acquisition claim has to run here too (mi-session covers the rest).
    scheduleAttributionClaim(request, auth.email, auth.createdAt ?? null);
    return NextResponse.json({ success: true, email: auth.email });
  } catch (error) {
    console.error('[Mindy Complete Signup] Failed to complete signup:', error);
    return NextResponse.json({ success: false, error: 'Unable to complete signup' }, { status: 500 });
  }
}
