/**
 * Email Action: Mute Opportunity
 *
 * One-click action from email to hide an opportunity from future briefings.
 * Uses GET for email link compatibility.
 *
 * Usage in email:
 * <a href="https://tools.govcongiants.org/api/actions/mute-opportunity?email=user@example.com&notice_id=FA8773-24-R-0001&title=Navy%20IT%20Support">
 *   Not Interested
 * </a>
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
  const reason = params.get('reason') || 'not_interested';

  // Validate required fields
  if (!email || !title) {
    return NextResponse.redirect(
      new URL('/opportunity/mute/error?reason=missing_params', request.url)
    );
  }

  try {
    // Check if already muted
    let existingQuery = getSupabase()
      .from('user_muted_opportunities')
      .select('id')
      .eq('user_email', email.toLowerCase());

    if (notice_id) {
      existingQuery = existingQuery.eq('notice_id', notice_id);
    } else {
      existingQuery = existingQuery.eq('title', title);
    }

    const { data: existing } = await existingQuery.single();

    if (existing) {
      // Already muted - redirect to confirmation
      const redirectUrl = new URL('/opportunity/mute/already-muted', request.url);
      redirectUrl.searchParams.set('title', title);
      return NextResponse.redirect(redirectUrl);
    }

    // Add to muted list
    const { error } = await getSupabase()
      .from('user_muted_opportunities')
      .insert({
        user_email: email.toLowerCase(),
        notice_id: notice_id || null,
        title: decodeURIComponent(title),
        reason: reason,
        muted_at: new Date().toISOString(),
      });

    if (error) {
      console.error('Failed to mute opportunity:', error);
      return NextResponse.redirect(
        new URL('/opportunity/mute/error?reason=db_error', request.url)
      );
    }

    // Success - redirect to confirmation
    const redirectUrl = new URL('/opportunity/mute/success', request.url);
    redirectUrl.searchParams.set('title', title);
    return NextResponse.redirect(redirectUrl);

  } catch (err) {
    console.error('Mute opportunity error:', err);
    return NextResponse.redirect(
      new URL('/opportunity/mute/error?reason=unknown', request.url)
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
      reason = 'not_interested',
    } = body;

    if (!email || !title) {
      return NextResponse.json(
        { success: false, error: 'Email and title are required' },
        { status: 400 }
      );
    }

    // Check for existing
    let existingQuery = getSupabase()
      .from('user_muted_opportunities')
      .select('id')
      .eq('user_email', email.toLowerCase());

    if (notice_id) {
      existingQuery = existingQuery.eq('notice_id', notice_id);
    } else {
      existingQuery = existingQuery.eq('title', title);
    }

    const { data: existing } = await existingQuery.single();

    if (existing) {
      return NextResponse.json({
        success: false,
        error: 'Already muted',
        mutedId: existing.id,
      });
    }

    // Insert
    const { data, error } = await getSupabase()
      .from('user_muted_opportunities')
      .insert({
        user_email: email.toLowerCase(),
        notice_id: notice_id || null,
        title,
        reason,
        muted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Mute insert error:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      mutedId: data.id,
      message: `Muted "${title}" - won't appear in future briefings`,
    });

  } catch (err) {
    console.error('Mute opportunity error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 }
    );
  }
}
