import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  clearActiveBriefingCohort,
  getBriefingRolloutConfig,
  previewBriefingRollout,
  saveBriefingRolloutConfig,
} from '@/lib/briefings/delivery/rollout';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  return value === 'true';
}

function parseNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getAdminClient();
  const preview = await previewBriefingRollout(supabase);
  const config = await getBriefingRolloutConfig();

  return NextResponse.json({
    success: true,
    config,
    audienceSummary: preview.audienceSummary,
    activeCohort: preview.activeCohort,
    cohortProgress: preview.cohortProgress,
    recommendedNextCohort: preview.recommendedCohort.slice(0, 25).map(user => ({
      email: user.email,
      source: user.source,
      hasProfileData: user.hasProfileData,
      usesFallback: user.usesFallback,
    })),
    guidance: {
      safeRollout: 'POST ?password=xxx&mode=rollout&cohortSize=250&stickyDays=14&cooldownDays=21&maxFallbackPercent=15&requiredDailyBriefs=2&requiredWeeklyDeepDives=2&requiredPursuitBriefs=2',
      revertToBetaAll: 'POST ?password=xxx&mode=beta_all',
      rotateCohort: 'POST ?password=xxx&rotate=true',
      forceRotateCohort: 'POST ?password=xxx&rotate=true&force=true',
    },
  });
}

export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get('mode');
  const cohortSize = parseNumber(request.nextUrl.searchParams.get('cohortSize'));
  const stickyDays = parseNumber(request.nextUrl.searchParams.get('stickyDays'));
  const cooldownDays = parseNumber(request.nextUrl.searchParams.get('cooldownDays'));
  const maxFallbackPercent = parseNumber(request.nextUrl.searchParams.get('maxFallbackPercent'));
  const requiredDailyBriefs = parseNumber(request.nextUrl.searchParams.get('requiredDailyBriefs'));
  const requiredWeeklyDeepDives = parseNumber(request.nextUrl.searchParams.get('requiredWeeklyDeepDives'));
  const requiredPursuitBriefs = parseNumber(request.nextUrl.searchParams.get('requiredPursuitBriefs'));
  const includeSmartProfiles = parseBoolean(request.nextUrl.searchParams.get('includeSmartProfiles'));
  const rotate = request.nextUrl.searchParams.get('rotate') === 'true';
  const force = request.nextUrl.searchParams.get('force') === 'true';

  if (rotate && !force) {
    const supabase = getAdminClient();
    const preview = await previewBriefingRollout(supabase);
    if (preview.activeCohort && preview.cohortProgress && !preview.cohortProgress.readyToRotate) {
      return NextResponse.json({
        success: false,
        error: 'Active cohort has not completed the full briefing program twice yet.',
        activeCohort: preview.activeCohort,
        cohortProgress: preview.cohortProgress,
        guidance: 'Use force=true only if you intentionally want to override the completion guardrail.',
      }, { status: 409 });
    }
  }

  if (rotate) {
    await clearActiveBriefingCohort();
  }

  const config = await saveBriefingRolloutConfig({
    mode: mode === 'rollout' ? 'rollout' : mode === 'beta_all' ? 'beta_all' : undefined,
    cohortSize,
    stickyDays,
    cooldownDays,
    maxFallbackPercent,
    requiredDailyBriefs,
    requiredWeeklyDeepDives,
    requiredPursuitBriefs,
    includeSmartProfiles,
  });

  const supabase = getAdminClient();
  const preview = await previewBriefingRollout(supabase);

  return NextResponse.json({
    success: true,
    config,
    rotated: rotate,
    audienceSummary: preview.audienceSummary,
    activeCohort: preview.activeCohort,
    cohortProgress: preview.cohortProgress,
  });
}
