/**
 * Email Action: Add to Pipeline
 *
 * One-click action from email to add opportunity to BD Assist pipeline.
 * Uses GET for email link compatibility.
 *
 * Usage in email:
 * <a href="https://mi.govcongiants.com/api/actions/add-to-pipeline?email=user@example.com&notice_id=FA8773-24-R-0001&title=Navy%20IT%20Support&stage=tracking">
 *   Track This
 * </a>
 */

import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { fetchPursuitDocsAuto } from '@/lib/grants/fetch-grant-docs';
import { isValidSamNoticeId } from '@/lib/sam/utils';
import { sanitizeValueEstimate } from '@/lib/pipeline/value-estimate';
import { lookupSamOpportunityForPipeline } from '@/lib/pipeline/sam-opportunity-lookup';

// Lazy initialization to avoid build-time errors
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // Required params
  const email = params.get('email');
  const title = params.get('title');

  // Optional params
  const notice_id = params.get('notice_id') || params.get('noticeId');
  const stage = params.get('stage') || 'tracking';
  const agency = params.get('agency');
  const value = params.get('value');
  const deadline = params.get('deadline');
  const naics = params.get('naics');
  const setAside = params.get('setAside') || params.get('set_aside');
  const source = params.get('source') || 'email_action';
  const externalUrl = params.get('url') || params.get('samLink');

  // Validate required fields
  if (!email || !title) {
    return NextResponse.redirect(
      new URL('/pipeline/error?reason=missing_params', request.url)
    );
  }

  // SECURITY: Verify user owns this email (via signed token or cookie)
  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated) {
    return NextResponse.redirect(
      new URL('/pipeline/error?reason=unauthorized', request.url)
    );
  }

  try {
    // Check if already in pipeline (by notice_id or title+email)
    let existingQuery = getSupabase()
      .from('user_pipeline')
      .select('id, stage')
      .eq('user_email', email.toLowerCase());

    if (notice_id) {
      existingQuery = existingQuery.eq('notice_id', notice_id);
    } else {
      existingQuery = existingQuery.eq('title', title);
    }

    const { data: existing } = await existingQuery.single() as { data: { id: string; stage: string } | null };

    if (existing) {
      // Already tracking - redirect to pipeline with message
      const redirectUrl = new URL('/pipeline/already-tracking', request.url);
      redirectUrl.searchParams.set('title', title);
      redirectUrl.searchParams.set('stage', existing.stage);
      return NextResponse.redirect(redirectUrl);
    }

    // Reject malformed notice_id values before persisting. React render
    // keys like 'deadline-140R6026Q0068' have been leaking in via email
    // action URLs, which then breaks downstream SAM lookups.
    let cleanNoticeId = notice_id && isValidSamNoticeId(notice_id)
      ? notice_id
      : (notice_id ? (console.warn(`[add-to-pipeline GET] dropping malformed notice_id "${notice_id}" for "${title}"`), null) : null);
    const samMatch = await lookupSamOpportunityForPipeline(getSupabase(), {
      noticeId: cleanNoticeId,
      title: decodeURIComponent(title),
      agency: agency ? decodeURIComponent(agency) : null,
    });
    // Prefer the canonical SAM UUID over a solicitation number — the attachment
    // fetcher needs the UUID. Resolve whenever the current value isn't a UUID.
    const isUuid = (v?: string | null) => !!v && /^[a-f0-9]{32}$/i.test(v.trim());
    if (samMatch?.noticeId && isUuid(samMatch.noticeId) && !isUuid(cleanNoticeId)) {
      cleanNoticeId = samMatch.noticeId;
    }

    // Add to pipeline
    const pipelineEntry = {
      user_email: email.toLowerCase(),
      notice_id: cleanNoticeId,
      title: decodeURIComponent(title),
      agency: agency ? decodeURIComponent(agency) : null,
      // Sanitize value_estimate — reject display labels like "Due in
      // 6 days" or "Open market research window..." that leaked from
      // briefing UIs (audit 2026-05-26).
      value_estimate: sanitizeValueEstimate(value ? decodeURIComponent(value) : null),
      response_deadline: deadline || samMatch?.responseDeadline || null,
      naics_code: naics || null,
      set_aside: setAside ? decodeURIComponent(setAside) : null,
      stage: stage as 'tracking' | 'pursuing' | 'bidding' | 'submitted',
      source: source,
      external_url: externalUrl ? decodeURIComponent(externalUrl) : null,
      priority: 'medium',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: insertedRow, error } = await getSupabase()
      .from('user_pipeline')
      .insert(pipelineEntry)
      .select()
      .single();

    if (error) {
      console.error('Failed to add to pipeline:', error);
      return NextResponse.redirect(
        new URL('/pipeline/error?reason=db_error', request.url)
      );
    }

    // Background task via Next.js after() — keeps lambda alive past
    // the redirect so pdf-parse can finish initializing without being
    // killed mid-extraction (see commit 2026-05-26).
    if (insertedRow?.notice_id && insertedRow?.id) {
      after(async () => {
        try {
          await fetchPursuitDocsAuto({
            pipelineId: insertedRow.id,
            userEmail: email,
            noticeId: insertedRow.notice_id,
            source: insertedRow.source ?? source,
            title: insertedRow.title,
          });
        } catch (err) {
          console.warn('[add-to-pipeline GET] background doc fetch threw:', err);
        }
      });
    }

    // Success - redirect to confirmation
    const redirectUrl = new URL('/pipeline/added', request.url);
    redirectUrl.searchParams.set('title', title);
    redirectUrl.searchParams.set('stage', stage);
    return NextResponse.redirect(redirectUrl);

  } catch (err) {
    console.error('Add to pipeline error:', err);
    return NextResponse.redirect(
      new URL('/pipeline/error?reason=unknown', request.url)
    );
  }
}

// POST endpoint for programmatic use
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      email,
      notice_id,
      title,
      agency,
      value,
      deadline,
      naics,
      setAside,
      stage = 'tracking',
      source = 'api',
      externalUrl
    } = body;

    if (!email || !title) {
      return NextResponse.json(
        { success: false, error: 'Email and title are required' },
        { status: 400 }
      );
    }

    // SECURITY: Verify user owns this email
    const auth = await verifyUserOwnsEmail(request, email);
    if (!auth.authenticated) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check for existing
    let existingQuery = getSupabase()
      .from('user_pipeline')
      .select('id, stage')
      .eq('user_email', email.toLowerCase());

    if (notice_id) {
      existingQuery = existingQuery.eq('notice_id', notice_id);
    } else {
      existingQuery = existingQuery.eq('title', title);
    }

    const { data: existing } = await existingQuery.single() as { data: { id: string; stage: string } | null };

    if (existing) {
      return NextResponse.json({
        success: false,
        error: 'Already in pipeline',
        existingStage: existing.stage,
        pipelineId: existing.id,
      });
    }

    // Same validation as the GET path — reject React-key garbage.
    let cleanNoticeIdPost = notice_id && isValidSamNoticeId(notice_id)
      ? notice_id
      : (notice_id ? (console.warn(`[add-to-pipeline POST] dropping malformed notice_id "${notice_id}" for "${title}"`), null) : null);
    const samMatch = await lookupSamOpportunityForPipeline(getSupabase(), {
      noticeId: cleanNoticeIdPost,
      title,
      agency,
    });
    if (!cleanNoticeIdPost && samMatch?.noticeId) {
      cleanNoticeIdPost = samMatch.noticeId;
    }

    // Insert
    const { data, error } = await getSupabase()
      .from('user_pipeline')
      .insert({
        user_email: email.toLowerCase(),
        notice_id: cleanNoticeIdPost,
        title,
        agency: agency || null,
        value_estimate: sanitizeValueEstimate(value),
        response_deadline: deadline || samMatch?.responseDeadline || null,
        naics_code: naics || null,
        set_aside: setAside || null,
        stage,
        source,
        external_url: externalUrl || null,
        priority: 'medium',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Pipeline insert error:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    // Background task via Next.js after() — same lifecycle fix as GET path.
    if (data?.notice_id && data?.id) {
      after(async () => {
        try {
          await fetchPursuitDocsAuto({
            pipelineId: data.id,
            userEmail: email.toLowerCase(),
            noticeId: data.notice_id,
            source: data.source,
            title: data.title,
          });
        } catch (err) {
          console.warn('[add-to-pipeline POST] background doc fetch threw:', err);
        }
      });
    }

    return NextResponse.json({
      success: true,
      pipelineId: data.id,
      stage,
      message: `Added "${title}" to pipeline`,
    });

  } catch (err) {
    console.error('Add to pipeline error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 }
    );
  }
}

// PATCH endpoint for lightweight next-action updates from the MI save prompt.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      email,
      pipelineId,
      nextAction,
      stage,
      notes,
    } = body;

    if (!email || !pipelineId || !nextAction) {
      return NextResponse.json(
        { success: false, error: 'email, pipelineId, and nextAction are required' },
        { status: 400 }
      );
    }

    // SECURITY: Verify user owns this email
    const auth = await verifyUserOwnsEmail(request, email);
    if (!auth.authenticated) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const updates: Record<string, string> = {
      next_action: nextAction,
      updated_at: new Date().toISOString(),
    };

    if (stage) {
      updates.stage = stage;
    }

    if (notes) {
      updates.notes = notes;
    }

    const { data, error } = await getSupabase()
      .from('user_pipeline')
      .update(updates)
      .eq('id', pipelineId)
      .eq('user_email', email.toLowerCase())
      .select('id, title, stage, next_action')
      .single();

    if (error) {
      console.error('Pipeline next-action update error:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      pipeline: data,
      message: 'Next action saved',
    });

  } catch (err) {
    console.error('Pipeline next-action error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 }
    );
  }
}
