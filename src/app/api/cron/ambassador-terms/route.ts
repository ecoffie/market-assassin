/**
 * /api/cron/ambassador-terms — ends each Mindy Ambassador's term at twelve months.
 *
 * Owner, 2026-11-16: "end at 12". Daily. For every APPROVED ambassador, counted from `decided_at`:
 *   - day >= TERM_NOTICE_DAY (335) and no notice yet → email "your term ends on <date>", once.
 *   - day >= TERM_DAYS (365) → revoke the Pro grant (the same path as the admin Remove button)
 *     and mark the row `ended`, which also stops the zero-cost MCP calls.
 * A failed revoke leaves the row `approved` so tomorrow's run retries it, and the run returns 500
 * so `cron_job_runs.http_status` shows the failure. `?preview=1` reports what it would do.
 *
 * Registered as a `cron_jobs` row (dispatcher), not vercel.json:
 * supabase/migrations/20261116_ambassador_terms_cron.sql.
 */
import { NextRequest, NextResponse } from 'next/server';
import { listAmbassadors, markTermNoticeSent, setDecision, termStatus } from '@/lib/ambassadors/store';
import { sendTermEndingEmail } from '@/lib/ambassadors/emails';
import { applyMemberGrant } from '@/lib/admin/member-grants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ACTOR = 'ambassador-term-job';

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const hasSecret = !!process.env.CRON_SECRET && request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  const isAdmin = !!process.env.ADMIN_PASSWORD && request.nextUrl.searchParams.get('password') === process.env.ADMIN_PASSWORD;
  if (!isVercelCron && !hasSecret && !isAdmin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const preview = request.nextUrl.searchParams.get('preview') === '1';
  const now = new Date();
  let approved;
  try {
    approved = await listAmbassadors('approved');
  } catch (err) {
    return NextResponse.json({ success: false, message: (err as Error).message }, { status: 500 });
  }

  const noticed: string[] = [];
  const ended: string[] = [];
  const errors: string[] = [];
  for (const row of approved) {
    const t = termStatus(row.decided_at, now);
    if (!t || t.due === 'none') continue;

    if (t.due === 'end') {
      if (preview) { ended.push(row.email); continue; }
      const grant = await applyMemberGrant({ targetEmail: row.email, actorEmail: ACTOR, tier: 'pro', action: 'revoke', sendWelcome: false, note: 'Ambassador twelve-month term ended' });
      if (!grant.success) { errors.push(`${row.email}: revoke failed: ${grant.error || grant.message}`); continue; }
      try {
        await setDecision(row.email, 'ended', ACTOR, 'Twelve-month term ended');
        ended.push(row.email);
      } catch (err) {
        errors.push(`${row.email}: ${(err as Error).message}`);
      }
      continue;
    }

    // due === 'notice'
    if (row.term_notice_sent_at) continue;
    if (preview) { noticed.push(row.email); continue; }
    const sent = await sendTermEndingEmail(row.email, row.name, t.endsAt);
    if (!sent) { errors.push(`${row.email}: term notice email not sent`); continue; }
    try {
      await markTermNoticeSent(row.email);
      noticed.push(row.email);
    } catch (err) {
      errors.push(`${row.email}: notice sent but not recorded: ${(err as Error).message}`);
    }
  }

  const body = {
    success: errors.length === 0,
    message: `${preview ? 'Preview: ' : ''}${approved.length} approved · ${noticed.length} term notices · ${ended.length} terms ended${errors.length ? ` · ${errors.length} errors` : ''}`,
    data: { preview, approved: approved.length, noticed, ended },
    errors: errors.length ? errors : undefined,
  };
  return NextResponse.json(body, { status: errors.length ? 500 : 200 });
}
