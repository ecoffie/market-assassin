/**
 * SBIR/STTR API - Wraps NIH RePORTER and aggregated multisite data
 *
 * Data sources:
 * - NIH RePORTER: R43/R44 (SBIR Phase I/II), R41/R42 (STTR)
 * - Multisite aggregation: sbir_sttr opportunities
 *
 * Query params:
 * - keyword: Search term
 * - agency: NIH institute code (NCI, NIAID, etc.) or broad agency (NSF, DOD)
 * - phase: 1 | 2 | all
 * - limit: Max results (default 25)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface NihProject {
  project_num: string;
  project_title: string;
  abstract_text?: string;
  agency_ic_admin?: { abbreviation: string; name: string };
  award_amount?: number;
  award_notice_date?: string;
  project_start_date?: string;
  project_end_date?: string;
  organization?: { org_name: string; org_city: string; org_state: string };
  activity_code?: string;
  opportunity_number?: string;
}

interface NihResponse {
  meta: { total: number; offset: number; limit: number };
  results: NihProject[];
}

// NIH Institute codes
const NIH_INSTITUTES = [
  { code: 'NCI', name: 'National Cancer Institute' },
  { code: 'NIAID', name: 'National Institute of Allergy and Infectious Diseases' },
  { code: 'NHLBI', name: 'National Heart, Lung, and Blood Institute' },
  { code: 'NINDS', name: 'National Institute of Neurological Disorders and Stroke' },
  { code: 'NIMH', name: 'National Institute of Mental Health' },
  { code: 'NIGMS', name: 'National Institute of General Medical Sciences' },
  { code: 'NIDDK', name: 'National Institute of Diabetes and Digestive and Kidney Diseases' },
  { code: 'NIEHS', name: 'National Institute of Environmental Health Sciences' },
  { code: 'NIA', name: 'National Institute on Aging' },
  { code: 'NICHD', name: 'National Institute of Child Health and Human Development' },
];

// SBIR Phase Activity Codes
const SBIR_CODES = {
  phase1: ['R43'], // SBIR Phase I
  phase2: ['R44'], // SBIR Phase II
  sttr1: ['R41'],  // STTR Phase I
  sttr2: ['R42'],  // STTR Phase II
  all: ['R43', 'R44', 'R41', 'R42'],
};

const NIH_API = 'https://api.reporter.nih.gov/v2/projects/search';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const keyword = searchParams.get('keyword') || '';
  const agency = searchParams.get('agency') || '';
  const phase = searchParams.get('phase') || 'all';
  const source = searchParams.get('source') || 'nih'; // nih | multisite | all
  const limit = parseInt(searchParams.get('limit') || '25', 10);

  // If no search params, return summary/metadata
  if (!keyword && !agency) {
    // Get multisite SBIR stats
    let multisiteCount = 0;
    try {
      const supabase = getSupabase();
      const { count } = await supabase
        .from('aggregated_opportunities')
        .select('*', { count: 'exact', head: true })
        .eq('opportunity_type', 'sbir_sttr');
      multisiteCount = count || 0;
    } catch (e) {
      console.error('[SBIR API] Multisite count error:', e);
    }

    return NextResponse.json({
      success: true,
      summary: {
        description: 'SBIR/STTR funding for small business R&D',
        phase1Award: '$275,000 typical',
        phase2Award: '$1,100,000 typical',
        eligibility: 'US small business, <500 employees, 51%+ US-owned',
        multisiteOpportunities: multisiteCount,
      },
      nihInstitutes: NIH_INSTITUTES,
      phaseOptions: [
        { value: 'all', label: 'All Phases' },
        { value: '1', label: 'Phase I ($275K)' },
        { value: '2', label: 'Phase II ($1.1M)' },
      ],
      sourceOptions: [
        { value: 'nih', label: 'NIH RePORTER' },
        { value: 'multisite', label: 'Multisite Aggregation' },
        { value: 'all', label: 'All Sources' },
      ],
    });
  }

  const results: {
    id: string;
    title: string;
    agency: string;
    phase?: string;
    amount?: number;
    startDate?: string;
    endDate?: string;
    organization?: string;
    location?: string;
    description?: string;
    source: string;
    url?: string;
  }[] = [];

  // Fetch from NIH if requested
  if (source === 'nih' || source === 'all') {
    try {
      const activityCodes = phase === '1' ? SBIR_CODES.phase1 :
                           phase === '2' ? SBIR_CODES.phase2 :
                           SBIR_CODES.all;

      const currentYear = new Date().getFullYear();
      const nihPayload = {
        criteria: {
          fiscal_years: [currentYear, currentYear + 1],
          activity_codes: activityCodes,
          advanced_text_search: keyword ? {
            operator: 'and',
            search_field: 'all',
            search_text: keyword,
          } : undefined,
          agencies: agency ? [agency] : undefined,
        },
        offset: 0,
        limit: Math.min(limit, 50),
        sort_field: 'award_notice_date',
        sort_order: 'desc',
      };

      // Clean undefined values
      if (!nihPayload.criteria.advanced_text_search) delete nihPayload.criteria.advanced_text_search;
      if (!nihPayload.criteria.agencies) delete nihPayload.criteria.agencies;

      const nihResponse = await fetch(NIH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nihPayload),
      });

      if (nihResponse.ok) {
        const nihData: NihResponse = await nihResponse.json();

        for (const proj of nihData.results || []) {
          const actCode = proj.activity_code || '';
          let phaseLabel = 'SBIR';
          if (actCode === 'R43') phaseLabel = 'SBIR Phase I';
          else if (actCode === 'R44') phaseLabel = 'SBIR Phase II';
          else if (actCode === 'R41') phaseLabel = 'STTR Phase I';
          else if (actCode === 'R42') phaseLabel = 'STTR Phase II';

          results.push({
            id: proj.project_num,
            title: proj.project_title,
            agency: proj.agency_ic_admin?.abbreviation || 'NIH',
            phase: phaseLabel,
            amount: proj.award_amount,
            startDate: proj.project_start_date,
            endDate: proj.project_end_date,
            organization: proj.organization?.org_name,
            location: proj.organization ? `${proj.organization.org_city}, ${proj.organization.org_state}` : undefined,
            description: proj.abstract_text?.slice(0, 500),
            source: 'NIH RePORTER',
            url: `https://reporter.nih.gov/project-details/${proj.project_num}`,
          });
        }
      }
    } catch (error) {
      console.error('[SBIR API] NIH error:', error);
    }
  }

  // Fetch from multisite aggregation if requested
  if (source === 'multisite' || source === 'all') {
    try {
      const supabase = getSupabase();
      let query = supabase
        .from('aggregated_opportunities')
        .select('*')
        .eq('opportunity_type', 'sbir_sttr')
        .order('posted_date', { ascending: false })
        .limit(Math.min(limit, 50));

      if (keyword) {
        query = query.or(`title.ilike.%${keyword}%,description.ilike.%${keyword}%`);
      }
      if (agency) {
        query = query.ilike('agency', `%${agency}%`);
      }

      const { data, error } = await query;

      if (!error && data) {
        for (const opp of data) {
          results.push({
            id: opp.id,
            title: opp.title,
            agency: opp.agency || 'Unknown',
            phase: opp.set_aside_type || 'SBIR/STTR',
            amount: opp.estimated_value,
            startDate: opp.posted_date,
            endDate: opp.close_date,
            description: opp.description?.slice(0, 500),
            source: opp.source || 'Multisite',
            url: opp.source_url,
          });
        }
      }
    } catch (error) {
      console.error('[SBIR API] Multisite error:', error);
    }
  }

  // Dedupe by title similarity (basic)
  const seen = new Set<string>();
  const dedupedResults = results.filter((r) => {
    const key = r.title.toLowerCase().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json({
    success: true,
    count: dedupedResults.length,
    opportunities: dedupedResults.slice(0, limit),
    searchCriteria: { keyword, agency, phase, source, limit },
  });
}
