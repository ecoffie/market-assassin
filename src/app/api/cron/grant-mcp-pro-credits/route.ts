/**
 * /api/cron/grant-mcp-pro-credits — monthly MCP-credit grant for PAYING subscribers + comp.
 *
 * GOS Decision #019 (2026-07-20): recurring credits require a recurring payment.
 *   • Active Pro sub ($149/mo)   → PRO_MONTHLY_CREDITS  (250)
 *   • Active Team sub ($499/mo)  → TEAM_MONTHLY_CREDITS  (750)
 *   • Internal team (comp)       → INTERNAL_MONTHLY_CREDITS (25,000)
 *   • Advocates (comp)           → PRO_MONTHLY_CREDITS (250)
 *
 * ⚠️ The subscriber audience is enumerated from ACTIVE Stripe subscriptions (classified by
 * price amount), NOT the KV `briefings:*` access gate — 716 have access but only ~49 pay, so
 * keying off access is exactly what caused the 2026-07-15 accident. Lifetime/founders are NOT
 * here (they get a ONE-TIME 200 via scripts/grant-member-mcp-credits.ts, not a monthly grant).
 * Idempotent per month via applyCreditOnce(key='pro:<email>:<YYYY-MM>').
 *
 * RUNS DAILY, not just on the 1st. On the 1st it is the scheduled monthly grant;
 * every other day it is a SELF-HEAL pass that costs nothing when healthy (the
 * idempotency key makes it a no-op) and catches anyone the purchase-time grant
 * missed. Before both existed, the monthly-only cadence meant a subscriber who
 * paid on the 2nd waited ~30 days — 9 of 26 paying Pro subs sat at zero credits
 * on 2026-07-30 for exactly that reason. A mid-cycle heal fires a Slack alert,
 * because a heal means the purchase path missed someone.
 */
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { applyCreditOnce } from '@/lib/mcp/credits';
import { PRO_MONTHLY_CREDITS, TEAM_MONTHLY_CREDITS, INTERNAL_MONTHLY_CREDITS } from '@/lib/mcp/packages';
import { INTERNAL_TEAM_EMAILS } from '@/lib/api-auth';
import { ADVOCATE_ACCOUNTS } from '@/lib/mindy/advocate-accounts';
import { sendOpsAlert } from '@/lib/ops-alert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// App-tier subscription price amounts (cents). MCP subs ($99/$249/$999) are NOT here — they
// get MCP credits via the MCP subscription webhook, not this grant.
const PRO_AMOUNTS = new Set([14900, 149000, 4900]);   // Pro $149/mo · $1,490/yr · $49 grandfathered
const TEAM_AMOUNTS = new Set([49900, 499000]);         // Team $499/mo · $4,990/yr

const INTERNAL_TEAM = Array.from(new Set(
  [...INTERNAL_TEAM_EMAILS, 'branden@govcongiants.com', 'eric@govcongiants.com'].map((e) => e.toLowerCase().trim()),
));
const ADVOCATES = Array.from(new Set(ADVOCATE_ACCOUNTS.map((a) => a.email.toLowerCase().trim())))
  .filter((e) => !INTERNAL_TEAM.includes(e));

type Group = 'internal' | 'advocate' | 'pro-sub' | 'team-sub';

type Target = { email: string; amount: number; group: Group };

/** Enumerate ACTIVE Stripe subscriptions → paying Pro/Team subscribers. Surfaces (never swallows)
 *  a Stripe failure so a monthly run that couldn't read subs is flagged, not silently a no-op. */
async function activeSubscribers(): Promise<{ subs: Target[]; error: string | null }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { subs: [], error: 'STRIPE_SECRET_KEY missing' };
  const stripe = new Stripe(key);
  const subs: Target[] = [];
  try {
    for await (const s of stripe.subscriptions.list({ status: 'active', limit: 100, expand: ['data.customer'] })) {
      const amt = s.items.data[0]?.price?.unit_amount ?? 0;
      const cust = s.customer;
      const email = (cust && typeof cust !== 'string' && !cust.deleted ? cust.email : null)?.toLowerCase();
      if (!email) continue;
      if (PRO_AMOUNTS.has(amt)) subs.push({ email, amount: PRO_MONTHLY_CREDITS, group: 'pro-sub' });
      else if (TEAM_AMOUNTS.has(amt)) subs.push({ email, amount: TEAM_MONTHLY_CREDITS, group: 'team-sub' });
    }
  } catch (e) {
    return { subs, error: (e as Error).message || 'stripe subscription enumeration failed' };
  }
  return { subs, error: null };
}

/** Resolve final per-email targets (dedupe; keep the highest amount when an email matches twice). */
async function buildTargets(): Promise<{ targets: Target[]; subError: string | null }> {
  const byEmail = new Map<string, Target>();
  const consider = (email: string, amount: number, group: Group) => {
    const e = email.toLowerCase().trim();
    const prev = byEmail.get(e);
    if (!prev || amount > prev.amount) byEmail.set(e, { email: e, amount, group });
  };
  for (const email of INTERNAL_TEAM) consider(email, INTERNAL_MONTHLY_CREDITS, 'internal');
  for (const email of ADVOCATES) consider(email, PRO_MONTHLY_CREDITS, 'advocate');
  const { subs, error } = await activeSubscribers();
  for (const s of subs) consider(s.email, s.amount, s.group);
  return { targets: [...byEmail.values()], subError: error };
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const hasSecret = request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  const isAdmin = request.nextUrl.searchParams.get('password') === process.env.ADMIN_PASSWORD;
  if (!isVercelCron && !hasSecret && !isAdmin) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const preview = request.nextUrl.searchParams.get('preview') === '1';
  const now = new Date();
  const month = now.toISOString().slice(0, 7); // YYYY-MM
  // On the 1st this is the scheduled monthly grant (everyone is expected to be
  // granted). On any other day it is the DAILY SELF-HEAL pass: idempotent by the
  // same pro:<email>:<YYYY-MM> key, so it grants only whoever upstream missed.
  const isMonthStart = now.getUTCDate() === 1;
  const { targets, subError } = await buildTargets();
  const byGroup = targets.reduce<Record<string, number>>((a, t) => { a[t.group] = (a[t.group] || 0) + 1; return a; }, {});

  if (preview) {
    return NextResponse.json({
      success: true, preview: true, month, audience: targets.length, byGroup, subError,
      rates: { pro: PRO_MONTHLY_CREDITS, team: TEAM_MONTHLY_CREDITS, internal: INTERNAL_MONTHLY_CREDITS },
      targets: targets.map((t) => ({ email: t.email, amount: t.amount, group: t.group })),
    });
  }

  let granted = 0, alreadyHad = 0;
  const errors: string[] = [];
  const healed: string[] = [];
  for (const { email, amount, group } of targets) {
    if (amount <= 0) continue;
    try {
      const { applied } = await applyCreditOnce(`pro:${email}:${month}`, email, amount, 'pro_monthly');
      if (applied) {
        granted++;
        // SELF-HEAL SIGNAL: on the 1st-of-month run every paying sub is expected to
        // be granted. On any OTHER day, a paying sub that still needed a grant means
        // something upstream missed them — the purchase webhook didn't fire, or they
        // subscribed mid-cycle before that path existed. Worth naming, not just
        // counting: this is the case that left 9 paying subs at zero in Jul 2026.
        if (!isMonthStart && (group === 'pro-sub' || group === 'team-sub')) healed.push(email);
      } else alreadyHad++;
    } catch (err) {
      errors.push(`${email}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Awareness: a run that couldn't grant correctly must fail LOUD (record 'error' + alert),
  // not report success with 0 grants. The internal team is a static list, so the audience can
  // never legitimately be below it — a smaller audience means the sub enumeration broke.
  // `nothingHappened` only means a broken run on the monthly pass. On a daily
  // self-heal run granting 0 is the HEALTHY case (everyone already has credits) —
  // alerting on it would page every single day.
  const nothingHappened = isMonthStart && granted === 0 && alreadyHad === 0;
  const tooSmall = targets.length < INTERNAL_TEAM.length;
  const anomaly = Boolean(subError) || errors.length > 0 || nothingHappened || tooSmall;

  const summary = {
    month, audience: targets.length, byGroup, granted, alreadyHad, subError,
    errors: errors.slice(0, 10),
    mode: isMonthStart ? 'monthly-grant' : 'daily-self-heal',
    healed: healed.slice(0, 20),
    healedCount: healed.length,
  };

  // A HEAL IS A SIGNAL, NOT A SUCCESS. A paying subscriber needing a mid-cycle
  // grant means the purchase-time path missed them. The credits are now fixed, so
  // this is not an anomaly (no 500) — but it must be visible, or the same silent
  // gap that left 9 paying subs at zero simply repairs itself invisibly forever.
  // Slack, not email, per the ops-alert rule.
  if (healed.length > 0) {
    await sendOpsAlert({
      subject: `MCP credits self-healed for ${healed.length} paying subscriber(s)`,
      html: `<p>The daily self-heal pass granted credits to paying subscribers who should already have had them — the purchase-time grant likely missed them.</p>`
        + `<p><b>Healed:</b> ${healed.join(', ')}</p>`
        + `<p>Credits are now correct. Worth checking why the Stripe invoice.paid path did not fire.</p>`
        + `<pre>${JSON.stringify(summary, null, 2)}</pre>`,
    }).catch((e) => console.error('[mcp-grant] heal alert failed:', (e as Error).message));
  }
  if (anomaly) {
    // Ops alert → Slack (was email; internal health alerts were burying the inbox).
    await sendOpsAlert({
      subject: `MCP credit grant ANOMALY — ${month}`,
      html: `<p>The MCP credit grant ran but looks wrong — check it did not silently skip paying subscribers.</p>`
        + `<pre>${JSON.stringify(summary, null, 2)}</pre>`,
    }).catch(() => { /* alert is best-effort; the 500 below is the durable signal */ });
    // Non-2xx → the dispatcher records status='error' in cron_job_runs, and the dispatcher-watchdog
    // surfaces it. This is the "we are aware" hook, on top of the mcp_credit_ledger grant rows.
    return NextResponse.json({ success: false, anomaly: true, ...summary }, { status: 500 });
  }

  return NextResponse.json({ success: true, ...summary });
}
