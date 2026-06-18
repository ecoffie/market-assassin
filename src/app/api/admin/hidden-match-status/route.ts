/**
 * Admin: report the RUNTIME-resolved hidden-match gate state.
 *
 * The daily-alerts cron gates hidden-match on env flags that are easy to get
 * subtly wrong (trailing newline from a Vercel UI paste makes `=== 'true'`
 * silently false; whitelist case/spacing). This endpoint resolves the flags the
 * EXACT way the cron does and reports what it sees — so we prove the feature is
 * live instead of eyeballing an encrypted env value.
 *
 * GET ?password=...&email=demo@govcongiants.com
 *   → { enabled, rolloutPercent, whitelist, wouldFire: { email, inWhitelist, inRollout, eligible } }
 */
import { NextRequest, NextResponse } from 'next/server';
import { userInRollout } from '@/lib/intelligence/feature-flag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Resolve EXACTLY as the cron does (src/app/api/cron/daily-alerts/route.ts).
  const rawEnable = process.env.ENABLE_HIDDEN_MATCH || '';
  const enabled = rawEnable.trim() === 'true';
  const rolloutPercent = Number((process.env.HIDDEN_MATCH_ROLLOUT_PERCENT || '0').trim()) || 0;
  const whitelist = (process.env.HIDDEN_MATCH_WHITELIST || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

  // Catch the trailing-newline gotcha explicitly.
  const enableHadWhitespace = rawEnable !== rawEnable.trim();

  const email = (request.nextUrl.searchParams.get('email') || '').toLowerCase().trim();
  let wouldFire: Record<string, unknown> | null = null;
  if (email) {
    const inWhitelist = whitelist.includes(email);
    const inRollout = userInRollout(email, rolloutPercent, 'hidden-match-v1');
    wouldFire = { email, inWhitelist, inRollout, eligible: enabled && (inWhitelist || inRollout) };
  }

  return NextResponse.json({
    success: true,
    enabled,
    rawEnableValue: JSON.stringify(rawEnable), // shows quotes → reveals trailing \n or spaces
    enableHadWhitespace,
    rolloutPercent,
    whitelist,
    wouldFire,
    note: enabled
      ? 'ENABLE_HIDDEN_MATCH resolves true. Whitelisted or in-rollout users get hidden-match.'
      : 'ENABLE_HIDDEN_MATCH does NOT resolve true — feature is OFF for everyone. Check the Production value is exactly "true" (no trailing newline).',
  });
}
