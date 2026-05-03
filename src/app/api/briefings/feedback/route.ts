/**
 * Briefing Feedback API
 *
 * Records user feedback (helpful/not helpful) for briefings
 * GET endpoint for easy email link clicks
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

// Valid reasons for not_helpful feedback
const VALID_REASONS = [
  'wrong_industry',    // NAICS codes don't match my business
  'wrong_location',    // Opportunities are in wrong state/region
  'too_broad',         // Too many irrelevant opportunities
  'too_narrow',        // Not enough opportunities
  'irrelevant_agencies', // Wrong agencies for my targets
  'already_saw',       // Already saw these opportunities elsewhere
  'other',             // Other reason (use comment field)
];

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const email = searchParams.get('email');
  const date = searchParams.get('date');
  const type = searchParams.get('type'); // 'daily', 'weekly', 'pursuit'
  const rating = searchParams.get('rating'); // 'helpful', 'not_helpful'
  const reason = searchParams.get('reason'); // For not_helpful, optional in GET (collected on thanks page)

  if (!email || !date || !rating) {
    return NextResponse.redirect(new URL('/briefings/feedback/error', request.url));
  }

  try {
    // Record feedback - gracefully handle if table doesn't exist yet
    const feedbackData: Record<string, unknown> = {
      user_email: email.toLowerCase(),
      briefing_date: date,
      briefing_type: type || 'daily',
      rating: rating,
      created_at: new Date().toISOString(),
    };

    // Include reason if provided and valid
    if (reason && VALID_REASONS.includes(reason)) {
      feedbackData.reason = reason;
    }

    const { error } = await getSupabase()
      .from('briefing_feedback')
      .upsert(feedbackData, {
        onConflict: 'user_email,briefing_date,briefing_type',
      });

    if (error) {
      // Log but don't fail - still show thanks page
      console.error('Failed to record feedback (table may not exist):', error.message);
    }

    // For not_helpful without reason, redirect to thanks page to collect reason
    // For helpful or not_helpful with reason, go straight to thanks
    const redirectUrl = new URL('/briefings/feedback/thanks', request.url);
    redirectUrl.searchParams.set('rating', rating);
    if (rating === 'not_helpful' && !reason) {
      // Pass email/date/type so we can update the record with reason
      redirectUrl.searchParams.set('email', email);
      redirectUrl.searchParams.set('date', date);
      redirectUrl.searchParams.set('type', type || 'daily');
    }
    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    console.error('Feedback error:', err);
    // Still redirect to thanks to not frustrate user
    const redirectUrl = new URL('/briefings/feedback/thanks', request.url);
    redirectUrl.searchParams.set('rating', rating);
    return NextResponse.redirect(redirectUrl);
  }
}

// POST endpoint for programmatic feedback (including reason updates)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, date, type, rating, reason, comment } = body;

    if (!email || !date || !rating) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    // Validate reason if provided
    if (reason && !VALID_REASONS.includes(reason)) {
      return NextResponse.json({ success: false, error: 'Invalid reason' }, { status: 400 });
    }

    const feedbackData: Record<string, unknown> = {
      user_email: email.toLowerCase(),
      briefing_date: date,
      briefing_type: type || 'daily',
      rating: rating,
      created_at: new Date().toISOString(),
    };

    if (reason) {
      feedbackData.reason = reason;
    }
    if (comment) {
      feedbackData.comment = comment;
    }

    const { error } = await getSupabase()
      .from('briefing_feedback')
      .upsert(feedbackData, {
        onConflict: 'user_email,briefing_date,briefing_type',
      });

    if (error) {
      console.error('Failed to record feedback:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Feedback error:', err);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
