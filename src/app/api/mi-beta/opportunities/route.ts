/**
 * MI Beta - Opportunities API
 *
 * Fetches opportunities from SAM.gov cache for the unified MI platform.
 * Uses the same cache as daily alerts (24K+ records).
 *
 * Query params:
 * - email: User email to load their NAICS profile
 * - naics: Comma-separated NAICS codes (if not using email profile)
 * - limit: Max results (default 25)
 * - noticeType: Filter by notice type (solicitation, combined, sources_sought, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

interface SAMOpportunity {
  notice_id: string;
  title: string;
  solicitation_number?: string;
  naics_code?: string;
  classification_code?: string;
  department?: string;
  sub_tier?: string;
  office?: string;
  posted_date?: string;
  response_deadline?: string;
  set_aside?: string;
  set_aside_description?: string;
  notice_type?: string;
  active?: boolean;
  pop_state?: string;
  pop_city?: string;
  ui_link?: string;
  description?: string;
}

export async function GET(request: NextRequest) {
  if (!supabase) {
    return NextResponse.json({
      success: false,
      error: 'Database not configured',
    }, { status: 500 });
  }

  const { searchParams } = request.nextUrl;
  const email = searchParams.get('email');
  const naicsParam = searchParams.get('naics');
  const limit = parseInt(searchParams.get('limit') || '25', 10);
  const noticeType = searchParams.get('noticeType');

  // Get user's NAICS codes from their profile
  let naicsCodes: string[] = [];

  if (email) {
    const { data: profile } = await supabase
      .from('user_notification_settings')
      .select('naics_codes')
      .eq('user_email', email)
      .single();

    if (profile?.naics_codes?.length) {
      naicsCodes = profile.naics_codes;
    }
  }

  // Override with explicit NAICS if provided
  if (naicsParam) {
    naicsCodes = naicsParam.split(',').map(n => n.trim());
  }

  // Default NAICS if none specified
  if (naicsCodes.length === 0) {
    naicsCodes = ['541512', '541611', '541330', '541990', '561210'];
  }

  try {
    // Build query for opportunities from cache
    let query = supabase
      .from('sam_opportunities')
      .select('*')
      .eq('active', true)
      .gte('response_deadline', new Date().toISOString().split('T')[0])
      .order('response_deadline', { ascending: true })
      .limit(limit);

    // Filter by NAICS (using OR for any match)
    const naicsFilters = naicsCodes.map(code => `naics_code.like.${code}%`);
    query = query.or(naicsFilters.join(','));

    // Optional notice type filter
    if (noticeType) {
      query = query.ilike('notice_type', `%${noticeType}%`);
    }

    const { data: opportunities, error } = await query;

    if (error) {
      console.error('[MI Beta Opps] Query error:', error);
      return NextResponse.json({
        success: false,
        error: 'Failed to fetch opportunities',
      }, { status: 500 });
    }

    // Transform to consistent format
    const alerts = (opportunities || []).map((opp: SAMOpportunity) => {
      // Calculate days until deadline
      const deadline = opp.response_deadline ? new Date(opp.response_deadline) : null;
      const now = new Date();
      const daysLeft = deadline ? Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;

      return {
        id: opp.notice_id,
        title: opp.title,
        solicitationNumber: opp.solicitation_number,
        naicsCode: opp.naics_code,
        pscCode: opp.classification_code,
        department: opp.department,
        subTier: opp.sub_tier,
        office: opp.office,
        postedDate: opp.posted_date,
        responseDeadline: opp.response_deadline,
        setAside: opp.set_aside,
        setAsideDescription: opp.set_aside_description,
        noticeType: opp.notice_type,
        popState: opp.pop_state,
        popCity: opp.pop_city,
        url: opp.ui_link || `https://sam.gov/opp/${opp.notice_id}/view`,
        daysLeft,
        isUrgent: daysLeft !== null && daysLeft <= 7 && daysLeft >= 0,
        isClosingSoon: daysLeft !== null && daysLeft <= 14 && daysLeft > 7,
      };
    });

    return NextResponse.json({
      success: true,
      count: alerts.length,
      opportunities: alerts,
      searchCriteria: { naicsCodes, limit, noticeType },
    });

  } catch (error) {
    console.error('[MI Beta Opps] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to search opportunities',
    }, { status: 500 });
  }
}
