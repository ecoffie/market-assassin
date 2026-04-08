import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import painPointsData from '@/data/agency-pain-points.json';
import budgetData from '@/data/agency-budget-data.json';
import agencyAliases from '@/data/agency-aliases.json';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// NAICS to category mapping for relevance scoring
const naicsCategoryMap: Record<string, string[]> = {
  '541512': ['cybersecurity', 'modernization', 'infrastructure'],
  '541511': ['cybersecurity', 'modernization'],
  '541519': ['cybersecurity', 'modernization', 'infrastructure'],
  '541330': ['infrastructure', 'modernization', 'research'],
  '541611': ['compliance', 'operations', 'workforce'],
  '541613': ['compliance', 'operations'],
  '541614': ['logistics', 'operations'],
  '541690': ['research', 'compliance'],
  '541715': ['research', 'modernization'],
  '541990': ['operations', 'compliance'],
  '561210': ['logistics', 'operations', 'workforce'],
  '561320': ['workforce', 'operations'],
  '236220': ['infrastructure'],
  '237310': ['infrastructure'],
  '238210': ['infrastructure'],
};

// Common NAICS descriptions
const naicsDescriptions: Record<string, string> = {
  '541512': 'Computer Systems Design Services',
  '541511': 'Custom Computer Programming Services',
  '541519': 'Other Computer Related Services',
  '541330': 'Engineering Services',
  '541611': 'Administrative Management Consulting',
  '541613': 'Marketing Consulting Services',
  '541614': 'Process & Logistics Consulting',
  '541690': 'Other Scientific & Technical Consulting',
  '541715': 'R&D in Physical, Engineering & Life Sciences',
  '541990': 'All Other Professional & Technical Services',
  '561210': 'Facilities Support Services',
  '561320': 'Temporary Help Services',
  '236220': 'Commercial & Institutional Building Construction',
  '237310': 'Highway, Street & Bridge Construction',
  '238210': 'Electrical Contractors',
};

interface AgencyPainPointData {
  painPoints: string[];
  priorities: string[];
}

interface BudgetAgencyData {
  toptierCode: string;
  fy2025: { budgetAuthority: number; obligated: number; outlays: number };
  fy2026: { budgetAuthority: number; obligated: number; outlays: number };
  change: { amount: number; percent: number; trend: string };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const agency = searchParams.get('agency')?.toUpperCase();
  const naics = searchParams.get('naics');
  const trend = searchParams.get('trend');
  const category = searchParams.get('category');
  const mode = searchParams.get('mode') || 'default';
  const fy = searchParams.get('fy') ? parseInt(searchParams.get('fy')!) : null;
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);

  try {
    // If database has data, use it; otherwise fall back to JSON
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { count: dbCount } = await supabase
      .from('budget_programs')
      .select('*', { count: 'exact', head: true });

    const useDatabase = !!(dbCount && dbCount > 0);

    if (agency) {
      return await getAgencyIntel(agency, category ?? null, useDatabase, supabase);
    }

    if (naics) {
      return await getNaicsIntel(naics, agency ?? null, mode, useDatabase, supabase);
    }

    if (trend) {
      return await getTrendingAgencies(trend, limit);
    }

    if (category) {
      return await getCategoryIntel(category, limit, useDatabase, supabase);
    }

    // Default: return summary stats
    return await getSummaryStats(useDatabase, supabase);
  } catch (error) {
    console.error('Budget Intel API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch budget intelligence' },
      { status: 500 }
    );
  }
}

// ============================================================================
// Agency-focused intelligence
// ============================================================================
async function getAgencyIntel(
  agencyInput: string,
  category: string | null,
  useDatabase: boolean,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
) {
  // Resolve agency alias to full name
  const agencyName = resolveAgencyName(agencyInput);

  // Get pain points from JSON (primary source)
  const painPointEntry = (painPointsData as { agencies: Record<string, AgencyPainPointData> }).agencies[agencyName];

  // Get budget authority
  const budgetEntry = (budgetData as { agencies: Record<string, BudgetAgencyData> }).agencies[agencyName];

  if (!painPointEntry && !budgetEntry) {
    return NextResponse.json(
      { success: false, error: `Agency not found: ${agencyInput}` },
      { status: 404 }
    );
  }

  // Categorize pain points
  const categorizedPainPoints = categorizePainPoints(painPointEntry?.painPoints || []);

  // Filter by category if specified
  let filteredPainPoints = painPointEntry?.painPoints || [];
  if (category && categorizedPainPoints[category]) {
    filteredPainPoints = categorizedPainPoints[category];
  }

  // Extract NDAA items
  const ndaaItems = filteredPainPoints.filter(
    (pp) => pp.includes('NDAA') || pp.includes('mandate') || pp.includes('Executive Order')
  );

  // Parse priorities for funding amounts
  const parsedPriorities = parsePriorities(painPointEntry?.priorities || [], agencyName);

  // Get programs from database if available
  let programs: any[] = [];
  if (useDatabase) {
    const { data } = await supabase
      .from('budget_programs')
      .select('*')
      .ilike('agency', `%${agencyName}%`)
      .order('requested_amount', { ascending: false })
      .limit(20);
    programs = data || [];
  }

  // Generate recommendations
  const recommendations = generateAgencyRecommendations(
    agencyName,
    budgetEntry,
    filteredPainPoints,
    parsedPriorities
  );

  return NextResponse.json({
    success: true,
    query: { agency: agencyInput, category },

    agency: {
      name: agencyName,
      abbreviation: agencyInput,
      toptierCode: budgetEntry?.toptierCode,
    },

    budgetAuthority: budgetEntry
      ? {
          fy2025: budgetEntry.fy2025.budgetAuthority,
          fy2026: budgetEntry.fy2026.budgetAuthority,
          change: budgetEntry.change,
        }
      : null,

    painPoints: {
      all: filteredPainPoints,
      byCategory: categorizedPainPoints,
      ndaaItems,
      total: filteredPainPoints.length,
    },

    priorities: parsedPriorities,

    programs: programs.length > 0 ? programs : undefined,

    recommendations,
  });
}

// ============================================================================
// NAICS-focused intelligence
// ============================================================================
async function getNaicsIntel(
  naics: string,
  agencyFilter: string | null,
  mode: string,
  useDatabase: boolean,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
) {
  const relevantCategories = naicsCategoryMap[naics] || ['other'];
  const naicsDescription = naicsDescriptions[naics] || 'Unknown NAICS';

  // Find agencies with relevant pain points
  const relevantAgencies: any[] = [];
  const allPainPoints = (painPointsData as { agencies: Record<string, AgencyPainPointData> }).agencies;

  for (const [agencyName, data] of Object.entries(allPainPoints)) {
    const categorized = categorizePainPoints(data.painPoints);
    const relevantPainPoints = relevantCategories.flatMap((cat) => categorized[cat] || []);

    if (relevantPainPoints.length > 0) {
      const budgetEntry = (budgetData as { agencies: Record<string, BudgetAgencyData> }).agencies[agencyName];

      relevantAgencies.push({
        agency: agencyName,
        relevantPainPoints,
        painPointCount: relevantPainPoints.length,
        budgetTrend: budgetEntry?.change?.trend || 'unknown',
        budgetAuthority: budgetEntry?.fy2026?.budgetAuthority || 0,
        priorities: parsePriorities(data.priorities, agencyName).filter((p) =>
          relevantCategories.some((cat) =>
            p.description.toLowerCase().includes(cat) ||
            (p.keywords || []).some((k: string) => relevantCategories.includes(k))
          )
        ),
      });
    }
  }

  // Sort by budget + pain point relevance
  relevantAgencies.sort((a, b) => {
    const scoreA = a.budgetAuthority / 1e9 + a.painPointCount * 10;
    const scoreB = b.budgetAuthority / 1e9 + b.painPointCount * 10;
    return scoreB - scoreA;
  });

  // Filter by agency if specified
  let filteredAgencies = relevantAgencies;
  if (agencyFilter) {
    const resolvedName = resolveAgencyName(agencyFilter);
    filteredAgencies = relevantAgencies.filter(
      (a) => a.agency.toLowerCase().includes(resolvedName.toLowerCase())
    );
  }

  // Get programs from database if available
  let programs: any[] = [];
  if (useDatabase) {
    const { data } = await supabase
      .from('budget_programs')
      .select('*')
      .contains('naics_codes', [naics])
      .order('requested_amount', { ascending: false })
      .limit(20);
    programs = data || [];
  }

  // Generate opportunity predictions if mode=opportunities
  let opportunities: any[] = [];
  if (mode === 'opportunities') {
    opportunities = generateOpportunityPredictions(naics, filteredAgencies, programs);
  }

  return NextResponse.json({
    success: true,
    query: { naics, agency: agencyFilter, mode },

    naicsInfo: {
      code: naics,
      description: naicsDescription,
      relevantCategories,
    },

    agencies: filteredAgencies.slice(0, 20).map((a) => ({
      agency: a.agency,
      budgetTrend: a.budgetTrend,
      budgetAuthority: a.budgetAuthority,
      painPointCount: a.painPointCount,
      relevantPainPoints: a.relevantPainPoints.slice(0, 5),
      topPriorities: a.priorities.slice(0, 3),
    })),

    programs: programs.length > 0 ? programs : undefined,

    opportunities: opportunities.length > 0 ? opportunities : undefined,

    summary: {
      relevantAgencies: filteredAgencies.length,
      totalPainPoints: filteredAgencies.reduce((sum, a) => sum + a.painPointCount, 0),
      totalBudgetAuthority: filteredAgencies.reduce((sum, a) => sum + a.budgetAuthority, 0),
      growingAgencies: filteredAgencies.filter((a) => a.budgetTrend === 'growing' || a.budgetTrend === 'surging').length,
    },

    recommendations: [
      `Focus on ${relevantCategories.join(', ')} pain points across ${filteredAgencies.length} agencies`,
      filteredAgencies.filter((a) => a.budgetTrend === 'surging').length > 0
        ? `${filteredAgencies.filter((a) => a.budgetTrend === 'surging').length} agencies have surging budgets - prioritize these`
        : 'No agencies with surging budgets in this NAICS - focus on pain point alignment',
      `Top agency by budget: ${filteredAgencies[0]?.agency || 'N/A'}`,
    ],
  });
}

// ============================================================================
// Trending agencies by budget
// ============================================================================
async function getTrendingAgencies(trend: string, limit: number) {
  const validTrends = ['surging', 'growing', 'stable', 'declining', 'cut'];
  if (!validTrends.includes(trend)) {
    return NextResponse.json(
      { success: false, error: `Invalid trend. Use: ${validTrends.join(', ')}` },
      { status: 400 }
    );
  }

  const budgetAgencies = (budgetData as { agencies: Record<string, BudgetAgencyData> }).agencies;
  const trendingAgencies: any[] = [];

  for (const [agencyName, data] of Object.entries(budgetAgencies)) {
    if (data.change.trend === trend) {
      const painPointEntry = (painPointsData as { agencies: Record<string, AgencyPainPointData> }).agencies[agencyName];

      trendingAgencies.push({
        agency: agencyName,
        fy2025: data.fy2025.budgetAuthority,
        fy2026: data.fy2026.budgetAuthority,
        changeAmount: data.change.amount,
        changePercent: data.change.percent,
        trend: data.change.trend,
        painPointCount: painPointEntry?.painPoints?.length || 0,
        priorityCount: painPointEntry?.priorities?.length || 0,
      });
    }
  }

  // Sort by change amount (absolute value for cuts)
  trendingAgencies.sort((a, b) => Math.abs(b.changeAmount) - Math.abs(a.changeAmount));

  return NextResponse.json({
    success: true,
    query: { trend },
    agencies: trendingAgencies.slice(0, limit),
    summary: {
      total: trendingAgencies.length,
      totalChangeAmount: trendingAgencies.reduce((sum, a) => sum + a.changeAmount, 0),
    },
    recommendations:
      trend === 'surging' || trend === 'growing'
        ? [
            'Agencies with growing budgets have more procurement activity',
            'Focus on new program initiatives and modernization efforts',
            'Position for multi-year contracts while funding is available',
          ]
        : [
            'Declining budgets mean fewer new starts but more recompetes',
            'Focus on efficiency and cost-saving solutions',
            'Target IDIQ task orders over new standalone contracts',
          ],
  });
}

// ============================================================================
// Category-focused intelligence
// ============================================================================
async function getCategoryIntel(
  category: string,
  limit: number,
  useDatabase: boolean,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
) {
  const validCategories = [
    'cybersecurity',
    'infrastructure',
    'modernization',
    'compliance',
    'workforce',
    'logistics',
    'research',
    'operations',
  ];

  if (!validCategories.includes(category)) {
    return NextResponse.json(
      { success: false, error: `Invalid category. Use: ${validCategories.join(', ')}` },
      { status: 400 }
    );
  }

  const allPainPoints = (painPointsData as { agencies: Record<string, AgencyPainPointData> }).agencies;
  const categoryResults: any[] = [];

  for (const [agencyName, data] of Object.entries(allPainPoints)) {
    const categorized = categorizePainPoints(data.painPoints);
    const categoryPainPoints = categorized[category] || [];

    if (categoryPainPoints.length > 0) {
      const budgetEntry = (budgetData as { agencies: Record<string, BudgetAgencyData> }).agencies[agencyName];

      categoryResults.push({
        agency: agencyName,
        painPoints: categoryPainPoints,
        painPointCount: categoryPainPoints.length,
        budgetTrend: budgetEntry?.change?.trend || 'unknown',
        budgetAuthority: budgetEntry?.fy2026?.budgetAuthority || 0,
      });
    }
  }

  // Sort by pain point count + budget
  categoryResults.sort((a, b) => {
    const scoreA = a.painPointCount * 10 + a.budgetAuthority / 1e9;
    const scoreB = b.painPointCount * 10 + b.budgetAuthority / 1e9;
    return scoreB - scoreA;
  });

  // Find relevant NAICS codes for this category
  const relevantNaics = Object.entries(naicsCategoryMap)
    .filter(([_, cats]) => cats.includes(category))
    .map(([code]) => ({ code, description: naicsDescriptions[code] }));

  return NextResponse.json({
    success: true,
    query: { category },
    agencies: categoryResults.slice(0, limit),
    relevantNaics,
    summary: {
      totalAgencies: categoryResults.length,
      totalPainPoints: categoryResults.reduce((sum, a) => sum + a.painPointCount, 0),
      avgBudgetAuthority:
        categoryResults.reduce((sum, a) => sum + a.budgetAuthority, 0) / categoryResults.length,
    },
    recommendations: [
      `${categoryResults.length} agencies have ${category} pain points`,
      `Target NAICS: ${relevantNaics.map((n) => n.code).join(', ')}`,
      categoryResults.filter((a) => a.budgetTrend === 'growing').length > 0
        ? `${categoryResults.filter((a) => a.budgetTrend === 'growing').length} agencies with growing budgets`
        : 'Focus on efficiency solutions for stable/declining budgets',
    ],
  });
}

// ============================================================================
// Summary stats
// ============================================================================
async function getSummaryStats(
  useDatabase: boolean,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
) {
  const budgetAgencies = (budgetData as { agencies: Record<string, BudgetAgencyData> }).agencies;
  const painPointAgencies = (painPointsData as { agencies: Record<string, AgencyPainPointData> }).agencies;

  // Count trends
  const trendCounts: Record<string, number> = { surging: 0, growing: 0, stable: 0, declining: 0, cut: 0 };
  let totalFY26Budget = 0;

  for (const data of Object.values(budgetAgencies)) {
    trendCounts[data.change.trend] = (trendCounts[data.change.trend] || 0) + 1;
    totalFY26Budget += data.fy2026.budgetAuthority;
  }

  // Count pain points
  let totalPainPoints = 0;
  let totalPriorities = 0;
  for (const data of Object.values(painPointAgencies)) {
    totalPainPoints += data.painPoints?.length || 0;
    totalPriorities += data.priorities?.length || 0;
  }

  // Database stats if available
  let dbStats = null;
  if (useDatabase) {
    const [programs, mappings] = await Promise.all([
      supabase.from('budget_programs').select('*', { count: 'exact', head: true }),
      supabase.from('naics_program_mapping').select('*', { count: 'exact', head: true }),
    ]);
    dbStats = {
      programsInDb: programs.count || 0,
      naicsMappings: mappings.count || 0,
    };
  }

  return NextResponse.json({
    success: true,
    stats: {
      agencies: Object.keys(budgetAgencies).length,
      totalFY26Budget,
      trendCounts,
      totalPainPoints,
      totalPriorities,
      painPointAgencies: Object.keys(painPointAgencies).length,
      dataSource: useDatabase ? 'database' : 'json',
      ...dbStats,
    },
    topGrowingAgencies: Object.entries(budgetAgencies)
      .filter(([_, d]) => d.change.trend === 'surging' || d.change.trend === 'growing')
      .sort((a, b) => b[1].change.amount - a[1].change.amount)
      .slice(0, 5)
      .map(([name, d]) => ({
        agency: name,
        changeAmount: d.change.amount,
        changePercent: d.change.percent,
        trend: d.change.trend,
      })),
    categories: [
      'cybersecurity',
      'infrastructure',
      'modernization',
      'compliance',
      'workforce',
      'logistics',
      'research',
      'operations',
    ],
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

function resolveAgencyName(input: string): string {
  const upper = input.toUpperCase();

  // Direct match in aliases
  const aliasData = agencyAliases as { aliases?: Record<string, string> };
  const aliases = aliasData.aliases || {};
  if (aliases[upper]) {
    return aliases[upper];
  }

  // Check if input is already a full name
  const budgetAgencies = (budgetData as { agencies: Record<string, BudgetAgencyData> }).agencies;
  for (const agencyName of Object.keys(budgetAgencies)) {
    if (agencyName.toLowerCase() === input.toLowerCase()) {
      return agencyName;
    }
  }

  // Partial match
  for (const agencyName of Object.keys(budgetAgencies)) {
    if (agencyName.toLowerCase().includes(input.toLowerCase())) {
      return agencyName;
    }
  }

  return input; // Return as-is if no match
}

function categorizePainPoints(painPoints: string[]): Record<string, string[]> {
  const categories: Record<string, string[]> = {
    cybersecurity: [],
    infrastructure: [],
    modernization: [],
    compliance: [],
    workforce: [],
    logistics: [],
    research: [],
    operations: [],
    other: [],
  };

  const keywords: Record<string, string[]> = {
    cybersecurity: ['cyber', 'security', 'zero trust', 'cmmc', 'authentication', 'encryption', 'threat'],
    infrastructure: ['infrastructure', 'facility', 'building', 'construction', 'network', 'cloud', 'data center'],
    modernization: ['modernization', 'digital', 'transformation', 'upgrade', 'legacy', 'ai', 'automation'],
    compliance: ['compliance', 'regulatory', 'audit', 'ndaa', 'mandate', 'policy', 'fitara'],
    workforce: ['workforce', 'recruitment', 'retention', 'training', 'skills', 'personnel', 'talent'],
    logistics: ['logistics', 'supply chain', 'procurement', 'inventory', 'distribution', 'shipping'],
    research: ['research', 'r&d', 'development', 'innovation', 'prototype', 'sbir', 'sttr'],
    operations: ['operations', 'maintenance', 'sustainment', 'support', 'services', 'o&m'],
  };

  for (const pp of painPoints) {
    const lower = pp.toLowerCase();
    let matched = false;

    for (const [category, kws] of Object.entries(keywords)) {
      if (kws.some((kw) => lower.includes(kw))) {
        categories[category].push(pp);
        matched = true;
        break; // Only categorize once
      }
    }

    if (!matched) {
      categories.other.push(pp);
    }
  }

  return categories;
}

function parsePriorities(priorities: string[], agency: string): any[] {
  return priorities.map((p) => {
    // Extract funding amount
    const fundingMatch = p.match(/\$[\d.,]+[BMK]?/i);
    const fundingAmount = fundingMatch ? parseFundingAmount(fundingMatch[0]) : null;

    // Extract fiscal year
    const fyMatch = p.match(/FY\s*20\d{2}(?:-\d{2,4})?/gi);
    const fiscalYear = fyMatch ? fyMatch[0] : null;

    // Extract keywords
    const keywords: string[] = [];
    if (p.toLowerCase().includes('cyber')) keywords.push('cybersecurity');
    if (p.toLowerCase().includes('ai') || p.toLowerCase().includes('artificial intelligence')) keywords.push('modernization');
    if (p.toLowerCase().includes('cloud')) keywords.push('infrastructure');
    if (p.toLowerCase().includes('supply chain')) keywords.push('logistics');

    return {
      agency,
      description: p,
      fundingAmount,
      fiscalYear,
      keywords,
    };
  });
}

function parseFundingAmount(str: string): number | null {
  const cleaned = str.replace(/[$,]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;

  if (cleaned.toUpperCase().includes('B')) return num * 1e9;
  if (cleaned.toUpperCase().includes('M')) return num * 1e6;
  if (cleaned.toUpperCase().includes('K')) return num * 1e3;
  return num;
}

function generateAgencyRecommendations(
  agency: string,
  budget: BudgetAgencyData | undefined,
  painPoints: string[],
  priorities: any[]
): string[] {
  const recs: string[] = [];

  if (budget) {
    if (budget.change.trend === 'surging') {
      recs.push(`${agency} budget surging ${((budget.change.percent - 1) * 100).toFixed(0)}% - excellent time to pursue new contracts`);
    } else if (budget.change.trend === 'growing') {
      recs.push(`${agency} budget growing - position for new program starts`);
    } else if (budget.change.trend === 'declining' || budget.change.trend === 'cut') {
      recs.push(`${agency} budget declining - focus on efficiency solutions and recompetes`);
    }
  }

  // NDAA items = congressional pressure
  const ndaaCount = painPoints.filter((pp) => pp.includes('NDAA')).length;
  if (ndaaCount > 0) {
    recs.push(`${ndaaCount} NDAA mandates creating procurement pressure`);
  }

  // High-value priorities
  const highValuePriorities = priorities.filter((p) => p.fundingAmount && p.fundingAmount > 500e6);
  if (highValuePriorities.length > 0) {
    recs.push(`${highValuePriorities.length} priorities with $500M+ funding`);
  }

  if (recs.length === 0) {
    recs.push('Monitor agency forecast pages for upcoming solicitations');
  }

  return recs;
}

function generateOpportunityPredictions(
  naics: string,
  agencies: any[],
  programs: any[]
): any[] {
  const opportunities: any[] = [];

  // Score each agency for opportunity potential
  for (const agency of agencies.slice(0, 10)) {
    let score = 0;
    const indicators: string[] = [];

    // Budget trend
    if (agency.budgetTrend === 'surging') {
      score += 25;
      indicators.push('Surging budget (+30%+)');
    } else if (agency.budgetTrend === 'growing') {
      score += 20;
      indicators.push('Growing budget');
    }

    // Pain point alignment
    if (agency.painPointCount >= 5) {
      score += 25;
      indicators.push(`${agency.painPointCount} aligned pain points`);
    } else if (agency.painPointCount >= 3) {
      score += 15;
      indicators.push(`${agency.painPointCount} aligned pain points`);
    }

    // Priorities with funding
    const fundedPriorities = agency.priorities?.filter((p: any) => p.fundingAmount) || [];
    if (fundedPriorities.length > 0) {
      score += 20;
      indicators.push(`${fundedPriorities.length} funded priorities`);
    }

    // NDAA items
    const ndaaItems = agency.relevantPainPoints?.filter((pp: string) => pp.includes('NDAA')) || [];
    if (ndaaItems.length > 0) {
      score += 15;
      indicators.push(`${ndaaItems.length} NDAA mandates`);
    }

    if (score > 30) {
      opportunities.push({
        agency: agency.agency,
        naicsCode: naics,
        confidenceScore: score / 100,
        earlyIndicators: indicators,
        topPainPoints: agency.relevantPainPoints?.slice(0, 3) || [],
        topPriorities: agency.priorities?.slice(0, 2) || [],
        estimatedTimeline: score > 60 ? 'Q3-Q4 FY2026' : 'FY2026-2027',
        recommendedAction:
          score > 60
            ? 'High priority - monitor forecasts and build relationships'
            : 'Medium priority - position for future opportunities',
      });
    }
  }

  // Sort by confidence
  opportunities.sort((a, b) => b.confidenceScore - a.confidenceScore);

  return opportunities;
}
