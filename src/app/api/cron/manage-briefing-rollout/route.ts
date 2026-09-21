import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  clearActiveBriefingCohort,
  getBriefingRolloutConfig,
  previewBriefingRollout,
} from '@/lib/briefings/delivery/rollout';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const force = request.nextUrl.searchParams.get('force') === 'true';

  if (!isVercelCron && !hasCronSecret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({
        message: 'Briefing rollout manager cron',
        usage: {
          manual: 'Triggered by Vercel cron or CRON_SECRET',
          force: 'GET ?force=true with CRON_SECRET to rotate even if guardrails are not met',
        },
        schedule: 'Recommended: once daily after briefing delivery',
      });
    }
  }

  const supabase = getAdminClient();
  const config = await getBriefingRolloutConfig();

  if (config.mode !== 'rollout') {
    const preview = await previewBriefingRollout(supabase);
    return NextResponse.json({
      success: true,
      action: 'noop',
      reason: 'Rollout automation is idle because mode is beta_all.',
      config,
      activeCohort: preview.activeCohort,
      cohortProgress: preview.cohortProgress,
    });
  }

  const before = await previewBriefingRollout(supabase);
  const hasActiveCohort = !!before.activeCohort;
  const canRotate = !!before.activeCohort && !!before.cohortProgress?.readyToRotate;

  if (hasActiveCohort && !canRotate && !force) {
    return NextResponse.json({
      success: true,
      action: 'kept-active-cohort',
      reason: 'Active cohort has not completed the required briefing program yet.',
      config,
      activeCohort: before.activeCohort,
      cohortProgress: before.cohortProgress,
    });
  }

  if (hasActiveCohort || force) {
    await clearActiveBriefingCohort();
  }

  const after = await previewBriefingRollout(supabase);

  return NextResponse.json({
    success: true,
    action: hasActiveCohort ? 'rotated-cohort' : 'created-cohort',
    forced: force,
    config,
    previousCohort: before.activeCohort,
    previousCohortProgress: before.cohortProgress,
    activeCohort: after.activeCohort,
    cohortProgress: after.cohortProgress,
    audienceSummary: after.audienceSummary,
  });
}
