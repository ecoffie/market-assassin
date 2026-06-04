/**
 * Grants API - Wraps Grants.gov public API
 *
 * No API key required - $700B+ in annual federal funding
 *
 * Query params:
 * - keyword: Search term
 * - agency: Agency code (HHS, DOD, NSF, etc.)
 * - category: Funding category (HL=Health, ST=Science/Tech, ED=Education)
 * - status: posted | forecasted | closed
 * - limit: Max results (default 25)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { scoreGrant, type GrantOpportunity } from '@/lib/briefings/pipelines/grants-gov';

// Grants.gov REST API returns totalHits as array of opportunities
interface GrantsGovOpp {
  id: string;
  number: string;
  title: string;
  agencyCode?: string;
  agency?: string;
  openDate?: string;
  closeDate?: string;
  oppStatus?: string;
  docType?: string;
  cfdaList?: string[];
  synopsis?: string;
  description?: string;
  awardCeiling?: string | number;
}

// Load the user's profile (NAICS / keywords / agencies) for relevance scoring.
async function loadUserProfile(email: string) {
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data } = await sb
      .from('user_notification_settings')
      .select('naics_codes, keywords, agencies')
      .eq('user_email', email.toLowerCase())
      .maybeSingle();
    if (!data) return null;
    // business_description lives in user_business_profiles (separate table);
    // fetch it best-effort so scoreGrant can use description terms.
    let businessDescription: string | null = null;
    try {
      const { data: biz } = await sb
        .from('user_business_profiles')
        .select('business_description')
        .eq('user_email', email.toLowerCase())
        .maybeSingle();
      businessDescription = biz?.business_description || null;
    } catch { /* optional */ }
    return {
      naics_codes: data.naics_codes || [],
      keywords: data.keywords || [],
      agencies: data.agencies || [],
      business_description: businessDescription,
    };
  } catch {
    return null;
  }
}

// Grants.gov returns the page of opportunities in `oppHits` and the TRUE
// total match count in `hitCount` (e.g. 1209 posted). `totalHits` is not a
// real field — older code read it and got an empty array, which is why the
// UI only ever knew about the 25 it fetched, never the full volume.
interface GrantsGovResponse {
  oppHits?: GrantsGovOpp[];
  totalHits?: GrantsGovOpp[]; // legacy/fallback only
  hitCount?: number;
  startRecord?: number;
}

// Grants.gov public REST API
const GRANTS_GOV_API = 'https://apply07.grants.gov/grantsws/rest/opportunities/search';

// Common agency codes
const AGENCY_LIST = [
  { code: 'HHS', name: 'Health and Human Services' },
  { code: 'DOD', name: 'Department of Defense' },
  { code: 'NSF', name: 'National Science Foundation' },
  { code: 'DOE', name: 'Department of Energy' },
  { code: 'USDA', name: 'Department of Agriculture' },
  { code: 'DOC', name: 'Department of Commerce' },
  { code: 'ED', name: 'Department of Education' },
  { code: 'EPA', name: 'Environmental Protection Agency' },
  { code: 'NASA', name: 'NASA' },
  { code: 'DOJ', name: 'Department of Justice' },
  { code: 'DOL', name: 'Department of Labor' },
  { code: 'DOS', name: 'Department of State' },
  { code: 'DOT', name: 'Department of Transportation' },
  { code: 'VA', name: 'Department of Veterans Affairs' },
];

// Funding categories
const CATEGORY_LIST = [
  { code: 'HL', name: 'Health' },
  { code: 'ST', name: 'Science and Technology' },
  { code: 'ED', name: 'Education' },
  { code: 'EN', name: 'Energy' },
  { code: 'ENV', name: 'Environment' },
  { code: 'BC', name: 'Business and Commerce' },
  { code: 'CD', name: 'Community Development' },
  { code: 'AG', name: 'Agriculture' },
  { code: 'IS', name: 'Information and Statistics' },
  { code: 'LJL', name: 'Law, Justice and Legal Services' },
];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const keyword = searchParams.get('keyword') || '';
  const agency = searchParams.get('agency') || '';
  const category = searchParams.get('category') || '';
  const status = searchParams.get('status') || 'posted';
  const limit = parseInt(searchParams.get('limit') || '25', 10);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);
  const email = searchParams.get('email') || '';
  // sort: 'relevance' (rank by profile) or 'newest'. Default relevance when an
  // email/profile exists, but the UI can force 'newest' to browse everything.
  const sort = searchParams.get('sort') || (email ? 'relevance' : 'newest');

  const isMetadataRequest = !searchParams.has('keyword')
    && !searchParams.has('agency')
    && !searchParams.has('category')
    && !searchParams.has('status')
    && !searchParams.has('limit')
    && !searchParams.has('email');

  // If no search params, return summary/metadata
  if (isMetadataRequest) {
    return NextResponse.json({
      success: true,
      summary: {
        description: 'Search $700B+ in annual federal grant funding',
        apiSource: 'Grants.gov',
        noAuthRequired: true,
      },
      agencies: AGENCY_LIST,
      categories: CATEGORY_LIST,
      statusOptions: ['posted', 'forecasted', 'closed', 'archived'],
    });
  }

  try {
    // Build Grants.gov search payload
    const searchPayload = {
      keyword: keyword || undefined,
      oppStatuses: status === 'posted' ? 'posted' : status,
      agency: agency || undefined,
      fundingCategories: category || undefined,
      rows: Math.min(limit, 100),
      startRecordNum: offset || undefined, // Grants.gov paging cursor
      sortBy: 'openDate|desc',
    };

    // Clean undefined values
    const cleanPayload = Object.fromEntries(
      Object.entries(searchPayload).filter(([, v]) => v !== undefined)
    );

    const response = await fetch(GRANTS_GOV_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cleanPayload),
    });

    if (!response.ok) {
      console.error('[Grants API] Grants.gov error:', response.status);
      return NextResponse.json({
        success: false,
        error: `Grants.gov API returned ${response.status}`,
      }, { status: 502 });
    }

    const data: GrantsGovResponse = await response.json();

    // Grants.gov returns this page in `oppHits` and the TRUE total in
    // `hitCount`. (Old code read `totalHits` — not a real field — so it only
    // knew the 25 it fetched.)
    const rawOpportunities = data.oppHits || data.totalHits || [];
    const totalAvailable = typeof data.hitCount === 'number' ? data.hitCount : rawOpportunities.length;

    // Transform to consistent format
    let grants = rawOpportunities.map((opp) => ({
      id: opp.id,
      oppNumber: opp.number,
      title: opp.title,
      agency: opp.agency || 'Unknown',
      agencyCode: opp.agencyCode,
      description: opp.synopsis || opp.description || '',
      awardCeiling: typeof opp.awardCeiling === 'string' ? parseFloat(opp.awardCeiling) : (opp.awardCeiling ?? null),
      postedDate: opp.openDate,
      closeDate: opp.closeDate,
      status: opp.oppStatus,
      docType: opp.docType,
      cfdaList: opp.cfdaList,
      url: `https://www.grants.gov/search-results-detail/${opp.id}`,
      score: undefined as number | undefined,
    }));

    // Profile-relevance sort: when an email is provided and the user has a
    // profile, score each grant (same scoreGrant as the alert emails) and
    // sort best-match first, newest breaking ties. Without a profile we keep
    // grants.gov's newest-first order. This makes "profile matches" real.
    // Relevance ranking is applied ONLY when sort='relevance' AND the user has
    // a profile. sort='newest' gives the plain, unranked, browse-everything
    // view (already newest-first from Grants.gov).
    let sortedByRelevance = false;
    let hasProfile = false;
    if (email) {
      const profile = await loadUserProfile(email);
      hasProfile = !!(profile && (profile.naics_codes.length || profile.keywords.length || profile.agencies.length));
      if (hasProfile && sort === 'relevance') {
        grants = grants.map((g) => ({
          ...g,
          score: scoreGrant(g as unknown as GrantOpportunity, profile!),
        }));
        grants.sort((a, b) => {
          const s = (b.score ?? 0) - (a.score ?? 0);
          if (s !== 0) return s;
          return (b.postedDate || '').localeCompare(a.postedDate || ''); // newest tie-break
        });
        sortedByRelevance = true;
      }
    }

    return NextResponse.json({
      success: true,
      total: totalAvailable,       // TRUE total matching grants (e.g. 1209)
      count: grants.length,        // grants in THIS page
      offset,
      limit,
      hasMore: offset + grants.length < totalAvailable,
      hasProfile,                  // whether a "For me" sort is even possible
      sortedByRelevance,
      grants,
      searchCriteria: { keyword, agency, category, status, limit, sort },
    });

  } catch (error) {
    console.error('[Grants API] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to search Grants.gov',
    }, { status: 500 });
  }
}
