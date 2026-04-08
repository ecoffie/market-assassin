import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { previewBriefingRollout } from '@/lib/briefings/delivery/rollout';
import { sendEmail } from '@/lib/send-email';

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
    rollout: {
      mode: rollout.config.mode,
      selectedUsers: rollout.audienceSummary.selectedUsers,
      activeCohortId: rollout.activeCohort?.id || null,
      membersRemaining: rollout.cohortProgress?.membersRemaining || 0,
      readyToRotate: rollout.cohortProgress?.readyToRotate || false,
    },
  };

  const alertEmail = process.env.ADMIN_ALERT_EMAIL;
  if (shouldEmail && alertEmail && status !== 'healthy') {
    await sendEmail({
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
