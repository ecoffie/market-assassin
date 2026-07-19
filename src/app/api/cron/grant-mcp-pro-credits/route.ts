/**
 * /api/cron/grant-mcp-pro-credits — monthly COMP MCP-credit grant for INTERNAL accounts only.
 *
 * Two-product model (2026-07-19 — docs/strategy/PRICING-MODEL-2026-07-18.md):
 *   • Mindy APP (Free / Pro $149 / Team $499) = flat, tier-gated web tools, NO MCP credits.
 *   • Mindy MCP (metered, from $99) = credit-metered agent access, bought separately.
 * So app-Pro/Team subscribers are NO LONGER auto-granted MCP credits here — MCP is a
 * separate purchase (the Starter/MCP subscription grants via the Stripe subscription webhook;
 * everyone else buys credit packs). Existing balances are untouched (grandfathered).
 *
 * This cron now serves ONLY internal comp accounts: team/staff (INTERNAL_TEAM_EMAILS +
 * branden@govcongiants.com) + advocates (Sue, AJ) → PRO_MONTHLY_CREDITS each, ongoing.
 * Comp/testimonial (Kurt, Ryan, …) are NOT here — one-time trial via scripts/reset-comp-credits.
 *
 * The audience is a small explicit list (no KV scan), so the 688k-accident class is gone by
 * construction. Idempotent per month via applyCreditOnce(key='pro:<email>:<YYYY-MM>').
 */
import { NextRequest, NextResponse } from 'next/server';
import { applyCreditOnce } from '@/lib/mcp/credits';
import { PRO_MONTHLY_CREDITS } from '@/lib/mcp/packages';
import { INTERNAL_TEAM_EMAILS } from '@/lib/api-auth';
import { ADVOCATE_ACCOUNTS } from '@/lib/mindy/advocate-accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Internal accounts that get an ongoing comp MCP allowance: team/staff + advocates.
// (App subscribers are NOT here — MCP is a separate product now.)
const INTERNAL_ONGOING = Array.from(
  new Set(
    [
      ...INTERNAL_TEAM_EMAILS,
      'branden@govcongiants.com',
      ...ADVOCATE_ACCOUNTS.map((a) => a.email),
    ].map((e) => e.toLowerCase().trim()),
  ),
);

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

  const preview = request.nextUrl.searchParams.get('preview') === '1';
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM

  if (preview) {
    return NextResponse.json({
      success: true,
      preview: true,
      scope: 'internal-comp-only (team/staff + advocates)',
      month,
      audience: INTERNAL_ONGOING.length,
      creditsEach: PRO_MONTHLY_CREDITS,
      emails: INTERNAL_ONGOING,
    });
  }

  let granted = 0;
  let alreadyHad = 0;
  const errors: string[] = [];
  for (const email of INTERNAL_ONGOING) {
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
    scope: 'internal-comp-only',
    month,
    audience: INTERNAL_ONGOING.length,
    granted,
    alreadyHad,
    creditsEach: PRO_MONTHLY_CREDITS,
    errors: errors.slice(0, 20),
  });
}
