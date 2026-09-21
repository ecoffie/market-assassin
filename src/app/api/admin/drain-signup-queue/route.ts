import { NextRequest, NextResponse } from 'next/server';
import { drainPendingSignups, requeuePendingSignup, pendingSignupCount, type PendingSignup } from '@/lib/resilience/signup-queue';
import { POST as signupPost } from '@/app/api/auth/mi-signup/route';

export const runtime = 'nodejs';

/**
 * Drain the outage signup queue — completes free-alert signups that were
 * captured while Supabase was down (see src/lib/resilience/signup-queue.ts).
 * Run this AFTER the DB recovers.
 *
 *   GET  ?password=...            → preview: how many are pending (no writes)
 *   POST ?password=...&max=100    → execute: replay each queued email through
 *                                    the real signup path; re-queue on failure.
 *
 * Each replay reconstructs a signup request and calls the mi-signup POST
 * handler, so the queued prospect gets the exact same account + welcome email
 * they'd have gotten had the DB been up. Idempotent-ish: mi-signup's own
 * generateLink handles an already-existing user (invite → recovery link), so a
 * double-drain won't create duplicates.
 */

function authorized(request: NextRequest): boolean {
  const password = new URL(request.url).searchParams.get('password');
  const expected = process.env.ADMIN_PASSWORD;
  return !!expected && password === expected;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const pending = await pendingSignupCount();
  return NextResponse.json({
    success: true,
    mode: 'preview',
    pending,
    message: pending === 0 ? 'Queue is empty — nothing to drain.' : `${pending} signup(s) waiting. POST to complete them.`,
  });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const maxParam = new URL(request.url).searchParams.get('max');
  const max = Math.min(Math.max(parseInt(maxParam || '100', 10) || 100, 1), 500);

  const entries = await drainPendingSignups(max);
  const results: { email: string; ok: boolean; error?: string }[] = [];

  for (const entry of entries) {
    try {
      const ok = await replaySignup(entry);
      results.push({ email: entry.email, ok });
      if (!ok) await requeuePendingSignup(entry); // transient failure — don't lose them
    } catch (err) {
      results.push({ email: entry.email, ok: false, error: (err as Error)?.message });
      await requeuePendingSignup(entry);
    }
  }

  const completed = results.filter((r) => r.ok).length;
  const remaining = await pendingSignupCount();
  return NextResponse.json({
    success: true,
    mode: 'execute',
    processed: entries.length,
    completed,
    failed: entries.length - completed,
    remaining,
    results,
  });
}

/** Replay one queued signup through the real mi-signup POST handler. */
async function replaySignup(entry: PendingSignup): Promise<boolean> {
  const req = new NextRequest('https://getmindy.ai/api/auth/mi-signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: entry.email, referralCode: entry.referralCode, source: entry.source || 'outage_queue_drain' }),
  });
  const res = await signupPost(req);
  const data = await res.json().catch(() => ({}));
  // A real completion returns success WITHOUT the `queued` flag. If it came back
  // queued again, the DB is still down — treat as not-yet-done (re-queued by caller).
  return res.ok && data?.success === true && data?.queued !== true;
}
