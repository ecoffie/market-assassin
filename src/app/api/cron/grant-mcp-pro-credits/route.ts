/**
 * /api/cron/grant-mcp-pro-credits — grant active Pro subscribers their monthly MCP
 * credit allowance (the hybrid model: $149/mo Pro includes credits).
 *
 * Phase 1 Slice 4. Runs monthly. Idempotent per user per month via
 * applyCreditOnce(key='pro:<email>:<YYYY-MM>'), so re-runs (or a mid-month deploy
 * re-fire) never double-grant. Audience = briefings-enabled users in
 * user_notification_settings (the MI Pro / briefings cohort) — the same population the
 * briefing crons use. Read from the replica; grants go to the primary.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';
import { applyCreditOnce } from '@/lib/mcp/credits';
import { PRO_MONTHLY_CREDITS } from '@/lib/mcp/packages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PAGE = 1000;

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const hasSecret = request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  const isAdmin = request.nextUrl.searchParams.get('password') === process.env.ADMIN_PASSWORD;
  if (!isVercelCron && !hasSecret && !isAdmin) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (PRO_MONTHLY_CREDITS <= 0) {
    return NextResponse.json({ success: true, skipped: 'MCP_PRO_MONTHLY_CREDITS=0', granted: 0 });
  }

  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const db = getReadClient();

  // Page through the whole Pro/briefings audience (past the 1000-row cap).
  const emails: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('user_notification_settings')
      .select('user_email')
      .eq('is_active', true)
      .eq('briefings_enabled', true)
      .order('user_email', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    emails.push(...data.map((r: { user_email: string }) => r.user_email));
    if (data.length < PAGE) break;
  }

  let granted = 0;
  let alreadyHad = 0;
  const errors: string[] = [];
  for (const email of emails) {
    try {
      const { applied } = await applyCreditOnce(`pro:${email.toLowerCase()}:${month}`, email, PRO_MONTHLY_CREDITS, 'pro_monthly');
      if (applied) granted++;
      else alreadyHad++;
    } catch (err) {
      errors.push(`${email}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    success: true,
    month,
    audience: emails.length,
    granted, // newly credited this run
    alreadyHad, // idempotent skips (already had this month's allowance)
    creditsEach: PRO_MONTHLY_CREDITS,
    errors: errors.slice(0, 20),
  });
}
