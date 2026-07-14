/**
 * POST /api/app/change-email/request
 *
 * Step 1 of self-serve change-email. The signed-in user asks to move their
 * account to a NEW email. We do NOT change anything here — we:
 *   1. authenticate the current session (must own the OLD email),
 *   2. validate the new email + block if it already has an account (collision →
 *      route to support merge, never clobber),
 *   3. mint a single-use verification token, store its HASH + expiry in
 *      email_change_log (status='requested'),
 *   4. email the verify link to the NEW address.
 *
 * The change only applies when that link is clicked (see ./confirm). This is the
 * mandatory verify-click — GovCon standard, non-optional. Rate-limited 1/24h.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { sendEmail } from '@/lib/send-email';
import { renderMindyEmailLogo } from '@/lib/mindy/email-branding';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VERIFY_TTL_MINUTES = 30;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://getmindy.ai';

function normalize(email: string) {
  return (email || '').toLowerCase().trim();
}

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

function hashToken(token: string) {
  const secret = process.env.TWO_FACTOR_SECRET || process.env.ADMIN_PASSWORD || 'mindy-change-email';
  return createHash('sha256').update(`${token}:${secret}`).digest('hex');
}

async function emailHasAccount(sb: ReturnType<typeof getSupabase>, email: string): Promise<boolean> {
  const { data: profile } = await sb.from('user_profiles').select('email').eq('email', email).maybeSingle();
  if (profile) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.auth.admin as any).listUsers();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data?.users || []).some((u: any) => normalize(u.email || '') === email);
}

export async function POST(request: NextRequest) {
  let body: { email?: string; newEmail?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  const currentEmail = normalize(body.email || '');
  const newEmail = normalize(body.newEmail || '');

  // Must be signed in as the account being changed.
  const auth = requireMIAuthSession(request, currentEmail);
  if (!auth.ok) return auth.response;

  if (!newEmail || !newEmail.includes('@')) {
    return NextResponse.json({ success: false, error: 'Enter a valid new email address.' }, { status: 400 });
  }
  if (newEmail === currentEmail) {
    return NextResponse.json({ success: false, error: 'That is already your email.' }, { status: 400 });
  }

  const sb = getSupabase();

  // Rate-limit: one in-flight/recent change per account per 24h.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentErr } = await sb
    .from('email_change_log')
    .select('id, status, created_at')
    .eq('old_email', currentEmail)
    .gte('created_at', dayAgo)
    .in('status', ['requested', 'verified', 'executing', 'completed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recentErr) {
    // A renamed/missing column would null this out and silently let a user spam
    // change-requests. Surface it rather than swallow (PostgREST-null trap).
    console.error('[change-email/request] rate-limit lookup failed', recentErr);
    return NextResponse.json({ success: false, error: 'Could not start the email change. Please try again.' }, { status: 500 });
  }
  if (recent) {
    return NextResponse.json(
      { success: false, error: 'An email change was already requested recently. Please check your inbox or try again later.' },
      { status: 429 }
    );
  }

  // COLLISION GUARD — never clobber an occupied address.
  if (await emailHasAccount(sb, newEmail)) {
    // Record the blocked attempt for support visibility.
    await sb.from('email_change_log').insert({
      old_email: currentEmail,
      new_email: newEmail,
      initiated_by: 'self_serve',
      status: 'blocked_collision',
      ip_address: request.headers.get('x-forwarded-for') || null,
      user_agent: request.headers.get('user-agent') || null,
    });
    return NextResponse.json(
      {
        success: false,
        collision: true,
        error: 'That email already has a Mindy account. Contact support to merge the two accounts.',
      },
      { status: 409 }
    );
  }

  // Mint the single-use token; store only its hash.
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MINUTES * 60 * 1000).toISOString();
  const { error: insertErr } = await sb.from('email_change_log').insert({
    old_email: currentEmail,
    new_email: newEmail,
    initiated_by: 'self_serve',
    status: 'requested',
    verify_token_hash: hashToken(token),
    verify_expires_at: expiresAt,
    ip_address: request.headers.get('x-forwarded-for') || null,
    user_agent: request.headers.get('user-agent') || null,
  });
  if (insertErr) {
    return NextResponse.json({ success: false, error: 'Could not start the email change. Please try again.' }, { status: 500 });
  }

  // Email the verify link to the NEW address (proves the user owns it).
  const verifyUrl = `${APP_URL}/app/change-email/confirm?token=${encodeURIComponent(token)}`;
  const html = `
    ${renderMindyEmailLogo()}
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 12px">Confirm your new email</h2>
      <p style="margin:0 0 16px;line-height:1.5">
        A request was made to change the email on a Mindy account from
        <strong>${currentEmail}</strong> to <strong>${newEmail}</strong>.
        Click below to confirm this is your address and complete the change.
      </p>
      <p style="margin:0 0 20px">
        <a href="${verifyUrl}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">Confirm new email</a>
      </p>
      <p style="margin:0 0 8px;color:#475569;font-size:13px">This link expires in ${VERIFY_TTL_MINUTES} minutes. If you didn't request this, you can ignore this email — nothing will change.</p>
      <p style="margin:0;color:#94a3b8;font-size:12px;word-break:break-all">Or paste this link: ${verifyUrl}</p>
    </div>`;

  await sendEmail({
    to: newEmail,
    subject: 'Confirm your new Mindy email',
    html,
    text: `Confirm changing your Mindy email from ${currentEmail} to ${newEmail}: ${verifyUrl} (expires in ${VERIFY_TTL_MINUTES} minutes).`,
    emailType: 'account_change_email_verify',
    transactional: true, // account-critical — bypasses marketing send-guard
  });

  return NextResponse.json({
    success: true,
    message: `We sent a confirmation link to ${newEmail}. Click it to complete the change. Your current email keeps working until you do.`,
  });
}
