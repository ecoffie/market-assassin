/**
 * POST /api/app/change-email/confirm  { token }
 *
 * Step 2 — the verify-click target. Validates the single-use token, then runs
 * the actual move:
 *   1. reKeyAccountEmail(old, new, 'execute') — Auth user + all email-keyed rows
 *   2. updateStripeCustomerEmail(old, new)   — billing follows the login
 *   3. re-mint the MI session token under the new email
 *   4. notify BOTH addresses (new = success; old = security notice)
 *
 * Idempotent: a double-click (token already consumed) returns the completed
 * state, not an error. Resumable: status + steps are stamped to email_change_log
 * so a run that dies mid-move can be re-driven.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { reKeyAccountEmail } from '@/lib/mindy/rekey-account-email';
import { updateStripeCustomerEmail } from '@/lib/mindy/stripe-rekey-email';
import { createMIAuthSessionToken } from '@/lib/two-factor-session';
import { sendEmail } from '@/lib/send-email';
import { renderMindyEmailLogo } from '@/lib/mindy/email-branding';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getSupabase() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

function hashToken(token: string) {
  const secret = process.env.TWO_FACTOR_SECRET || process.env.ADMIN_PASSWORD || 'mindy-change-email';
  return createHash('sha256').update(`${token}:${secret}`).digest('hex');
}

export async function POST(request: NextRequest) {
  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }
  const token = String(body.token || '');
  if (!token) return NextResponse.json({ success: false, error: 'Missing confirmation token' }, { status: 400 });

  const sb = getSupabase();
  const tokenHash = hashToken(token);

  const { data: row } = await sb
    .from('email_change_log')
    .select('*')
    .eq('verify_token_hash', tokenHash)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ success: false, error: 'This link is invalid or has already been used.' }, { status: 400 });
  }

  // Idempotent double-click: already done → return success with the new email.
  if (row.status === 'completed') {
    return NextResponse.json({ success: true, alreadyDone: true, newEmail: row.new_email, sessionToken: createMIAuthSessionToken(row.new_email) });
  }
  // Expired?
  if (row.verify_expires_at && new Date(row.verify_expires_at).getTime() < Date.now()) {
    await sb.from('email_change_log').update({ status: 'failed', error: 'token expired', updated_at: new Date().toISOString() }).eq('id', row.id);
    return NextResponse.json({ success: false, error: 'This confirmation link has expired. Please request the change again.' }, { status: 400 });
  }

  const oldEmail = row.old_email as string;
  const newEmail = row.new_email as string;

  await sb.from('email_change_log').update({ status: 'verified', verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', row.id);

  // 1) Move the account data + Auth user.
  await sb.from('email_change_log').update({ status: 'executing', updated_at: new Date().toISOString() }).eq('id', row.id);
  const reKey = await reKeyAccountEmail(oldEmail, newEmail, 'execute');

  if (reKey.collision) {
    await sb.from('email_change_log').update({ status: 'blocked_collision', steps: reKey.steps, updated_at: new Date().toISOString() }).eq('id', row.id);
    return NextResponse.json({ success: false, collision: true, error: 'That email now has an account. Contact support.' }, { status: 409 });
  }
  if (!reKey.ok) {
    await sb.from('email_change_log').update({ status: 'failed', steps: reKey.steps, error: 'rekey step failed', updated_at: new Date().toISOString() }).eq('id', row.id);
    // Fail SAFE: old email still works (nothing removed its access). Surface for retry.
    return NextResponse.json({ success: false, error: 'Something went wrong completing the change. Support has been notified; your current email still works.' }, { status: 500 });
  }

  // 2) Stripe — billing follows the login (fail-soft; app data already moved).
  const stripe = await updateStripeCustomerEmail(oldEmail, newEmail);

  // 3) Stamp completion + the full step record.
  await sb.from('email_change_log').update({
    status: 'completed',
    steps: [...reKey.steps, { step: 'stripe-customer-email', ok: stripe.ok, rows: stripe.updated.length, error: stripe.error, skipped: stripe.skipped }],
    updated_at: new Date().toISOString(),
  }).eq('id', row.id);

  // 4) Notify both addresses (transactional — account-critical).
  const logo = renderMindyEmailLogo();
  await Promise.allSettled([
    sendEmail({
      to: newEmail,
      subject: 'Your Mindy email was updated',
      html: `${logo}<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a"><h2>Email updated ✅</h2><p>Your Mindy account now uses <strong>${newEmail}</strong>. Sign in with this address going forward — your plan, saved work, and settings all came with you.</p></div>`,
      text: `Your Mindy account email is now ${newEmail}. Everything carried over.`,
      emailType: 'account_change_email_done',
      transactional: true,
    }),
    sendEmail({
      to: oldEmail,
      subject: 'Your Mindy email was changed',
      html: `${logo}<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a"><h2>Security notice</h2><p>The email on your Mindy account was changed to <strong>${newEmail}</strong>. If you did this, no action is needed. If you did NOT, contact support immediately.</p></div>`,
      text: `Your Mindy account email was changed to ${newEmail}. If this wasn't you, contact support immediately.`,
      emailType: 'account_change_email_notice',
      transactional: true,
    }),
  ]);

  // Fresh session under the new email so the user stays signed in.
  return NextResponse.json({
    success: true,
    newEmail,
    sessionToken: createMIAuthSessionToken(newEmail),
    message: 'Your email has been changed. You are now signed in with your new address.',
  });
}
