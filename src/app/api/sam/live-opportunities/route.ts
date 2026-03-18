import { NextRequest, NextResponse } from 'next/server';
import { CoreInputs } from '@/types/federal-market-assassin';

interface LiveOpportunity {
  id: string;
  title: string;
  agency: string;
  office: string;
  naics: string;
  setAside: string | null;
  setAsideDescription: string | null;
  postedDate: string;
  responseDeadline: string;
  daysUntilDeadline: number | null;
  noticeType: string;
  description: string;
  uiLink: string;
  urgency: 'urgent' | 'high' | 'medium' | 'low';
  source: 'sam.gov';
}

// Map business type to SAM.gov set-aside code
const businessTypeToSetAside: Record<string, string> = {
  'SDVOSB': 'SDVOSBC',
  'VOSB': 'VSB',
  '8a': '8A',
  '8(a)': '8A',
  'WOSB': 'WOSB',
  'EDWOSB': 'EDWOSB',
  'HUBZone': 'HZC',
  'SBA': 'SBA',
  'Small Business': 'SBP',
};

/**
 * Calculate days until deadline
 */
function getDaysUntilDeadline(deadline: string | null): number | null {
  if (!deadline) return null;
  try {
    const target = new Date(deadline);
    const today = new Date();
    const diff = target.getTime() - today.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

/**
 * Calculate urgency level based on deadline
 */
function getUrgency(daysUntil: number | null): 'urgent' | 'high' | 'medium' | 'low' {
  if (daysUntil === null) return 'low';
  if (daysUntil <= 3) return 'urgent';
  if (daysUntil <= 7) return 'high';
  if (daysUntil <= 14) return 'medium';
  return 'low';
}

/**
 * Format date for SAM.gov API (MM/dd/yyyy)
 */
function formatDateForSAM(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

/**
 * Get date N days ago
 */
function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatDateForSAM(date);
}

/**
 * Fetch LIVE opportunities from SAM.gov
 * Returns actual open solicitations with real deadlines
 */
export async function POST(request: NextRequest) {
  try {
    const body: CoreInputs = await request.json();
    const { businessType, naicsCode } = body;

    console.log('[SAM Live] Fetching live opportunities:', { naicsCode, businessType });

    const apiKey = process.env.SAM_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'SAM.gov API key not configured' },
        { status: 500 }
      );
    }

    // Build query parameters
    const queryParams = new URLSearchParams();
    queryParams.set('api_key', apiKey);
    queryParams.set('limit', '100');
    queryParams.set('postedFrom', getDateDaysAgo(90)); // Last 90 days
    queryParams.set('postedTo', formatDateForSAM(new Date()));

    // Only active opportunities (Solicitations and Combined Synopsis)
    queryParams.set('ptype', 'o,k'); // o=solicitation, k=combined synopsis/solicitation

    // Add NAICS filter
    if (naicsCode && naicsCode.trim()) {
      queryParams.set('ncode', naicsCode.trim());
    }

    // Add set-aside filter
    if (businessType && businessTypeToSetAside[businessType]) {
      queryParams.set('typeOfSetAside', businessTypeToSetAside[businessType]);
    }

    const url = `https://api.sam.gov/opportunities/v2/search?${queryParams.toString()}`;
    console.log('[SAM Live] Request URL:', url.replace(apiKey, '[REDACTED]'));

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SAM Live] API error:', response.status, errorText);
      return NextResponse.json(
        { success: false, error: `SAM.gov API error: ${response.status}` },
        { status: 500 }
      );
    }

    const data = await response.json();
    const rawOpportunities = data.opportunitiesData || [];

    console.log(`[SAM Live] Found ${rawOpportunities.length} raw opportunities`);

    // Transform to our format
    const opportunities: LiveOpportunity[] = rawOpportunities
      .map((opp: any) => {
        const deadline = opp.responseDeadLine || opp.responseDeadline || null;
        const daysUntil = getDaysUntilDeadline(deadline);

        return {
          id: opp.noticeId || '',
          title: opp.title || 'Untitled Opportunity',
          agency: opp.department?.name || opp.fullParentPathName?.split('.')[0] || 'Unknown Agency',
          office: opp.office?.name || opp.officeAddress?.city || '',
          naics: opp.naicsCode || '',
          setAside: opp.typeOfSetAside || null,
          setAsideDescription: opp.typeOfSetAsideDescription || null,
          postedDate: opp.postedDate || '',
          responseDeadline: deadline,
          daysUntilDeadline: daysUntil,
          noticeType: opp.type || opp.noticeType || '',
          description: opp.description || '',
          uiLink: opp.uiLink || `https://sam.gov/opp/${opp.noticeId}/view`,
          urgency: getUrgency(daysUntil),
          source: 'sam.gov' as const,
        };
      })
      // Filter out expired opportunities
      .filter((opp: LiveOpportunity) => opp.daysUntilDeadline === null || opp.daysUntilDeadline >= 0)
      // Sort by urgency (most urgent first)
      .sort((a: LiveOpportunity, b: LiveOpportunity) => {
        const urgencyOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        const urgencyDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
        if (urgencyDiff !== 0) return urgencyDiff;
        // Then by deadline (soonest first)
        if (a.daysUntilDeadline === null) return 1;
        if (b.daysUntilDeadline === null) return -1;
        return a.daysUntilDeadline - b.daysUntilDeadline;
      });

    // Calculate stats
    const urgentCount = opportunities.filter((o: LiveOpportunity) => o.urgency === 'urgent').length;
    const thisWeekCount = opportunities.filter((o: LiveOpportunity) =>
      o.daysUntilDeadline !== null && o.daysUntilDeadline <= 7
    ).length;
    const setAsideCount = opportunities.filter((o: LiveOpportunity) => o.setAside !== null).length;

    return NextResponse.json({
      success: true,
      opportunities: opportunities.slice(0, 50), // Return top 50
      stats: {
        total: opportunities.length,
        urgent: urgentCount,
        dueThisWeek: thisWeekCount,
        setAsides: setAsideCount,
      },
      metadata: {
        searchCriteria: {
          naicsCode,
          businessType,
          postedWithin: '90 days',
          types: 'Solicitations & Combined Synopsis',
        },
        fetchedAt: new Date().toISOString(),
        source: 'SAM.gov Opportunities API',
      },
    });

  } catch (error) {
    console.error('[SAM Live] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch live opportunities',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for checking API status
 */
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/sam/live-opportunities',
    description: 'Fetch live SAM.gov opportunities',
    method: 'POST',
    body: {
      naicsCode: 'string (e.g., "541511")',
      businessType: 'string (e.g., "SDVOSB", "8a", "Small Business")',
    },
    response: {
      opportunities: 'Array of live opportunities with deadlines',
      stats: { total: 'number', urgent: 'number', dueThisWeek: 'number' },
    },
  });
}
