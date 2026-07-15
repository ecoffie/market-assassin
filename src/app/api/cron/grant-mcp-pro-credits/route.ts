/**
 * /api/cron/grant-mcp-pro-credits — grant Pro members their monthly MCP credit
 * allowance (the hybrid model: Pro includes credits).
 *
 * Phase 1 Slice 4. Runs monthly. Idempotent per user per month via
 * applyCreditOnce(key='pro:<email>:<YYYY-MM>'), so re-runs (or a mid-month deploy
 * re-fire) never double-grant.
 *
 * AUDIENCE = KV `briefings:<email>` grant holders — the REAL Pro-access gate
 * (the same key `hasBriefingsAccess` / the tools read). Decided 2026-07-14 after
 * the old `user_notification_settings.briefings_enabled` audience turned out to be
 * the ~688-user beta cohort (NOT paid Pro) — granting them would give away ~688k
 * metered credits/month. The KV gate is ~75 people and correctly includes
 * lifetime/bundle Pro (who have the grant but no active $149 sub). We deliberately
 * INCLUDE the handful of comp/staff/advocate holders: they already have Pro access,
 * so a Pro-tier MCP allowance is consistent (per Eric).
 */
import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { applyCreditOnce } from '@/lib/mcp/credits';
import { PRO_MONTHLY_CREDITS } from '@/lib/mcp/packages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Enumerate the KV Pro-access population: `briefings:<email>` keys set to 'true'.
 * Excludes `briefings:rollout:*` state keys and any non-email key. Fails closed
 * (returns []) if KV is unavailable so a scan error grants nobody rather than throwing.
 */
async function proAudienceFromKv(): Promise<string[]> {
  const emails: string[] = [];
  let cursor = 0;
  try {
    do {
      const [next, keys] = await kv.scan(cursor, { match: 'briefings:*', count: 500 });
      cursor = Number(next);
      for (const k of keys as string[]) {
        if (!k.startsWith('briefings:') || k.startsWith('briefings:rollout:')) continue;
        const email = k.slice('briefings:'.length);
        if (email.includes('@')) emails.push(email.toLowerCase());
      }
    } while (cursor !== 0);
  } catch (err) {
    console.error('[mcp:pro-grant] KV scan failed — granting nobody this run', err);
    return [];
  }
  return Array.from(new Set(emails));
}

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

  // Dry-run: `?preview=1` reports the audience without granting (safe to run anytime).
  const preview = request.nextUrl.searchParams.get('preview') === '1';

  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const emails = await proAudienceFromKv();

  if (preview) {
    return NextResponse.json({
      success: true,
      preview: true,
      month,
      audience: emails.length,
      creditsEach: PRO_MONTHLY_CREDITS,
      sample: emails.slice(0, 10),
    });
  }

  let granted = 0;
  let alreadyHad = 0;
  const errors: string[] = [];
  for (const email of emails) {
    try {
      const { applied } = await applyCreditOnce(`pro:${email}:${month}`, email, PRO_MONTHLY_CREDITS, 'pro_monthly');
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
