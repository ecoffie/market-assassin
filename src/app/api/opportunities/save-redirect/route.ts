/**
 * GET /api/opportunities/save-redirect
 *
 * Email-friendly redirect handler for saving opportunities.
 * Since email links must be GET requests, this endpoint:
 * 1. Receives opportunity data via query params
 * 2. Saves the opportunity to user's watchlist
 * 3. Triggers Pursuit Brief generation
 * 4. Redirects to a confirmation page
 *
 * Query params:
 * - email: user email
 * - noticeId: SAM.gov notice ID
 * - data: URL-encoded JSON opportunity data
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabase() {
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const noticeId = request.nextUrl.searchParams.get('noticeId');
  const dataParam = request.nextUrl.searchParams.get('data');

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://tools.govcongiants.org';

  // Validate required params
  if (!email || !noticeId) {
    return NextResponse.redirect(
      `${baseUrl}/pursuit-brief/error?reason=missing_params`
    );
  }

  // Parse opportunity data
  let oppData: Record<string, unknown> = { noticeId };
  if (dataParam) {
    try {
      oppData = JSON.parse(decodeURIComponent(dataParam));
    } catch {
      // Use minimal data if parsing fails
      oppData = { noticeId, title: 'Unknown Opportunity' };
    }
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.redirect(
      `${baseUrl}/pursuit-brief/error?reason=db_error`
    );
  }

  try {
    // Check if user exists in notification settings
    const { data: userSettings } = await supabase
      .from('user_notification_settings')
      .select('user_email, briefings_enabled')
      .eq('user_email', email.toLowerCase())
      .single();

    if (!userSettings) {
      return NextResponse.redirect(
        `${baseUrl}/pursuit-brief/error?reason=user_not_found&email=${encodeURIComponent(email)}`
      );
    }

    // Save the opportunity (upsert to handle duplicates)
    const { data: savedOpp, error: saveError } = await supabase
      .from('user_saved_opportunities')
      .upsert({
        user_email: email.toLowerCase(),
        notice_id: noticeId,
        solicitation_number: oppData.solicitationNumber as string || null,
        opportunity_data: oppData,
        title: oppData.title as string || 'Unknown Opportunity',
        agency: oppData.department as string || oppData.agency as string || null,
        naics_code: oppData.naicsCode as string || oppData.naics_code as string || null,
        set_aside: oppData.setAside as string || oppData.set_aside as string || null,
        response_deadline: oppData.responseDeadline as string || oppData.response_deadline as string || null,
        posted_date: oppData.postedDate as string || oppData.posted_date as string || null,
        source: 'daily_alert',
        pursuit_brief_requested: true,
        status: 'watching',
      }, {
        onConflict: 'user_email,notice_id',
      })
      .select()
      .single();

    if (saveError) {
      console.error('[Save Redirect] Save error:', saveError);
      return NextResponse.redirect(
        `${baseUrl}/pursuit-brief/error?reason=save_failed`
      );
    }

    // Trigger Pursuit Brief generation (fire and forget)
    fetch(`${baseUrl}/api/opportunities/pursuit-brief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.toLowerCase(),
        savedOpportunityId: savedOpp?.id,
        noticeId,
        opportunityData: oppData,
      }),
    }).catch(err => {
      console.error('[Save Redirect] Failed to trigger pursuit brief:', err);
    });

    // Redirect to success page
    const title = encodeURIComponent((oppData.title as string || 'the opportunity').slice(0, 50));
    return NextResponse.redirect(
      `${baseUrl}/pursuit-brief/requested?email=${encodeURIComponent(email)}&title=${title}`
    );

  } catch (error) {
    console.error('[Save Redirect] Error:', error);
    return NextResponse.redirect(
      `${baseUrl}/pursuit-brief/error?reason=server_error`
    );
  }
}
