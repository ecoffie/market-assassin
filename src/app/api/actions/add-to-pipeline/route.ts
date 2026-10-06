/**
 * Email Action: Add to Pipeline
 *
 * The email link (GET) opens a confirmation page; it never saves. See GET below.
 * POST (JSON, authenticated) is the in-app programmatic save; PATCH updates next actions.
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

/**
 * GET / HEAD / OPTIONS NEVER WRITE (2026-10-06, the link-scanner defect).
 *
 * This URL is in every daily alert. Mail security scanners fetch it on delivery, and when GET
 * saved, they created pipeline rows nobody chose (83% of email saves in 30 days landed within
 * 2 minutes of the send). The link now only forwards to the confirmation page, which is itself
 * read-only; the save happens solely on that page's explicit button POST
 * (/api/actions/add-to-pipeline/confirm). No database access happens here at all.
 *
 * The full query string is forwarded unchanged, so links already sitting in inboxes keep working.
 */
function toConfirmationPage(request: NextRequest) {
  const target = new URL('/pipeline/confirm', request.url);
  target.search = request.nextUrl.search;
  const res = NextResponse.redirect(target, 303);
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}

export async function GET(request: NextRequest) {
  return toConfirmationPage(request);
}

export async function HEAD(request: NextRequest) {
  return toConfirmationPage(request);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { Allow: 'GET, HEAD, OPTIONS, POST, PATCH' } });
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
            agency: data.agency,
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
