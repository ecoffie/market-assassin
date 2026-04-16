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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const email = searchParams.get('email');
  const date = searchParams.get('date');
  const type = searchParams.get('type'); // 'daily', 'weekly', 'pursuit'
  const rating = searchParams.get('rating'); // 'helpful', 'not_helpful'

  if (!email || !date || !rating) {
    return NextResponse.redirect(new URL('/briefings/feedback/error', request.url));
  }

  try {
    // Record feedback - gracefully handle if table doesn't exist yet
    const { error } = await getSupabase()
      .from('briefing_feedback')
      .upsert({
        user_email: email.toLowerCase(),
        briefing_date: date,
        briefing_type: type || 'daily',
        rating: rating,
        created_at: new Date().toISOString(),
      }, {
        onConflict: 'user_email,briefing_date,briefing_type',
      });

    if (error) {
      // Log but don't fail - still show thanks page
      console.error('Failed to record feedback (table may not exist):', error.message);
    }

    // Always redirect to thank you page
    const redirectUrl = new URL('/briefings/feedback/thanks', request.url);
    redirectUrl.searchParams.set('rating', rating);
    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    console.error('Feedback error:', err);
    // Still redirect to thanks to not frustrate user
    const redirectUrl = new URL('/briefings/feedback/thanks', request.url);
    redirectUrl.searchParams.set('rating', rating);
    return NextResponse.redirect(redirectUrl);
  }
}

// POST endpoint for programmatic feedback
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, date, type, rating, comment } = body;

    if (!email || !date || !rating) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const { error } = await getSupabase()
      .from('briefing_feedback')
      .upsert({
        user_email: email.toLowerCase(),
        briefing_date: date,
        briefing_type: type || 'daily',
        rating: rating,
        comment: comment || null,
        created_at: new Date().toISOString(),
      }, {
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
