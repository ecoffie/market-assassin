/**
 * POST /api/opportunities/save
 *
 * Save/favorite an opportunity and trigger Pursuit Brief generation.
 *
 * Body:
 * - email: user email
 * - noticeId: SAM.gov notice ID
 * - opportunityData: full opportunity object (optional, will fetch if not provided)
 * - source: 'daily_alert' | 'daily_brief' | 'manual' | 'opportunity_hunter'
 * - requestPursuitBrief: boolean (default true)
 *
 * Returns saved opportunity and optionally triggers pursuit brief generation.
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      email,
      noticeId,
      opportunityData,
      source = 'manual',
      requestPursuitBrief = true,
    } = body;

    if (!email || !noticeId) {
      return NextResponse.json(
        { error: 'Missing required fields: email and noticeId' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      );
    }

    // Check if user has alert settings (they should be backfilled)
    const { data: userSettings } = await supabase
      .from('user_notification_settings')
      .select('user_email, briefings_enabled')
      .eq('user_email', email.toLowerCase())
      .single();

    if (!userSettings) {
      return NextResponse.json(
        { error: 'User not found. Please set up your alert preferences first.' },
        { status: 404 }
      );
    }

    // If no opportunityData provided, we'd need to fetch from SAM.gov
    // For now, require it to be passed (comes from the email link)
    let oppData = opportunityData;
    if (!oppData) {
      // Minimal placeholder - in production would fetch from SAM.gov
      oppData = {
        noticeId,
        title: 'Unknown Opportunity',
        fetchedAt: new Date().toISOString(),
      };
    }

    // Save the opportunity
    const { data: savedOpp, error: saveError } = await supabase
      .from('user_saved_opportunities')
      .upsert({
        user_email: email.toLowerCase(),
        notice_id: noticeId,
        solicitation_number: oppData.solicitationNumber || oppData.solicitation_number,
        opportunity_data: oppData,
        title: oppData.title,
        agency: oppData.department || oppData.agency,
        naics_code: oppData.naicsCode || oppData.naics_code,
        set_aside: oppData.setAside || oppData.set_aside,
        response_deadline: oppData.responseDeadline || oppData.response_deadline,
        posted_date: oppData.postedDate || oppData.posted_date,
        estimated_value: oppData.estimatedValue || oppData.estimated_value,
        source,
        pursuit_brief_requested: requestPursuitBrief,
        status: 'watching',
      }, {
        onConflict: 'user_email,notice_id',
      })
      .select()
      .single();

    if (saveError) {
      console.error('[Save Opportunity] Error:', saveError);
      return NextResponse.json(
        { error: 'Failed to save opportunity', details: saveError.message },
        { status: 500 }
      );
    }

    // If pursuit brief requested, trigger async generation
    if (requestPursuitBrief) {
      // Fire and forget - call the pursuit brief endpoint
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://tools.govcongiants.org';
      fetch(`${baseUrl}/api/opportunities/pursuit-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.toLowerCase(),
          savedOpportunityId: savedOpp.id,
          noticeId,
          opportunityData: oppData,
        }),
      }).catch(err => {
        console.error('[Save Opportunity] Failed to trigger pursuit brief:', err);
      });
    }

    return NextResponse.json({
      success: true,
      savedOpportunity: savedOpp,
      pursuitBriefRequested: requestPursuitBrief,
      message: requestPursuitBrief
        ? 'Opportunity saved! Your Pursuit Brief will be emailed shortly.'
        : 'Opportunity saved to your watchlist.',
    });

  } catch (error) {
    console.error('[Save Opportunity] Error:', error);
    return NextResponse.json(
      { error: 'Server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/opportunities/save?email=xxx
 *
 * Get user's saved opportunities
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const { data: savedOpps, error } = await supabase
    .from('user_saved_opportunities')
    .select('*')
    .eq('user_email', email.toLowerCase())
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch saved opportunities' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    count: savedOpps?.length || 0,
    opportunities: savedOpps || [],
  });
}

/**
 * DELETE /api/opportunities/save
 *
 * Remove a saved opportunity
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, noticeId } = body;

    if (!email || !noticeId) {
      return NextResponse.json({ error: 'Missing email or noticeId' }, { status: 400 });
    }

    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { error } = await supabase
      .from('user_saved_opportunities')
      .delete()
      .eq('user_email', email.toLowerCase())
      .eq('notice_id', noticeId);

    if (error) {
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Opportunity removed from watchlist' });

  } catch (error) {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
