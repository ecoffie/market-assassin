/**
 * POST /api/app/signup-type  { signupType }  — records the signed-in user's "which best describes
 * you?" answer (src/lib/mindy/signup-type.ts). Identity comes from the verified session token only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { resolveMcpEmail } from '@/lib/mcp/session-identity';
import { getWriteClient } from '@/lib/supabase/server-clients';
import { isSignupType } from '@/lib/mindy/signup-type';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const email = await resolveMcpEmail(request);
  if (!email) return NextResponse.json({ success: false, error: 'not_authenticated' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!isSignupType(body?.signupType)) {
    return NextResponse.json({ success: false, error: 'invalid_signup_type' }, { status: 400 });
  }
  const { error } = await getWriteClient().from('user_engagement').insert({
    user_email: email,
    event_type: 'profile_update',
    event_source: 'onboarding',
    metadata: { action: 'signup_type', signup_type: body.signupType },
  });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
