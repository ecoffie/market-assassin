import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/opportunities/search
 *
 * Quick opportunity search for the /start page instant gratification.
 * Returns a simplified list of matching opportunities from SAM.gov.
 */

// SAM.gov API base URL
const SAM_API_BASE = 'https://api.sam.gov/opportunities/v2';

interface SimpleOpportunity {
  noticeId: string;
  title: string;
  agency: string;
  postedDate: string;
  responseDeadline: string;
  setAside?: string;
  naicsCode?: string;
}

// Convert ISO date (YYYY-MM-DD) to SAM.gov format (MM/dd/yyyy)
function toSAMDateFormat(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

// Get date N days ago in SAM.gov format
function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toSAMDateFormat(date);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const naics = searchParams.get('naics');
  const state = searchParams.get('state');
  const limitParam = searchParams.get('limit');
  const limit = Math.min(parseInt(limitParam || '5', 10), 25);

  if (!naics) {
    return NextResponse.json(
      { success: false, error: 'NAICS code is required' },
      { status: 400 }
    );
  }

  const apiKey = process.env.SAM_API_KEY;
  if (!apiKey) {
    console.error('[Opportunities Search] SAM_API_KEY not configured');
    return NextResponse.json(
      { success: false, error: 'API not configured' },
      { status: 500 }
    );
  }

  try {
    // Build SAM.gov API query
    const queryParams = new URLSearchParams({
      api_key: apiKey,
      ncode: naics,
      limit: String(limit),
      postedFrom: getDateDaysAgo(30), // Last 30 days
      postedTo: toSAMDateFormat(new Date()),
      ptype: 'o,k', // Solicitations and Combined Synopsis/Solicitation
    });

    // Add state filter if provided
    if (state) {
      queryParams.set('state', state);
    }

    const url = `${SAM_API_BASE}/search?${queryParams.toString()}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000), // 15 second timeout for quick response
    });

    if (!response.ok) {
      console.error(`[Opportunities Search] SAM.gov error: ${response.status}`);
      return NextResponse.json({
        success: true,
        opportunities: [],
        message: 'No opportunities found at this time',
      });
    }

    const data = await response.json();
    const rawOpportunities = data.opportunitiesData || [];

    // Parse and simplify opportunities
    const opportunities: SimpleOpportunity[] = rawOpportunities
      .slice(0, limit)
      .map((opp: any) => ({
        noticeId: opp.noticeId || '',
        title: opp.title || 'Untitled Opportunity',
        agency: opp.department?.name || opp.fullParentPathName?.split('.')[0] || 'Federal Agency',
        postedDate: opp.postedDate || '',
        responseDeadline: opp.responseDeadLine || opp.responseDeadline || '',
        setAside: opp.typeOfSetAsideDescription || opp.typeOfSetAside || undefined,
        naicsCode: opp.naicsCode || naics,
      }))
      .filter((opp: SimpleOpportunity) => opp.noticeId && opp.title);

    console.log(`[Opportunities Search] Found ${opportunities.length} opportunities for NAICS ${naics}${state ? ` in ${state}` : ''}`);

    return NextResponse.json({
      success: true,
      opportunities,
      total: data.totalRecords || opportunities.length,
      naics,
      state: state || null,
    });
  } catch (error) {
    console.error('[Opportunities Search] Error:', error);
    return NextResponse.json({
      success: true,
      opportunities: [],
      message: 'Could not fetch opportunities at this time',
    });
  }
}
