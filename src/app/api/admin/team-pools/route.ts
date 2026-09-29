/**
 * /api/admin/team-pools — configure a subscription for pooled (multi-seat) credits.
 * PRD: tasks/PRD-pooled-team-credits.md.
 *
 * Team subscriptions are provisioned automatically at checkout / first invoice. This
 * endpoint is for everything else — a negotiated multi-seat deal on any plan (e.g. a
 * 2-seat Growth subscription) — and for re-affirming an existing org.
 *
 *   GET  ?password=…                         → every pool-eligible org (read-only)
 *   GET  ?password=…&subscriptionId=sub_…    → that subscription's pooled org, if any
 *   POST ?password=…  { subscriptionId, ownerEmail, planKey, seatLimit?, monthlyCredits?,
 *                       name?, dryRun? }      → provision (dryRun defaults to TRUE)
 *
 * Writes ONE org + owner membership + pool for ONE subscription. It never moves credits:
 * migrating a subscriber's existing Team credits is scripts/migrate-team-credits-to-pool.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  findPooledOrgBySubscription, listPooledOrgsBySubscription, provisionPooledOrg,
} from '@/lib/mcp/team-pools';
import { POOLED_PLAN_DEFAULTS } from '@/lib/mcp/packages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authed(req: NextRequest): boolean {
  return Boolean(process.env.ADMIN_PASSWORD) && req.nextUrl.searchParams.get('password') === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const sub = req.nextUrl.searchParams.get('subscriptionId');
    if (sub) {
      return NextResponse.json({ success: true, subscriptionId: sub, org: await findPooledOrgBySubscription(sub) });
    }
    const all = await listPooledOrgsBySubscription();
    return NextResponse.json({ success: true, defaults: POOLED_PLAN_DEFAULTS, pooledOrgs: [...all.values()] });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const subscriptionId = String(body.subscriptionId || '');
  const ownerEmail = String(body.ownerEmail || '');
  const planKey = String(body.planKey || '');
  const seatLimit = body.seatLimit === undefined ? undefined : Number(body.seatLimit);
  const monthlyCredits = body.monthlyCredits === undefined ? undefined : Number(body.monthlyCredits);
  const dryRun = body.dryRun !== false;
  if (!subscriptionId || !ownerEmail || !planKey) {
    return NextResponse.json({ success: false, error: 'subscriptionId, ownerEmail and planKey required' }, { status: 400 });
  }
  if (seatLimit !== undefined && (!Number.isInteger(seatLimit) || seatLimit < 2)) {
    return NextResponse.json({ success: false, error: 'seatLimit must be an integer >= 2 for a pooled subscription' }, { status: 400 });
  }
  if (monthlyCredits !== undefined && (!Number.isInteger(monthlyCredits) || monthlyCredits < 0)) {
    return NextResponse.json({ success: false, error: 'monthlyCredits must be a non-negative integer' }, { status: 400 });
  }
  const plan = POOLED_PLAN_DEFAULTS[planKey];
  const effective = {
    seatLimit: seatLimit ?? plan?.seats ?? null,
    monthlyCredits: monthlyCredits ?? plan?.monthlyCredits ?? null,
  };
  try {
    const existing = await findPooledOrgBySubscription(subscriptionId);
    if (dryRun) {
      return NextResponse.json({
        success: true, dryRun: true,
        wouldProvision: { subscriptionId, ownerEmail: ownerEmail.toLowerCase().trim(), planKey, ...effective },
        existing,
      });
    }
    const result = await provisionPooledOrg({
      subscriptionId, ownerEmail, planKey, seatLimit, monthlyCredits,
      name: typeof body.name === 'string' ? body.name : undefined,
    });
    return NextResponse.json({ success: true, dryRun: false, result });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
