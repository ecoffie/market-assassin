/**
 * Lindy Match API
 *
 * POST /api/lindy/match
 *
 * Takes user's knowledge base (capabilities, past performance, certs) and matches
 * against agency pain points, priorities, and current opportunities.
 *
 * Request body:
 * {
 *   email: string,
 *   user_kb: {
 *     capabilities: string[],           // "cybersecurity", "cloud migration", "data analytics"
 *     past_performance: string[],       // "DHS USCIS contract", "VA modernization"
 *     certifications: string[],         // "ISO 27001", "FedRAMP", "CMMC Level 2"
 *     set_asides: string[],             // "SDVOSB", "8(a)", "HUBZone"
 *     naics_codes: string[],            // "541511", "541512"
 *     target_agencies: string[],        // "DHS", "VA", "DOD"
 *     teaming_interests: string[],      // "prime", "sub", "JV"
 *     geographic_presence: string[],    // "DC Metro", "Texas", "Remote"
 *   },
 *   query?: string  // Optional natural language query like "find cyber opportunities at DHS"
 * }
 *
 * Returns matched opportunities with fit scores and talking points.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import agencyPainPoints from '@/data/agency-pain-points.json';

interface UserKB {
  capabilities?: string[];
  past_performance?: string[];
  certifications?: string[];
  set_asides?: string[];
  naics_codes?: string[];
  target_agencies?: string[];
  teaming_interests?: string[];
  geographic_presence?: string[];
}

interface MatchResult {
  opportunity_id: string;
  opportunity_name: string;
  agency: string;
  agency_acronym: string;
  contract_value: string;
  incumbent: string;
  timing: string;

  // Match analysis
  fit_score: number; // 0-100
  fit_grade: 'A' | 'B' | 'C' | 'D' | 'F';

  // Why it matches
  capability_matches: string[];
  pain_point_matches: string[];
  set_aside_match: boolean;
  naics_match: boolean;
  past_performance_relevance: string | null;

  // Talking points for capture
  talking_points: string[];

  // Teaming suggestions
  teaming_angle: string | null;
  suggested_primes: string[];

  // Action items
  next_steps: string[];
}

interface AgencyMatch {
  agency: string;
  agency_acronym: string;
  pain_points_matched: Array<{ pain_point: string; your_capability: string; }>;
  priorities_matched: Array<{ priority: string; your_capability: string; }>;
  overall_fit: number;
  positioning_statement: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, user_kb, query } = body as {
      email?: string;
      user_kb?: UserKB;
      query?: string;
    };

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    if (!user_kb || Object.keys(user_kb).length === 0) {
      return NextResponse.json({
        error: 'User KB required',
        usage: 'POST with user_kb containing capabilities, past_performance, certifications, etc.',
      }, { status: 400 });
    }

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

    // Get latest briefing data for this user
    const { data: briefingData } = await getSupabase()
      .from('briefing_log')
      .select('briefing_data')
      .eq('user_email', email)
      .order('briefing_date', { ascending: false })
      .limit(1)
      .single();

    const opportunities = (briefingData?.briefing_data?.opportunities || []) as Array<{
      id: string;
      contractName: string;
      agency: string;
      agencyAcronym: string;
      contractValue: string;
      incumbent: string;
      timingSignal: string;
      whyVulnerable: string;
      setAsideType?: string;
      naicsCode?: string;
    }>;

    // Match opportunities against user KB
    const matchedOpportunities: MatchResult[] = [];

    for (const opp of opportunities) {
      const match = scoreOpportunityMatch(opp, user_kb);
      if (match.fit_score >= 40) { // Only return decent matches
        matchedOpportunities.push(match);
      }
    }

    // Sort by fit score descending
    matchedOpportunities.sort((a, b) => b.fit_score - a.fit_score);

    // Match against agency pain points
    const agencyMatches = matchAgencyPainPoints(user_kb);

    // Find teaming synergies
    const teamingSynergies = findTeamingSynergies(matchedOpportunities, user_kb);

    // Filter by query if provided
    let filteredOpportunities = matchedOpportunities;
    if (query) {
      const queryLower = query.toLowerCase();
      filteredOpportunities = matchedOpportunities.filter(m => {
        return (
          m.opportunity_name.toLowerCase().includes(queryLower) ||
          m.agency.toLowerCase().includes(queryLower) ||
          m.agency_acronym.toLowerCase().includes(queryLower) ||
          m.capability_matches.some(c => c.toLowerCase().includes(queryLower)) ||
          m.pain_point_matches.some(p => p.toLowerCase().includes(queryLower))
        );
      });
    }

    return NextResponse.json({
      success: true,
      email,
      query: query || null,
      generated_at: new Date().toISOString(),

      // Summary
      summary: {
        total_opportunities_analyzed: opportunities.length,
        strong_matches: filteredOpportunities.filter(m => m.fit_score >= 70).length,
        moderate_matches: filteredOpportunities.filter(m => m.fit_score >= 50 && m.fit_score < 70).length,
        agencies_with_pain_point_overlap: agencyMatches.length,
        teaming_synergies_found: teamingSynergies.length,
      },

      // Top matched opportunities
      matched_opportunities: filteredOpportunities.slice(0, 10),

      // Agency pain point matches
      agency_matches: agencyMatches.slice(0, 5),

      // Teaming synergies
      teaming_synergies: teamingSynergies.slice(0, 5),

      // Overall recommendations
      recommendations: generateRecommendations(filteredOpportunities, agencyMatches, user_kb),
    });

  } catch (error) {
    console.error('[Lindy Match] Error:', error);
    return NextResponse.json({
      error: 'Failed to process match request',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

/**
 * Score how well an opportunity matches user KB
 */
function scoreOpportunityMatch(
  opp: {
    id: string;
    contractName: string;
    agency: string;
    agencyAcronym: string;
    contractValue: string;
    incumbent: string;
    timingSignal: string;
    whyVulnerable: string;
    setAsideType?: string;
    naicsCode?: string;
  },
  kb: UserKB
): MatchResult {
  let score = 0;
  const capabilityMatches: string[] = [];
  const painPointMatches: string[] = [];
  const talkingPoints: string[] = [];
  const nextSteps: string[] = [];

  const oppText = `${opp.contractName} ${opp.whyVulnerable} ${opp.agency}`.toLowerCase();

  // Capability matching (+30 max)
  for (const cap of kb.capabilities || []) {
    if (oppText.includes(cap.toLowerCase())) {
      score += 10;
      capabilityMatches.push(cap);
      talkingPoints.push(`Your ${cap} expertise directly addresses this requirement`);
    }
  }
  score = Math.min(score, 30);

  // NAICS match (+20)
  const naicsMatch = kb.naics_codes?.some(n =>
    opp.naicsCode?.startsWith(n) || n.startsWith(opp.naicsCode || '')
  ) || false;
  if (naicsMatch) {
    score += 20;
    talkingPoints.push(`NAICS code alignment strengthens your eligibility`);
  }

  // Set-aside match (+15)
  const setAsideMatch = opp.setAsideType && kb.set_asides?.some(s =>
    opp.setAsideType?.toLowerCase().includes(s.toLowerCase())
  ) || false;
  if (setAsideMatch) {
    score += 15;
    talkingPoints.push(`Your ${kb.set_asides?.find(s => opp.setAsideType?.toLowerCase().includes(s.toLowerCase()))} status gives you competitive advantage`);
  }

  // Target agency match (+15)
  const agencyMatch = kb.target_agencies?.some(a =>
    opp.agencyAcronym.toLowerCase() === a.toLowerCase() ||
    opp.agency.toLowerCase().includes(a.toLowerCase())
  ) || false;
  if (agencyMatch) {
    score += 15;
  }

  // Past performance relevance (+20)
  let ppRelevance: string | null = null;
  for (const pp of kb.past_performance || []) {
    const ppLower = pp.toLowerCase();
    if (ppLower.includes(opp.agencyAcronym.toLowerCase()) ||
        opp.agency.toLowerCase().includes(ppLower.split(' ')[0])) {
      score += 20;
      ppRelevance = pp;
      talkingPoints.push(`Your past performance at ${pp} demonstrates agency familiarity`);
      break;
    }
  }

  // Pain point matching from agency data
  const agencyData = (agencyPainPoints as Record<string, { painPoints?: string[]; priorities?: string[] }>)[opp.agencyAcronym] ||
                     (agencyPainPoints as Record<string, { painPoints?: string[]; priorities?: string[] }>)[opp.agency];
  if (agencyData) {
    for (const pain of agencyData.painPoints || []) {
      for (const cap of kb.capabilities || []) {
        if (pain.toLowerCase().includes(cap.toLowerCase()) ||
            cap.toLowerCase().includes(pain.toLowerCase().split(' ')[0])) {
          painPointMatches.push(pain);
          break;
        }
      }
    }
  }

  // Generate fit grade
  let fitGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  if (score >= 80) fitGrade = 'A';
  else if (score >= 65) fitGrade = 'B';
  else if (score >= 50) fitGrade = 'C';
  else if (score >= 40) fitGrade = 'D';
  else fitGrade = 'F';

  // Generate next steps
  if (score >= 70) {
    nextSteps.push('Prioritize this opportunity - strong fit');
    nextSteps.push('Begin incumbent research and gap analysis');
    nextSteps.push('Identify teaming partners to strengthen bid');
  } else if (score >= 50) {
    nextSteps.push('Monitor this opportunity');
    nextSteps.push('Assess teaming options to fill capability gaps');
  } else {
    nextSteps.push('Consider as secondary target');
    nextSteps.push('May require significant teaming to be competitive');
  }

  // Teaming angle
  let teamingAngle: string | null = null;
  const suggestedPrimes: string[] = [];

  if (kb.teaming_interests?.includes('sub')) {
    teamingAngle = 'Position as specialized subcontractor to a large prime';
    suggestedPrimes.push('Leidos', 'CACI', 'Booz Allen', 'Peraton');
  } else if (kb.teaming_interests?.includes('prime') && score < 70) {
    teamingAngle = 'Build teaming arrangement to fill capability gaps';
  }

  return {
    opportunity_id: opp.id,
    opportunity_name: opp.contractName,
    agency: opp.agency,
    agency_acronym: opp.agencyAcronym,
    contract_value: opp.contractValue,
    incumbent: opp.incumbent,
    timing: opp.timingSignal,
    fit_score: Math.min(score, 100),
    fit_grade: fitGrade,
    capability_matches: capabilityMatches,
    pain_point_matches: painPointMatches.slice(0, 3),
    set_aside_match: setAsideMatch,
    naics_match: naicsMatch,
    past_performance_relevance: ppRelevance,
    talking_points: talkingPoints.slice(0, 4),
    teaming_angle: teamingAngle,
    suggested_primes: suggestedPrimes,
    next_steps: nextSteps,
  };
}

/**
 * Match user capabilities against agency pain points
 */
function matchAgencyPainPoints(kb: UserKB): AgencyMatch[] {
  const matches: AgencyMatch[] = [];
  const targetAgencies = kb.target_agencies || [];

  const painPointsData = agencyPainPoints as Record<string, {
    painPoints?: string[];
    priorities?: string[];
    acronym?: string;
  }>;

  for (const [agencyName, data] of Object.entries(painPointsData)) {
    // Skip if not a target agency (unless no targets specified)
    if (targetAgencies.length > 0) {
      const isTarget = targetAgencies.some(t =>
        agencyName.toLowerCase().includes(t.toLowerCase()) ||
        data.acronym?.toLowerCase() === t.toLowerCase()
      );
      if (!isTarget) continue;
    }

    const painPointsMatched: Array<{ pain_point: string; your_capability: string }> = [];
    const prioritiesMatched: Array<{ priority: string; your_capability: string }> = [];

    // Match pain points
    for (const pain of data.painPoints || []) {
      for (const cap of kb.capabilities || []) {
        if (pain.toLowerCase().includes(cap.toLowerCase()) ||
            cap.toLowerCase().split(' ').some(w => pain.toLowerCase().includes(w))) {
          painPointsMatched.push({ pain_point: pain, your_capability: cap });
          break;
        }
      }
    }

    // Match priorities
    for (const priority of data.priorities || []) {
      for (const cap of kb.capabilities || []) {
        if (priority.toLowerCase().includes(cap.toLowerCase()) ||
            cap.toLowerCase().split(' ').some(w => priority.toLowerCase().includes(w))) {
          prioritiesMatched.push({ priority, your_capability: cap });
          break;
        }
      }
    }

    if (painPointsMatched.length > 0 || prioritiesMatched.length > 0) {
      const overallFit = Math.min(
        (painPointsMatched.length * 20) + (prioritiesMatched.length * 15),
        100
      );

      matches.push({
        agency: agencyName,
        agency_acronym: data.acronym || agencyName.split(' ').map(w => w[0]).join(''),
        pain_points_matched: painPointsMatched.slice(0, 3),
        priorities_matched: prioritiesMatched.slice(0, 3),
        overall_fit: overallFit,
        positioning_statement: generatePositioningStatement(agencyName, painPointsMatched, prioritiesMatched, kb),
      });
    }
  }

  return matches.sort((a, b) => b.overall_fit - a.overall_fit);
}

/**
 * Generate positioning statement for agency
 */
function generatePositioningStatement(
  agency: string,
  painPoints: Array<{ pain_point: string; your_capability: string }>,
  priorities: Array<{ priority: string; your_capability: string }>,
  kb: UserKB
): string {
  const caps = kb.capabilities?.slice(0, 2).join(' and ') || 'our capabilities';
  const setAside = kb.set_asides?.[0] || '';
  const setAsideText = setAside ? ` As a ${setAside},` : '';

  if (painPoints.length > 0) {
    return `${setAsideText} we directly address ${agency}'s challenge with ${painPoints[0].pain_point.toLowerCase()} through our ${caps} expertise.`;
  }

  if (priorities.length > 0) {
    return `${setAsideText} our ${caps} capabilities align with ${agency}'s priority of ${priorities[0].priority.toLowerCase()}.`;
  }

  return `Our ${caps} capabilities position us to support ${agency}'s mission.`;
}

/**
 * Find teaming synergies
 */
function findTeamingSynergies(
  matches: MatchResult[],
  kb: UserKB
): Array<{
  opportunity: string;
  synergy_type: string;
  description: string;
  action: string;
}> {
  const synergies: Array<{
    opportunity: string;
    synergy_type: string;
    description: string;
    action: string;
  }> = [];

  for (const match of matches) {
    // If user wants to sub and opportunity has large value
    if (kb.teaming_interests?.includes('sub') && match.contract_value.includes('M')) {
      synergies.push({
        opportunity: match.opportunity_name,
        synergy_type: 'subcontracting',
        description: `Large contract suitable for subcontracting. Your ${match.capability_matches[0] || 'specialized'} capabilities can complement a prime's bid.`,
        action: `Reach out to primes like ${match.suggested_primes.slice(0, 2).join(', ')} who may be pursuing this`,
      });
    }

    // If set-aside match
    if (match.set_aside_match) {
      synergies.push({
        opportunity: match.opportunity_name,
        synergy_type: 'set-aside advantage',
        description: `Your ${kb.set_asides?.[0]} status makes you eligible for set-aside competition or mentor-protégé arrangements.`,
        action: 'Consider mentor-protégé arrangement with established prime',
      });
    }
  }

  return synergies;
}

/**
 * Generate overall recommendations
 */
function generateRecommendations(
  opportunities: MatchResult[],
  agencyMatches: AgencyMatch[],
  kb: UserKB
): string[] {
  const recommendations: string[] = [];

  const strongMatches = opportunities.filter(o => o.fit_score >= 70);
  if (strongMatches.length > 0) {
    recommendations.push(`PRIORITY: You have ${strongMatches.length} strong-fit opportunities. Focus capture efforts on ${strongMatches[0].opportunity_name}.`);
  }

  if (agencyMatches.length > 0) {
    recommendations.push(`Your capabilities address pain points at ${agencyMatches.map(a => a.agency_acronym).slice(0, 3).join(', ')}. Consider proactive outreach.`);
  }

  if (kb.teaming_interests?.includes('sub')) {
    recommendations.push('As a sub-focused firm, prioritize prime outreach for large opportunities. Build capability statements highlighting your niche expertise.');
  }

  if (kb.set_asides && kb.set_asides.length > 0) {
    recommendations.push(`Leverage your ${kb.set_asides[0]} status. Look for sole-source opportunities and mentor-protégé programs.`);
  }

  if (opportunities.length === 0) {
    recommendations.push('No strong matches found. Consider expanding your NAICS codes or target agencies.');
  }

  return recommendations;
}

// Also support GET for simple queries
export async function GET(request: NextRequest) {
  return NextResponse.json({
    endpoint: '/api/lindy/match',
    method: 'POST',
    description: 'Match user knowledge base against opportunities and agency pain points',
    usage: {
      email: 'user@example.com (required)',
      user_kb: {
        capabilities: ['cybersecurity', 'cloud migration', 'data analytics'],
        past_performance: ['DHS USCIS contract', 'VA modernization'],
        certifications: ['ISO 27001', 'FedRAMP', 'CMMC Level 2'],
        set_asides: ['SDVOSB', '8(a)', 'HUBZone'],
        naics_codes: ['541511', '541512'],
        target_agencies: ['DHS', 'VA', 'DOD'],
        teaming_interests: ['prime', 'sub', 'JV'],
        geographic_presence: ['DC Metro', 'Texas', 'Remote'],
      },
      query: 'Optional: find cyber opportunities at DHS',
    },
  });
}
