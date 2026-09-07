import { after, NextRequest, NextResponse } from 'next/server';
import { WORKSPACE_PROTOTYPE_BANNER } from '@/lib/mrr/workspace-constants';
import {
  RequirementValidationError,
  normalizeRequirement,
} from '@/lib/mrr/normalizer';
import { createOrGetMrrJob, getMrrJob } from '@/lib/mrr/run-store-read';
import { requireMIAuthSession } from '@/lib/two-factor-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PROHIBITED_KEYS = new Set([
  'cui',
  'proprietary',
  'source_selection_information',
  'government_estimate',
  'ige',
  'attachments',
  'files',
]);

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function noticeIdFromUrl(value: unknown): string | undefined {
  const url = text(value);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)sam\.gov$/i.test(parsed.hostname)) return undefined;
    const match = parsed.pathname.match(/\/opp\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

export function parsePublicMrrIntake(body: Record<string, unknown>) {
  if (body.public_data_only_confirmed !== true) {
    throw new RequirementValidationError({
      public_data_only_confirmed:
        'Confirm that the intake contains public information only. Do not submit CUI, proprietary requirements, source-selection information, or government estimates.',
    });
  }
  const prohibited = Object.keys(body).find(
    (key) => PROHIBITED_KEYS.has(key) && body[key] !== undefined && body[key] !== null,
  );
  if (prohibited) {
    throw new RequirementValidationError({
      [prohibited]: `${prohibited} is not accepted by the public-data-only prototype`,
    });
  }

  const noticeId = text(body.notice_id) ?? noticeIdFromUrl(body.sam_url);
  const pop =
    text(body.pop_start) || text(body.pop_end)
      ? { start: text(body.pop_start), end: text(body.pop_end) }
      : undefined;
  return normalizeRequirement({
    title: body.title,
    agency: body.agency,
    sub_agency: body.sub_agency,
    office: body.office,
    description: body.description,
    naics: body.naics,
    psc: body.psc,
    keyword: body.keyword,
    est_value: body.est_value,
    pop,
    place_of_performance_state: body.place_of_performance_state,
    solicitation_number: body.solicitation_number,
    notice_id: noticeId,
  });
}

export async function POST(request: NextRequest) {
  const auth = requireMIAuthSession(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body', prototypeBanner: WORKSPACE_PROTOTYPE_BANNER },
      { status: 400 },
    );
  }

  try {
    const normalized = parsePublicMrrIntake(body);
    const { job, created } = createOrGetMrrJob({
      ownerEmail: auth.session.email!,
      input: body,
      normalizedRequirement: normalized.normalized,
    });
    if (created) {
      // Keep the run alive after the 202 returns. A detached void promise is
      // dropped when the request context ends; after() is the App Router hook
      // for exactly this "enqueue then continue" local-demo path.
      const ownerEmail = auth.session.email!;
      const runId = job.id;
      after(() =>
        import('@/lib/mrr/run-store').then(({ startMrrJob }) => startMrrJob(runId, ownerEmail)),
      );
    }
    return NextResponse.json(
      {
        success: true,
        deduplicated: !created,
        prototypeBanner: WORKSPACE_PROTOTYPE_BANNER,
        job,
      },
      { status: created ? 202 : 200 },
    );
  } catch (error) {
    if (error instanceof RequirementValidationError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          fieldErrors: error.fieldErrors,
          prototypeBanner: WORKSPACE_PROTOTYPE_BANNER,
        },
        { status: 400 },
      );
    }
    console.error('[mrr-workspace] Intake failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to start market research.',
        prototypeBanner: WORKSPACE_PROTOTYPE_BANNER,
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  const auth = requireMIAuthSession(request);
  if (!auth.ok) return auth.response;

  const id = request.nextUrl.searchParams.get('id')?.trim();
  if (!id) {
    return NextResponse.json(
      { success: false, error: 'run id is required', prototypeBanner: WORKSPACE_PROTOTYPE_BANNER },
      { status: 400 },
    );
  }
  const job = getMrrJob(id, auth.session.email!);
  if (!job) {
    return NextResponse.json(
      { success: false, error: 'Run not found', prototypeBanner: WORKSPACE_PROTOTYPE_BANNER },
      { status: 404 },
    );
  }
  return NextResponse.json({ success: true, prototypeBanner: WORKSPACE_PROTOTYPE_BANNER, job });
}
