// Agency Intelligence Module
// Aggregates federal oversight data from multiple public APIs
// Provides verified intelligence for briefings and market research

export * from './types';
export * from './verifier';

import { createClient } from '@supabase/supabase-js';
import { AgencyIntelligence, SyncRun, FetcherOptions } from './types';
import { fetchGAOReports, fetchBudgetDocuments } from './fetchers/govinfo';
import { fetchITInvestments, fetchCIOPriorities } from './fetchers/it-dashboard';
import { fetchAgencySpendingPatterns, fetchNAICSSpending, fetchSubtierAgencies } from './fetchers/usaspending';
import { batchVerify, quickVerify } from './verifier';
import agencyPainPointsJson from '@/data/agency-pain-points.json';

// Type for static pain points JSON
interface AgencyPainPointsData {
  agencies: Record<string, {
    painPoints: string[];
    priorities: string[];
  }>;
}

const staticPainPoints = agencyPainPointsJson as AgencyPainPointsData;

// Re-export fetchers
export const fetchers = {
  govinfo: { fetchGAOReports, fetchBudgetDocuments },
  itDashboard: { fetchITInvestments, fetchCIOPriorities },
  usaspending: { fetchAgencySpendingPatterns, fetchNAICSSpending, fetchSubtierAgencies },
};

/**
 * Sync all intelligence sources
 */
export async function syncAllSources(
  options: FetcherOptions & { verify?: boolean } = {}
): Promise<{
  totalFetched: number;
  totalInserted: number;
  totalVerified: number;
  errors: string[];
}> {
  const { verify = false, dryRun = false, fiscalYear = new Date().getFullYear() } = options;

  console.log(`[AgencyIntel] Starting full sync for FY${fiscalYear}...`);

  const allIntelligence: AgencyIntelligence[] = [];
  const errors: string[] = [];

  // Fetch from all sources
  try {
    console.log('[AgencyIntel] Fetching IT Dashboard data...');
    const itData = await fetchITInvestments({ fiscalYear, dryRun });
    allIntelligence.push(...itData);
  } catch (error) {
    errors.push(`IT Dashboard: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  try {
    console.log('[AgencyIntel] Fetching USASpending data...');
    const spendingData = await fetchAgencySpendingPatterns({ fiscalYear, dryRun });
    allIntelligence.push(...spendingData);
  } catch (error) {
    errors.push(`USASpending: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  try {
    console.log('[AgencyIntel] Fetching GovInfo GAO reports...');
    const gaoData = await fetchGAOReports({ fiscalYear, dryRun });
    allIntelligence.push(...gaoData);
  } catch (error) {
    errors.push(`GovInfo: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  console.log(`[AgencyIntel] Fetched ${allIntelligence.length} total items`);

  // Quick verify all items (source URL + date check)
  const quickVerified = allIntelligence.filter(i => quickVerify(i));
  console.log(`[AgencyIntel] ${quickVerified.length} items passed quick verification`);

  // Full verification with Perplexity (if enabled)
  let verifiedCount = 0;
  if (verify && !dryRun) {
    console.log('[AgencyIntel] Running Perplexity verification...');
    const verificationResults = await batchVerify(quickVerified.slice(0, 50), {
      concurrency: 2,
      delayMs: 1000,
    });
    verifiedCount = verificationResults.filter(r => r.verification.verified).length;
  }

  // Store in database
  let insertedCount = 0;
  if (!dryRun) {
    insertedCount = await storeIntelligence(allIntelligence);
  }

  return {
    totalFetched: allIntelligence.length,
    totalInserted: insertedCount,
    totalVerified: verifiedCount,
    errors,
  };
}

/**
 * Store intelligence in Supabase
 */
async function storeIntelligence(items: AgencyIntelligence[]): Promise<number> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[AgencyIntel] Missing Supabase credentials');
    return 0;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let insertedCount = 0;

  // Batch insert
  const batchSize = 50;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const { error, count } = await supabase
      .from('agency_intelligence')
      .upsert(
        batch.map(item => ({
          agency_name: item.agency_name,
          agency_code: item.agency_code,
          parent_agency: item.parent_agency,
          intelligence_type: item.intelligence_type,
          title: item.title,
          description: item.description,
          keywords: item.keywords,
          fiscal_year: item.fiscal_year,
          source_name: item.source_name,
          source_url: item.source_url,
          source_document: item.source_document,
          publication_date: item.publication_date,
          verified: item.verified || false,
          verified_at: item.verified_at,
          verification_source: item.verification_source,
          verification_notes: item.verification_notes,
          updated_at: new Date().toISOString(),
        })),
        {
          onConflict: 'agency_name,intelligence_type,title',
          ignoreDuplicates: false,
        }
      );

    if (error) {
      console.error('[AgencyIntel] Insert error:', error.message);
    } else {
      insertedCount += count || batch.length;
    }
  }

  console.log(`[AgencyIntel] Inserted/updated ${insertedCount} records`);
  return insertedCount;
}

/**
 * Get intelligence for a specific agency
 */
export async function getAgencyIntelligence(
  agencyName: string,
  types?: string[]
): Promise<AgencyIntelligence[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return [];
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let query = supabase
    .from('agency_intelligence')
    .select('*')
    .or(`agency_name.ilike.%${agencyName}%,parent_agency.ilike.%${agencyName}%`)
    .order('updated_at', { ascending: false });

  if (types && types.length > 0) {
    query = query.in('intelligence_type', types);
  }

  const { data, error } = await query.limit(100);

  if (error) {
    console.error('[AgencyIntel] Query error:', error.message);
    return [];
  }

  return data || [];
}

/**
 * Get intelligence for briefing pipeline
 * Returns relevant intelligence based on user's agencies/NAICS
 */
export async function getIntelligenceForBriefing(
  agencies: string[],
  limit: number = 10
): Promise<AgencyIntelligence[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return [];
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Build agency filter
  const agencyPatterns = agencies.map(a => `%${a}%`);

  const { data, error } = await supabase
    .from('agency_intelligence')
    .select('*')
    .or(agencyPatterns.map(p => `agency_name.ilike.${p}`).join(','))
    .gte('fiscal_year', new Date().getFullYear() - 1)
    .order('verified', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[AgencyIntel] Briefing query error:', error.message);
    return [];
  }

  return data || [];
}

/**
 * Record a sync run
 */
export async function recordSyncRun(run: SyncRun): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) return;

  const supabase = createClient(supabaseUrl, supabaseKey);

  await supabase.from('intelligence_sync_runs').insert(run);
}

/**
 * Unified agency intelligence - combines static JSON + Supabase database
 * This is the recommended API for tools (Market Assassin, Content Generator, etc.)
 */
export interface UnifiedAgencyIntel {
  agencyName: string;
  painPoints: string[];
  priorities: string[];
  gaoReports: string[];       // From database (gao_high_risk type)
  spendingPatterns: string[]; // From database (contract_pattern type)
  sources: ('static' | 'database')[];
}

/**
 * Get unified intelligence for a specific agency
 * Combines static JSON with database records
 */
export async function getUnifiedAgencyIntelligence(
  agencyName: string
): Promise<UnifiedAgencyIntel | null> {
  const result: UnifiedAgencyIntel = {
    agencyName,
    painPoints: [],
    priorities: [],
    gaoReports: [],
    spendingPatterns: [],
    sources: [],
  };

  // 1. Check static JSON (exact match first, then partial)
  const staticAgency = findStaticAgency(agencyName);
  if (staticAgency) {
    result.painPoints.push(...staticAgency.painPoints);
    result.priorities.push(...staticAgency.priorities);
    result.sources.push('static');
  }

  // 2. Check database
  const dbRecords = await getAgencyIntelligence(agencyName);
  if (dbRecords.length > 0) {
    result.sources.push('database');

    for (const record of dbRecords) {
      if (record.intelligence_type === 'gao_high_risk') {
        const gaoEntry = `${record.title}`;
        if (!result.gaoReports.includes(gaoEntry)) {
          result.gaoReports.push(gaoEntry);
          // Also add to pain points if not already there
          const shortText = record.title.slice(0, 50);
          if (!result.painPoints.some(p => p.includes(shortText))) {
            result.painPoints.push(`${record.title} (Source: GAO)`);
          }
        }
      } else if (record.intelligence_type === 'contract_pattern') {
        const spendingEntry = record.description || record.title;
        if (!result.spendingPatterns.includes(spendingEntry)) {
          result.spendingPatterns.push(spendingEntry);
          // Also add to priorities if not already there
          const shortText = spendingEntry.slice(0, 50);
          if (!result.priorities.some(p => p.includes(shortText))) {
            result.priorities.push(spendingEntry);
          }
        }
      } else if (record.intelligence_type === 'budget_priority') {
        const priority = record.description || record.title;
        if (!result.priorities.some(p => p.includes(priority.slice(0, 50)))) {
          result.priorities.push(priority);
        }
      }
    }
  }

  // Return null if no data found
  if (result.sources.length === 0) {
    return null;
  }

  return result;
}

/**
 * Get all unique agency names from both sources
 */
export function getAllAgenciesList(): string[] {
  const agencies = new Set<string>();

  // Add from static JSON
  for (const agencyName of Object.keys(staticPainPoints.agencies)) {
    agencies.add(agencyName);
  }

  return Array.from(agencies).sort();
}

/**
 * Get pain points for an agency (unified)
 * Returns pain points from static JSON + GAO reports from database
 */
export async function getAgencyPainPointsUnified(
  agencyName: string,
  limit: number = 20
): Promise<string[]> {
  const intel = await getUnifiedAgencyIntelligence(agencyName);
  if (!intel) return [];

  // Dedupe and limit
  const uniquePainPoints = [...new Set(intel.painPoints)];
  return uniquePainPoints.slice(0, limit);
}

/**
 * Get priorities for an agency (unified)
 * Returns priorities from static JSON + spending patterns from database
 */
export async function getAgencyPrioritiesUnified(
  agencyName: string,
  limit: number = 20
): Promise<string[]> {
  const intel = await getUnifiedAgencyIntelligence(agencyName);
  if (!intel) return [];

  // Dedupe and limit
  const uniquePriorities = [...new Set(intel.priorities)];
  return uniquePriorities.slice(0, limit);
}

/**
 * Batch get unified intelligence for multiple agencies
 * Efficient for Content Generator and Market Assassin
 */
export async function getUnifiedIntelligenceForAgencies(
  agencyNames: string[]
): Promise<Map<string, UnifiedAgencyIntel>> {
  const results = new Map<string, UnifiedAgencyIntel>();

  // Parallel fetch
  const promises = agencyNames.map(async (name) => {
    const intel = await getUnifiedAgencyIntelligence(name);
    if (intel) {
      results.set(name, intel);
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Search agencies by keyword (searches name + pain points + priorities)
 */
export function searchAgencies(query: string, limit: number = 20): string[] {
  const queryLower = query.toLowerCase();
  const matches: { name: string; score: number }[] = [];

  for (const [agencyName, data] of Object.entries(staticPainPoints.agencies)) {
    let score = 0;

    // Name match (highest priority)
    if (agencyName.toLowerCase().includes(queryLower)) {
      score += 100;
    }

    // Pain points match
    const painPointMatches = data.painPoints.filter(p =>
      p.toLowerCase().includes(queryLower)
    ).length;
    score += painPointMatches * 10;

    // Priorities match
    const priorityMatches = data.priorities.filter(p =>
      p.toLowerCase().includes(queryLower)
    ).length;
    score += priorityMatches * 5;

    if (score > 0) {
      matches.push({ name: agencyName, score });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return matches.slice(0, limit).map(m => m.name);
}

/**
 * Helper: Find agency in static JSON (handles variations in naming)
 */
function findStaticAgency(agencyName: string): { painPoints: string[]; priorities: string[] } | null {
  // Exact match first
  if (staticPainPoints.agencies[agencyName]) {
    return staticPainPoints.agencies[agencyName];
  }

  // Try lowercase comparison
  const nameLower = agencyName.toLowerCase();
  for (const [key, value] of Object.entries(staticPainPoints.agencies)) {
    if (key.toLowerCase() === nameLower) {
      return value;
    }
  }

  // Try partial match (e.g., "VA" matches "Department of Veterans Affairs")
  for (const [key, value] of Object.entries(staticPainPoints.agencies)) {
    if (
      key.toLowerCase().includes(nameLower) ||
      nameLower.includes(key.toLowerCase())
    ) {
      return value;
    }
  }

  return null;
}

/**
 * Get stats about the unified intelligence system
 */
export function getIntelligenceStats(): {
  staticAgencyCount: number;
  staticPainPointCount: number;
  staticPriorityCount: number;
} {
  let painPointCount = 0;
  let priorityCount = 0;

  for (const data of Object.values(staticPainPoints.agencies)) {
    painPointCount += data.painPoints.length;
    priorityCount += data.priorities.length;
  }

  return {
    staticAgencyCount: Object.keys(staticPainPoints.agencies).length,
    staticPainPointCount: painPointCount,
    staticPriorityCount: priorityCount,
  };
}

export default {
  syncAllSources,
  getAgencyIntelligence,
  getIntelligenceForBriefing,
  recordSyncRun,
  fetchers,
  // Unified API (recommended)
  getUnifiedAgencyIntelligence,
  getAllAgenciesList,
  getAgencyPainPointsUnified,
  getAgencyPrioritiesUnified,
  getUnifiedIntelligenceForAgencies,
  searchAgencies,
  getIntelligenceStats,
};
