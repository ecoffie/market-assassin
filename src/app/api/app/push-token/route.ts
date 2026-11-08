/**
 * POST   /api/app/push-token  { email, token, platform }  — register this device for push
 * DELETE /api/app/push-token  { email, token }            — unregister (sign-out / opt-out)
 *
 * Called by src/components/NativeBridge.tsx inside the Mindy iOS/Android app.
 * Identity = the verified MI session (requireMIAuthSession), never the body alone.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { getWriteClient } from '@/lib/supabase/server-clients';

export const dynamic = 'force-dynamic';

const TOKEN_RE = /^[A-Za-z0-9:_\-.]{20,4096}$/;

function parse(body: Record<string, unknown>) {
  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const platform = body.platform === 'ios' || body.platform === 'android' ? body.platform : null;
  return { email, token, platform };
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { email, token, platform } = parse(body);
  if (!email || !TOKEN_RE.test(token) || !platform) {
    return NextResponse.json({ success: false, error: 'email, token and platform are required' }, { status: 400 });
  }
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const now = new Date().toISOString();
  const { error } = await getWriteClient()
    .from('mobile_push_tokens')
    .upsert(
      { user_email: email, token, platform, last_seen_at: now, disabled_at: null, disabled_reason: null },
      { onConflict: 'token' },
    );
  if (error) {
    console.error('[push-token] upsert failed', error.message);
    return NextResponse.json({ success: false, error: 'Could not register device' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { email, token } = parse(body);
  if (!email || !TOKEN_RE.test(token)) {
    return NextResponse.json({ success: false, error: 'email and token are required' }, { status: 400 });
  }
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const { error } = await getWriteClient()
    .from('mobile_push_tokens')
    .update({ disabled_at: new Date().toISOString(), disabled_reason: 'user_unregistered' })
    .eq('token', token)
    .eq('user_email', email);
  if (error) {
    console.error('[push-token] disable failed', error.message);
    return NextResponse.json({ success: false, error: 'Could not unregister device' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
