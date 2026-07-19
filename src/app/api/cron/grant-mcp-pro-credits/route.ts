/**
 * /api/cron/grant-mcp-pro-credits — grant members their monthly MCP credit allowance
 * (the hybrid model: a subscription includes credits). Runs monthly. Idempotent per user
 * per month via applyCreditOnce(key='pro:<email>:<YYYY-MM>'), so re-runs never double-grant.
 *
 * AUDIENCE (2026-07-18 three-tier model — docs/strategy/PRICING-MODEL-2026-07-18.md):
 *   include = KV `briefings:<email>` (paid Pro + lifetime/bundle Pro)
 *           ∪ team/staff (INTERNAL_TEAM_EMAILS + branden@govcongiants.com — the @govcongiants
 *             domain can't be enumerated from KV, so staff are listed explicitly)
 *           ∪ advocates (Sue, AJ — the marketing engine, kept ongoing on purpose)
 *   EXCLUDE = comp/testimonial (Kurt, Ryan, pa.joof, …) — they get a ONE-TIME trial via
 *             scripts/reset-comp-credits.ts, NEVER a monthly refill (they should run out).
 *
 * AMOUNT is tier-aware: user_profiles.access_team → TEAM_MONTHLY_CREDITS (8,000), else
 * PRO_MONTHLY_CREDITS (1,500). Team-query failure fails to the Pro amount (under-grant, safe).
 *
 * ⚠️ This is the EXACT cron that caused the 688k-credit accident (it once targeted the ~688
 * beta cohort instead of ~75 real Pro). ALWAYS `?preview=1` and eyeball the audience first.
 */
import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { createClient } from '@supabase/supabase-js';
import { applyCreditOnce } from '@/lib/mcp/credits';
import { PRO_MONTHLY_CREDITS, TEAM_MONTHLY_CREDITS } from '@/lib/mcp/packages';
import { INTERNAL_TEAM_EMAILS } from '@/lib/api-auth';
import { ADVOCATE_ACCOUNTS } from '@/lib/mindy/advocate-accounts';
import { COMP_TESTIMONIAL_EMAILS } from '@/lib/mindy/campaign-exclusions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Internal accounts that get an ongoing monthly comp allowance (at their own tier).
// team/staff (explicit — domain can't be scanned) + advocates. Comp/testimonial are NOT here.
const INTERNAL_ONGOING = new Set<string>(
  [
    ...INTERNAL_TEAM_EMAILS,
    'branden@govcongiants.com',
    ...ADVOCATE_ACCOUNTS.map((a) => a.email),
  ].map((e) => e.toLowerCase().trim()),
);

/**
 * KV Pro-access population: `briefings:<email>` keys. Excludes `briefings:rollout:*` and
 * non-email keys. Fails closed ([]) so a KV error grants nobody rather than throwing.
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

/** Emails with an active Team ($499) subscription → the higher allowance. Fails to empty. */
async function teamEmails(): Promise<Set<string>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const out = new Set<string>();
  if (!url || !key) return out;
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await supabase.from('user_profiles').select('email').eq('access_team', true);
    if (error) { console.error('[mcp:pro-grant] team query failed — all Pro amount:', error.message); return out; }
    for (const r of data ?? []) if (r?.email) out.add(String(r.email).toLowerCase().trim());
  } catch (err) {
    console.error('[mcp:pro-grant] team query threw — all Pro amount:', err);
  }
  return out;
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

  const preview = request.nextUrl.searchParams.get('preview') === '1';
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM

  // Audience = (paid-Pro KV ∪ internal-ongoing) MINUS comp/testimonial (unless internal-ongoing).
  const kvEmails = await proAudienceFromKv();
  const audience = Array.from(new Set([...kvEmails, ...INTERNAL_ONGOING])).filter(
    (e) => INTERNAL_ONGOING.has(e) || !COMP_TESTIMONIAL_EMAILS.has(e),
  );
  const team = await teamEmails();
  const amountFor = (email: string) => (team.has(email) ? TEAM_MONTHLY_CREDITS : PRO_MONTHLY_CREDITS);

  const excluded = [...kvEmails].filter((e) => COMP_TESTIMONIAL_EMAILS.has(e) && !INTERNAL_ONGOING.has(e));
  const teamInAudience = audience.filter((e) => team.has(e));

  if (preview) {
    return NextResponse.json({
      success: true,
      preview: true,
      month,
      audience: audience.length,
      proRate: PRO_MONTHLY_CREDITS,
      teamRate: TEAM_MONTHLY_CREDITS,
      teamMembers: teamInAudience.length,
      proMembers: audience.length - teamInAudience.length,
      excludedComp: excluded.length, // comp/testimonial NOT refilled (get one-time trial)
      sampleAudience: audience.slice(0, 12),
      sampleExcluded: excluded.slice(0, 12),
      internalIncluded: [...INTERNAL_ONGOING].filter((e) => audience.includes(e)),
    });
  }

  let granted = 0;
  let alreadyHad = 0;
  let creditsGranted = 0;
  const errors: string[] = [];
  for (const email of audience) {
    const amount = amountFor(email);
    try {
      const { applied } = await applyCreditOnce(`pro:${email}:${month}`, email, amount, 'pro_monthly');
      if (applied) { granted++; creditsGranted += amount; } else alreadyHad++;
    } catch (err) {
      errors.push(`${email}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return NextResponse.json({
    success: true,
    month,
    audience: audience.length,
    granted, // newly credited this run
    alreadyHad, // idempotent skips (already had this month's allowance)
    creditsGranted,
    proRate: PRO_MONTHLY_CREDITS,
    teamRate: TEAM_MONTHLY_CREDITS,
    teamMembers: teamInAudience.length,
    excludedComp: excluded.length,
    errors: errors.slice(0, 20),
  });
}
