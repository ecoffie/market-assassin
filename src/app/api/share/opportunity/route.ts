/**
 * Share Opportunity API
 *
 * POST - Create a shareable link for an opportunity
 * GET - Retrieve shared opportunity data by shareId
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Generate 8-character alphanumeric share ID
function generateShareId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * POST /api/share/opportunity
 * Create a share link for an opportunity
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, companyName, opportunity } = body;

    if (!email || !opportunity?.id) {
      return NextResponse.json(
        { error: 'Email and opportunity.id are required' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check if this opportunity was already shared by this user
    const { data: existingShare } = await supabase
      .from('opportunity_shares')
      .select('share_id')
      .eq('sharer_email', email.toLowerCase())
      .eq('opportunity_id', opportunity.id)
      .maybeSingle();

    if (existingShare) {
      // Return existing share link
      const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://tools.govcongiants.org'}/shared/opp/${existingShare.share_id}`;
      return NextResponse.json({
        success: true,
        shareUrl,
        shareId: existingShare.share_id,
        existing: true,
      });
    }

    // Generate new share ID (with collision check)
    let shareId = generateShareId();
    let attempts = 0;
    while (attempts < 5) {
      const { data: collision } = await supabase
        .from('opportunity_shares')
        .select('share_id')
        .eq('share_id', shareId)
        .maybeSingle();

      if (!collision) break;
      shareId = generateShareId();
      attempts++;
    }

    // Get user's company name from profile if not provided
    let sharerCompany = companyName;
    if (!sharerCompany) {
      const { data: profile } = await supabase
        .from('user_notification_settings')
        .select('company_name')
        .ilike('user_email', email)
        .maybeSingle();

      sharerCompany = profile?.company_name || null;
    }

    // Create the share record
    const { error: insertError } = await supabase
      .from('opportunity_shares')
      .insert({
        share_id: shareId,
        sharer_email: email.toLowerCase(),
        sharer_company: sharerCompany,
        opportunity_id: opportunity.id,
        opportunity_title: opportunity.title,
        opportunity_data: {
          id: opportunity.id,
          title: opportunity.title,
          agency: opportunity.agency,
          department: opportunity.department,
          naics_code: opportunity.naics_code || opportunity.naics,
          psc_code: opportunity.psc_code || opportunity.psc,
          set_aside: opportunity.set_aside || opportunity.set_aside_description,
          notice_type: opportunity.notice_type || opportunity.type,
          response_deadline: opportunity.response_deadline || opportunity.deadline,
          posted_date: opportunity.posted_date,
          description: opportunity.description,
          ui_link: opportunity.ui_link || opportunity.link,
          value: opportunity.value || opportunity.award_amount,
        },
      });

    if (insertError) {
      console.error('[ShareOpportunity] Insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to create share link' },
        { status: 500 }
      );
    }

    const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://tools.govcongiants.org'}/shared/opp/${shareId}`;

    return NextResponse.json({
      success: true,
      shareUrl,
      shareId,
      existing: false,
    });

  } catch (error) {
    console.error('[ShareOpportunity] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/share/opportunity?shareId=xxx
 * Retrieve opportunity data for public page
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shareId = searchParams.get('shareId');

    if (!shareId) {
      return NextResponse.json(
        { error: 'shareId parameter is required' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get the share record
    const { data: share, error: fetchError } = await supabase
      .from('opportunity_shares')
      .select('*')
      .eq('share_id', shareId)
      .maybeSingle();

    if (fetchError || !share) {
      return NextResponse.json(
        { error: 'Share link not found', notFound: true },
        { status: 404 }
      );
    }

    // Increment view count
    await supabase
      .from('opportunity_shares')
      .update({
        view_count: (share.view_count || 0) + 1,
        last_viewed_at: new Date().toISOString(),
      })
      .eq('share_id', shareId);

    // Check if user opted out of attribution
    let sharedBy = share.sharer_company;
    if (!sharedBy) {
      sharedBy = 'a GovCon professional';
    }

    // Check if user opted out of showing their company name
    const { data: sharerProfile } = await supabase
      .from('user_notification_settings')
      .select('share_attribution')
      .ilike('user_email', share.sharer_email)
      .maybeSingle();

    if (sharerProfile?.share_attribution === false) {
      sharedBy = 'a GovCon professional';
    }

    // Check if opportunity is still active
    const opportunityData = share.opportunity_data || {};
    const responseDeadline = opportunityData.response_deadline;
    const isExpired = responseDeadline && new Date(responseDeadline) < new Date();

    return NextResponse.json({
      success: true,
      shareId: share.share_id,
      opportunity: {
        ...opportunityData,
        title: share.opportunity_title || opportunityData.title,
      },
      sharedBy,
      sharedAt: share.created_at,
      isExpired,
      viewCount: share.view_count + 1,
    });

  } catch (error) {
    console.error('[ShareOpportunity] GET Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
