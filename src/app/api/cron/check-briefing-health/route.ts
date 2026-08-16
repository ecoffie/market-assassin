import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { previewBriefingRollout } from '@/lib/briefings/delivery/rollout';
import { sendOpsAlert } from '@/lib/ops-alert';
import { findEntitlementGaps, formatEntitlementGap } from '@/lib/briefings/entitlement-gap';
import { findExpiringEntitlements, formatExpiryFindings, LAPSE_HORIZON_DAYS } from '@/lib/briefings/expiry-watch';
import { findUnonboardedPayers, formatUnonboarded } from '@/lib/onboarding/unonboarded-payers';

type HealthStatus = 'healthy' | 'warning' | 'critical';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function computeStatus(params: {
  deliveryRate: number;
  sentToday: number;
  failedToday: number;
  attemptedToday: number;
}): HealthStatus {
  if (params.attemptedToday > 0 && params.sentToday === 0) return 'critical';
  if (params.deliveryRate < 85) return 'critical';
  if (params.failedToday >= 25) return 'warning';
  if (params.deliveryRate < 95) return 'warning';
  return 'healthy';
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const shouldEmail = request.nextUrl.searchParams.get('email') === 'true';

  if (!isVercelCron && !hasCronSecret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({
        message: 'Briefing health monitor cron',
        usage: {
          manual: 'Triggered by Vercel cron or CRON_SECRET',
          email: 'Add ?email=true to send an alert when status is warning or critical',
        },
      });
    }
  }

  const supabase = getAdminClient();
  const today = new Date().toISOString().split('T')[0];
  const threeDaysAgo = new Date(Date.now() - (3 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

  const [{ data: metricsRows, error: metricsError }, { data: briefingRows, error: briefingError }] = await Promise.all([
    supabase
      .from('intelligence_metrics')
      .select('*')
      .eq('metric_type', 'briefings')
      .gte('date', threeDaysAgo)
      .order('date', { ascending: false }),
    supabase
      .from('briefing_log')
      .select('delivery_status, user_email')
      .eq('briefing_date', today),
  ]);

  if (metricsError || briefingError) {
    return NextResponse.json({
      success: false,
      error: metricsError?.message || briefingError?.message || 'Failed to fetch briefing health data',
    }, { status: 500 });
  }

  const todayMetric = (metricsRows || []).find(row => row.date === today);
  const attemptedToday = todayMetric?.emails_attempted || 0;
  const sentToday = todayMetric?.emails_sent || 0;
  const failedToday = todayMetric?.emails_failed || 0;
  const eligibleToday = todayMetric?.users_eligible || 0;
  const skippedToday = todayMetric?.users_skipped || 0;
  const deliveryRate = attemptedToday > 0 ? (sentToday / attemptedToday) * 100 : 100;

  const logSummary = (briefingRows || []).reduce(
    (acc, row) => {
      const status = row.delivery_status || 'unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const rollout = await previewBriefingRollout(supabase);

  // "Entitled but silent" — paying customers who CAN receive briefings and are
  // being skipped because the delivery preference is off. Invisible to every
  // other metric here: they never enter the audience, so they generate no
  // attempt, no failure, and no briefing_log row. Delivery rate stays 100%
  // while a $6,000 customer receives nothing.
  const gaps = await findEntitlementGaps(supabase).catch((e) => {
    console.error('[briefing-health] entitlement gap check failed:', (e as Error).message);
    return null;
  });

  const status = computeStatus({
    deliveryRate,
    sentToday,
    failedToday,
    attemptedToday,
  });

  const result = {
    success: true,
    status,
    checkedAt: new Date().toISOString(),
    metrics: {
      attemptedToday,
      sentToday,
      failedToday,
      eligibleToday,
      skippedToday,
      deliveryRate: Number(deliveryRate.toFixed(1)),
      latestMetricDate: todayMetric?.date || null,
    },
    briefingLog: {
      totalRowsToday: briefingRows?.length || 0,
      statuses: logSummary,
    },
    entitlementGaps: gaps
      ? {
          actionable: gaps.actionable.length,
          totalDiverged: gaps.totalDiverged,
          excludedOptedOut: gaps.optedOut,
          excludedUntargeted: gaps.untargeted,
          accounts: gaps.actionable.slice(0, 20),
        }
      : null,
    rollout: {
      mode: rollout.config.mode,
      selectedUsers: rollout.audienceSummary.selectedUsers,
      activeCohortId: rollout.activeCohort?.id || null,
      membersRemaining: rollout.cohortProgress?.membersRemaining || 0,
      readyToRotate: rollout.cohortProgress?.readyToRotate || false,
    },
  };

  // ALERT ON ITS OWN TRIGGER, not on `status`. computeStatus only sees delivery
  // rate and today's attempts — an entitled-but-silent customer never enters the
  // audience, so they never move any of those numbers. Gating this behind
  // status!=='healthy' would mean the alert fires only when something ELSE is
  // already broken, which is exactly how these accounts stayed invisible.
  // Also NOT gated on ?email=true: that flag is for the manual email digest;
  // this is an ops condition that should page whenever it is true.
  // Entitlements that will lapse BEFORE they cut anyone off. The entitlement-gap
  // check above reports damage already done; this one is the only part of the
  // system that looks forward. An expiry is knowable in advance — nobody should
  // learn about one from a customer, which is how the 2026-06-28 beta_preview
  // cohort died.
  const expiring = await findExpiringEntitlements(supabase).catch((e) => {
    console.error('[briefing-health] expiry watch failed:', e);
    return null;
  });
  if (expiring?.error) {
    console.error(`[briefing-health] EXPIRY WATCH READ FAILED (${expiring.error}) — cannot tell who is about to lapse`);
  }
  if (expiring && expiring.findings.length > 0) {
    const activeOnes = expiring.findings.filter((f) => f.active);
    const delivered = await sendOpsAlert({
      subject: `${expiring.findings.length} briefing entitlement(s) will lapse or are mis-stamped`,
      html:
        `<p>Looking ${LAPSE_HORIZON_DAYS} days ahead at <code>customer_classifications.briefings_expiry</code>.</p>`
        + `<p><b>${activeOnes.length} of ${expiring.findings.length} are ACTIVELY RECEIVING</b> — for those this is a scheduled silent cutoff.</p>`
        + `<pre>${formatExpiryFindings(expiring.findings)}</pre>`
        + `<p><b>lapsing</b> = a real time-boxed purchase reaching its end; decide renewal before the date.<br>`
        + `<b>has an expiry it should not have</b> = a grant or open-ended tier carrying a date. Clear the date `
        + `(set <code>briefings_expiry = NULL</code>) — a grant is revoked by changing the tier, never by a timestamp.</p>`,
    }).catch((e) => ({ ok: false, error: (e as Error).message }));
    if (!delivered.ok) {
      console.error(`[briefing-health] EXPIRY ALERT NOT DELIVERED (${delivered.error}) — ${formatExpiryFindings(expiring.findings)}`);
    }
  }

  // Paid, but never wired up to receive anything. The entitlement checks above
  // all assume a user_notification_settings row EXISTS; this catches the
  // customers who have no row at all and are therefore invisible to every one of
  // them — the blind spot behind those checks, not another instance of them.
  const stranded = await findUnonboardedPayers(supabase).catch((e) => {
    console.error('[briefing-health] unonboarded check failed:', e);
    return null;
  });
  if (stranded?.error) {
    console.error(`[briefing-health] UNONBOARDED READ FAILED (${stranded.error}) — cannot tell who is stranded`);
  }
  if (stranded && stranded.payers.length > 0) {
    const atRisk = stranded.payers.reduce((n, p) => n + p.paidCents, 0);
    const noRow = stranded.payers.filter((p) => !p.hasSettings).length;
    const delivered = await sendOpsAlert({
      subject: `${stranded.payers.length} paying customer(s) never onboarded — $${(atRisk / 100).toLocaleString()} receiving nothing`,
      html:
        `<p>These accounts paid and cannot receive anything. <b>${noRow}</b> have no `
        + `<code>user_notification_settings</code> row at all (invisible to every send path); the rest are `
        + `reachable but carry zero targeting, so any briefing would be generic.</p>`
        + `<p>The row is created in ONE place — the Stripe checkout webhook. The credit-grant cron is not that place, `
        + `so an account can collect MCP credits on schedule and look provisioned while receiving nothing.</p>`
        + `<pre>${formatUnonboarded(stranded.payers)}</pre>`
        + `<p><b>A settings row alone is not the fix</b> for anyone with zero targeting — that produces a generic `
        + `briefing, which is worse than silence for a paying customer. Those need a profile-setup prompt, not a grant.</p>`,
    }).catch((e) => ({ ok: false, error: (e as Error).message }));
    if (!delivered.ok) {
      console.error(`[briefing-health] UNONBOARDED ALERT NOT DELIVERED (${delivered.error}) — ${formatUnonboarded(stranded.payers)}`);
    }
  }

  if (gaps && gaps.actionable.length > 0) {
    const top = gaps.actionable[0];
    const atRisk = gaps.actionable.reduce((n, r) => n + r.paidCents, 0);
    const delivered = await sendOpsAlert({
      subject: `${gaps.actionable.length} paying customer(s) entitled to briefings but not receiving them`,
      html:
        `<p>These accounts hold <code>access_briefings=true</code> but <code>briefings_enabled=false</code>, `
        + `so the audience query skips them. They are paying, active, and have real targeting — they simply never get a briefing.</p>`
        + `<p><b>${gaps.actionable.length} account(s), $${(atRisk / 100).toLocaleString()} of purchases affected.</b> `
        + `Largest: ${top.email} ($${(top.paidCents / 100).toLocaleString()}).</p>`
        + `<pre>${formatEntitlementGap(gaps.actionable)}</pre>`
        + `<p>Excluded from the list: ${gaps.optedOut} opted out (is_active=false), `
        + `${gaps.untargeted} with no NAICS or keywords (a briefing would be generic).</p>`
        + (gaps.blockedOnEntitlement > 0
          ? `<p><b>${gaps.blockedOnEntitlement} of these are ALSO blocked by the classification gate</b> `
            + `(<code>customer_classifications.briefings_access</code>). For those, setting `
            + `<code>briefings_enabled=true</code> on its own delivers NOTHING — grant the classification `
            + `first, then flip the preference. Per-account instructions are in the list above.</p>`
            + (gaps.blockedOnEntitlement === gaps.actionable.length
              ? `<p><b>Every account listed is blocked on entitlement — a flag-only fix would be a complete no-op.</b></p>`
              : '')
          : `<p>Fix is one field: set <code>briefings_enabled=true</code> on their notification settings.</p>`),
    }).catch((e) => ({ ok: false, error: (e as Error).message }));
    // sendOpsAlert RESOLVES with ok:false on a Slack rejection — it does not
    // throw. Check the result, or a dropped alert looks like a delivered one.
    if (!delivered.ok) {
      console.error(`[briefing-health] ENTITLEMENT GAP ALERT NOT DELIVERED (${delivered.error}) — ${formatEntitlementGap(gaps.actionable)}`);
    }
  }

  const alertEmail = process.env.ADMIN_ALERT_EMAIL;
  if (shouldEmail && alertEmail && status !== 'healthy') {
    await sendOpsAlert({
      to: alertEmail,
      subject: `[${status.toUpperCase()}] Briefing Health Check`,
      html: `
        <h2>Briefing Health Check: ${status.toUpperCase()}</h2>
        <p><strong>Attempted:</strong> ${attemptedToday}</p>
        <p><strong>Sent:</strong> ${sentToday}</p>
        <p><strong>Failed:</strong> ${failedToday}</p>
        <p><strong>Delivery rate:</strong> ${deliveryRate.toFixed(1)}%</p>
        <p><strong>Active cohort:</strong> ${rollout.activeCohort?.id || 'none'}</p>
        <p><strong>Members remaining:</strong> ${rollout.cohortProgress?.membersRemaining || 0}</p>
      `,
    });
  }

  return NextResponse.json(result);
}
