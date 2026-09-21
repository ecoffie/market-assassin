import { NextRequest, NextResponse } from 'next/server';
import { recordUserFeedback } from '@/lib/intelligence/metrics';

/**
 * POST /api/feedback
 *
 * Record user feedback from email links or dashboard.
 *
 * Body:
 *   - email: User email
 *   - type: 'helpful' | 'not_helpful' | 'wrong_match' | 'spam' | 'feature_request'
 *   - intelligenceType: 'daily_alert' | 'weekly_alert' | 'briefing' (optional)
 *   - opportunityId: Specific opportunity ID (optional)
 *   - rating: 1-5 (optional)
 *   - comment: Freeform text (optional)
 *
 * Query params (for email link clicks):
 *   - email: User email
 *   - type: Feedback type
 *   - opp: Opportunity ID (optional)
 *   - source: Where feedback came from (optional)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.email || !body.type) {
      return NextResponse.json(
        { success: false, error: 'email and type are required' },
        { status: 400 }
      );
    }

    const validTypes = ['helpful', 'not_helpful', 'wrong_match', 'spam', 'feature_request'];
    if (!validTypes.includes(body.type)) {
      return NextResponse.json(
        { success: false, error: `Invalid type. Use one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    await recordUserFeedback({
      userEmail: body.email,
      feedbackType: body.type,
      intelligenceType: body.intelligenceType,
      opportunityId: body.opportunityId,
      rating: body.rating,
      comment: body.comment,
      source: body.source || 'dashboard',
    });

    return NextResponse.json({
      success: true,
      message: 'Thank you for your feedback!',
    });
  } catch (error) {
    console.error('[Feedback] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to record feedback' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/feedback
 *
 * Handle email link clicks for quick feedback.
 * Redirects to thank you page after recording.
 *
 * Query params:
 *   - email: User email (required)
 *   - type: Feedback type (required)
 *   - opp: Opportunity ID (optional)
 *   - source: 'email' (default)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const email = searchParams.get('email');
  const type = searchParams.get('type') as any;
  const opportunityId = searchParams.get('opp');
  const intelligenceType = searchParams.get('intel');

  if (!email || !type) {
    return NextResponse.redirect(new URL('/feedback/error', request.url));
  }

  const validTypes = ['helpful', 'not_helpful', 'wrong_match', 'spam', 'feature_request'];
  if (!validTypes.includes(type)) {
    return NextResponse.redirect(new URL('/feedback/error', request.url));
  }

  try {
    await recordUserFeedback({
      userEmail: email,
      feedbackType: type,
      intelligenceType: intelligenceType || undefined,
      opportunityId: opportunityId || undefined,
      source: 'email',
    });

    // Redirect to thank you page
    const thankYouUrl = new URL('/feedback/thanks', request.url);
    thankYouUrl.searchParams.set('type', type);
    return NextResponse.redirect(thankYouUrl);
  } catch (error) {
    console.error('[Feedback] GET Error:', error);
    return NextResponse.redirect(new URL('/feedback/error', request.url));
  }
}
