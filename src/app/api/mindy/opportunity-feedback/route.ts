import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import {
  ensureWorkspaceMember,
  getMIBetaSupabase,
  normalizeEmail,
  recordMIBetaActivity,
} from '@/lib/mi-beta/workspace';
import { EventTypes, logEngagement } from '@/lib/engagement';

const FEEDBACK_LABELS: Record<string, string> = {
  good_match: 'Good match',
  bad_match: 'Bad match',
  not_my_industry: 'Not my industry',
  too_big_small: 'Too big/small',
  already_knew: 'Already knew about it',
  want_more_like_this: 'Want more like this',
};

const POSITIVE_TYPES = new Set(['good_match', 'want_more_like_this']);
const NEGATIVE_TYPES = new Set(['bad_match', 'not_my_industry', 'too_big_small']);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = normalizeEmail(String(body.email || ''));
    const opportunityId = String(body.opportunityId || '').trim();
    const feedbackType = String(body.feedbackType || '').trim();
    const title = String(body.title || '').trim();
    const source = String(body.source || 'mindy_app').trim();

    if (!email || !opportunityId || !FEEDBACK_LABELS[feedbackType]) {
      return NextResponse.json(
        { success: false, error: 'email, opportunityId, and a valid feedbackType are required' },
        { status: 400 }
      );
    }

    const authSession = requireMIAuthSession(request, email);
    if (!authSession.ok) return authSession.response;

    const { workspaceId } = await ensureWorkspaceMember(email);
    const isPositive = POSITIVE_TYPES.has(feedbackType)
      ? true
      : NEGATIVE_TYPES.has(feedbackType)
        ? false
        : null;

    const metadata = {
      title,
      source,
      agency: body.agency || null,
      url: body.url || null,
      recorded_at: new Date().toISOString(),
    };

    const { data, error } = await getMIBetaSupabase()
      .from('user_feedback')
      .insert({
        user_email: email,
        feedback_type: feedbackType,
        intelligence_type: source,
        opportunity_id: opportunityId,
        is_positive: isPositive,
        comment: JSON.stringify(metadata),
        feedback_source: 'mindy_app',
      })
      .select()
      .single();

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json(
          { success: false, error: 'Feedback table is missing. Run Supabase migrations first.' },
          { status: 500 }
        );
      }
      throw error;
    }

    await recordMIBetaActivity({
      workspaceId,
      userEmail: email,
      actorEmail: email,
      entityType: 'opportunity_feedback',
      entityId: opportunityId,
      action: feedbackType,
      summary: `${FEEDBACK_LABELS[feedbackType]}${title ? `: ${title}` : ''}`,
      metadata,
    });

    await logEngagement({
      userEmail: email,
      eventType: EventTypes.FEEDBACK,
      eventSource: source,
      metadata: {
        opportunity_id: opportunityId,
        feedback_type: feedbackType,
        is_positive: isPositive,
        title,
      },
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ success: true, feedback: data });
  } catch (error) {
    console.error('[mindy/opportunity-feedback] Failed to save feedback:', error);
    return NextResponse.json({ success: false, error: 'Failed to save feedback' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const email = normalizeEmail(String(request.nextUrl.searchParams.get('email') || ''));
    if (!email) {
      return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });
    }

    const authSession = requireMIAuthSession(request, email);
    if (!authSession.ok) return authSession.response;

    const { data, error } = await getMIBetaSupabase()
      .from('user_feedback')
      .select('opportunity_id,feedback_type,is_positive,created_at')
      .eq('user_email', email)
      .eq('feedback_source', 'mindy_app')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ success: true, feedback: {}, totals: {} });
      }
      throw error;
    }

    const feedback: Record<string, { latest: string; positive: number; negative: number; signals: string[] }> = {};
    const totals: Record<string, number> = {};

    for (const row of data || []) {
      const opportunityId = String(row.opportunity_id || '');
      const feedbackType = String(row.feedback_type || '');
      if (!opportunityId || !feedbackType) continue;

      totals[feedbackType] = (totals[feedbackType] || 0) + 1;
      feedback[opportunityId] ||= { latest: feedbackType, positive: 0, negative: 0, signals: [] };
      if (row.is_positive === true) feedback[opportunityId].positive += 1;
      if (row.is_positive === false) feedback[opportunityId].negative += 1;
      if (!feedback[opportunityId].signals.includes(feedbackType)) {
        feedback[opportunityId].signals.push(feedbackType);
      }
    }

    return NextResponse.json({ success: true, feedback, totals });
  } catch (error) {
    console.error('[mindy/opportunity-feedback] Failed to load feedback:', error);
    return NextResponse.json({ success: false, error: 'Failed to load feedback' }, { status: 500 });
  }
}
