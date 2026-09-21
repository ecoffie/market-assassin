/**
 * GET    /api/app/linked-emails?email=…            → list this account's verified links
 * POST   /api/app/linked-emails                    → { email, targetEmail }        send OTP
 * PUT    /api/app/linked-emails                    → { email, targetEmail, code }  confirm
 * DELETE /api/app/linked-emails?email=…&target=…   → unlink
 *
 * WHY (Eric, 2026-07-29): "our users do this all the time — buy with one email, sign in with
 * another. This is a standard, not a bug." The Billing card resolves only the signed-in email,
 * so a customer who checked out under a different address sees the WRONG subscription and can't
 * reach the Stripe portal that owns their real plan. Alisha Martin hit exactly this: signed in
 * as one address holding an old $99 coaching sub, while her live $149 Mindy sub sat under
 * another — no cancel button anywhere, so she had to email support.
 *
 * The link is user-asserted and OTP-proven, never inferred (auto-linking two addresses would be
 * a guess, and a wrong guess leaks one customer's billing to another).
 *
 * EVERY mutation is gated on verifyUserOwnsEmail for the SIGNED-IN address, so a caller can only
 * add links to their own account. Proof of the SECOND address comes from the OTP mailed to it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import {
  requestEmailLink, confirmEmailLink, getLinkedEmails, unlinkEmail,
  normalizeEmail, LINK_CODE_TTL_MINUTES, MAX_LINKED_EMAILS,
} from '@/lib/mindy/linked-emails';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientMeta(request: NextRequest) {
  return {
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    userAgent: request.headers.get('user-agent') || null,
  };
}

export async function GET(request: NextRequest) {
  const email = normalizeEmail(request.nextUrl.searchParams.get('email') || '');
  if (!email) return NextResponse.json({ success: false, error: 'email required' }, { status: 400 });
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });

  const all = await getLinkedEmails(email);
  return NextResponse.json({
    success: true,
    primary: email,
    // Just the extras — the caller already knows their own address.
    linked: all.filter((e) => e !== email),
    max: MAX_LINKED_EMAILS,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email || '');
  const targetEmail = normalizeEmail(body.targetEmail || '');
  if (!email || !targetEmail) {
    return NextResponse.json({ success: false, error: 'email and targetEmail required' }, { status: 400 });
  }
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });

  const r = await requestEmailLink(email, targetEmail, clientMeta(request));
  if (r.ok) {
    return NextResponse.json({
      success: true,
      message: `We sent a 6-digit code to ${targetEmail}. It expires in ${LINK_CODE_TTL_MINUTES} minutes.`,
    });
  }
  // Deliberate wording: 'taken' never reveals WHO holds the address.
  const msg: Record<string, string> = {
    'same-email': "That's the email you're already signed in with.",
    throttled: 'A code was just sent to that address — check the inbox, or try again in a minute.',
    limit: `You can connect up to ${MAX_LINKED_EMAILS} email addresses.`,
    taken: 'That email is already connected to another Mindy account. Contact support@getmindy.ai and we can sort it out.',
    table: 'Email linking is not available yet — please contact support.',
    error: r.error || 'Could not send the verification code.',
  };
  const status = r.reason === 'throttled' ? 429 : r.reason === 'taken' ? 409 : 400;
  return NextResponse.json({ success: false, error: msg[r.reason] || 'Failed' }, { status });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email || '');
  const targetEmail = normalizeEmail(body.targetEmail || '');
  const code = String(body.code || '').trim();
  if (!email || !targetEmail || !code) {
    return NextResponse.json({ success: false, error: 'email, targetEmail and code required' }, { status: 400 });
  }
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });

  const r = await confirmEmailLink(email, targetEmail, code);
  if (r.ok) {
    return NextResponse.json({
      success: true,
      linkedEmail: r.linkedEmail,
      message: `${r.linkedEmail} is now connected. Any subscription on it will appear in your billing.`,
    });
  }
  const msg: Record<string, string> = {
    invalid: "That code doesn't match. Check the code and try again.",
    expired: 'That code has expired — request a new one.',
    taken: 'That email is already connected to another Mindy account.',
    table: 'Email linking is not available yet — please contact support.',
    error: r.error || 'Could not confirm that code.',
  };
  return NextResponse.json({ success: false, error: msg[r.reason] || 'Failed' }, { status: r.reason === 'taken' ? 409 : 400 });
}

export async function DELETE(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const email = normalizeEmail(sp.get('email') || '');
  const target = normalizeEmail(sp.get('target') || '');
  if (!email || !target) return NextResponse.json({ success: false, error: 'email and target required' }, { status: 400 });
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) return NextResponse.json({ success: false, error: auth.error || 'Unauthorized' }, { status: 401 });

  const ok = await unlinkEmail(email, target);
  return NextResponse.json({ success: ok, ...(ok ? {} : { error: 'Could not unlink that email' }) }, { status: ok ? 200 : 400 });
}
