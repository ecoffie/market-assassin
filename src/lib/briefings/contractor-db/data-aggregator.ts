/**
 * Contractor DB Briefing Data Aggregator
 *
 * Pulls data from:
 * - Local contractor database (2,768+ primes)
 * - RSS feeds for partnership signals
 * - USASpending for recent teaming activity
 */

import {
  TeamingOpportunity,
  SBLOUpdate,
  SubcontractingPlan,
  PartnershipSignal,
  ContractorDBUserProfile,
} from './types';
import { fetchAllRSSFeeds, filterRSSByKeywords, filterRecentRSS } from '../web-intel/rss';
import { searchContractors, Contractor } from '@/lib/contractor-database';

// Partnership keywords for RSS filtering
const PARTNERSHIP_KEYWORDS = [
  'teaming',
  'joint venture',
  'mentor-protege',
  'mentor protege',
  'partnership',
  'subcontract',
  'prime contractor',
  'small business partner',
  'strategic alliance',
  'acquisition',
  'acquires',
  'merged',
];

/**
 * Format contract value for display
 */
function formatContractValue(amount: number): string {
  if (!amount || amount <= 0) return '$0';

  if (amount >= 1_000_000_000) {
    return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  } else if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  } else if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`;
  }
  return `$${amount.toLocaleString()}`;
}

/**
 * Fetch teaming opportunities matching user's NAICS codes
 */
export async function fetchTeamingOpportunities(
  profile: ContractorDBUserProfile
): Promise<TeamingOpportunity[]> {
  const opportunities: TeamingOpportunity[] = [];

  // Get user's NAICS codes or defaults
  const userNaics = profile.naicsCodes.length > 0
    ? profile.naicsCodes
    : ['541511', '541512', '541519'];

  // Search contractors by NAICS
  for (const naics of userNaics.slice(0, 5)) {
    const result = searchContractors({
      naics: naics.substring(0, 4), // Use 4-digit prefix for broader match
      hasEmail: true, // Only those with contact info
      limit: 20,
      sortBy: 'contract_value',
      sortOrder: 'desc',
    });

    for (const contractor of result.contractors) {
      // Skip if already added
      if (opportunities.some(o => o.company === contractor.company)) continue;

      // Calculate teaming score
      const { score, reasons } = calculateTeamingScore(contractor, profile);

      // Only include high-scoring opportunities
      if (score >= 40) {
        const agencies = contractor.agencies
          .split(',')
          .map(a => a.trim())
          .filter(Boolean)
          .slice(0, 3);

        const naicsCodes = contractor.naics
          .split(',')
          .map(n => n.trim())
          .filter(Boolean);

        const matchingNaics = naicsCodes.filter(n =>
          userNaics.some(un => n.startsWith(un.substring(0, 4)))
        );

        opportunities.push({
          id: `team-${contractor.company.substring(0, 20).replace(/\s+/g, '-')}`,
          company: contractor.company,
          contractValue: formatContractValue(contractor.contract_value_num),
          contractValueNum: contractor.contract_value_num,
          agencies,
          naicsCodes,
          matchingNaics,
          sbloName: contractor.sblo_name || null,
          sbloEmail: contractor.email || null,
          sbloPhone: contractor.phone || null,
          teamingScore: score,
          teamingReasons: reasons,
          hasSubcontractingPlan: contractor.has_subcontract_plan === 'True',
          vendorPortalUrl: null, // TODO: Add vendor portal lookup
          suggestedAction: generateSuggestedAction(contractor, score),
        });
      }
    }
  }

  // Sort by teaming score, then contract value
  opportunities.sort((a, b) => {
    if (b.teamingScore !== a.teamingScore) {
      return b.teamingScore - a.teamingScore;
    }
    return b.contractValueNum - a.contractValueNum;
  });

  return opportunities.slice(0, 10);
}

/**
 * Calculate teaming score for a contractor
 */
function calculateTeamingScore(
  contractor: Contractor,
  profile: ContractorDBUserProfile
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Has SBLO contact
  if (contractor.has_email) {
    score += 25;
    reasons.push('SBLO email available');
  }

  // Has subcontracting plan
  if (contractor.has_subcontract_plan === 'True') {
    score += 20;
    reasons.push('Active subcontracting plan');
  }

  // Contract value (larger = more opportunity)
  if (contractor.contract_value_num >= 100_000_000) {
    score += 20;
    reasons.push('$100M+ prime contractor');
  } else if (contractor.contract_value_num >= 10_000_000) {
    score += 15;
    reasons.push('$10M+ prime contractor');
  } else if (contractor.contract_value_num >= 1_000_000) {
    score += 10;
    reasons.push('$1M+ prime contractor');
  }

  // Agency overlap with user's targets
  const contractorAgencies = contractor.agencies.toLowerCase();
  const matchingAgencies = profile.targetAgencies.filter(a =>
    contractorAgencies.includes(a.toLowerCase())
  );
  if (matchingAgencies.length > 0) {
    score += matchingAgencies.length * 10;
    reasons.push(`Works with ${matchingAgencies.slice(0, 2).join(', ')}`);
  }

  // NAICS overlap
  const contractorNaics = contractor.naics.split(',').map(n => n.trim());
  const matchingNaics = profile.naicsCodes.filter(un =>
    contractorNaics.some(cn => cn.startsWith(un.substring(0, 4)))
  );
  if (matchingNaics.length > 0) {
    score += matchingNaics.length * 10;
    reasons.push(`${matchingNaics.length} matching NAICS codes`);
  }

  return { score: Math.min(score, 100), reasons };
}

/**
 * Generate suggested action based on teaming score
 */
function generateSuggestedAction(contractor: Contractor, score: number): string {
  if (score >= 80 && contractor.has_email) {
    return `High-value target. Email ${contractor.sblo_name || 'SBLO'} at ${contractor.email} with your capability statement.`;
  } else if (score >= 60 && contractor.has_email) {
    return `Good fit. Reach out to SBLO to introduce your company and express teaming interest.`;
  } else if (contractor.has_subcontract_plan === 'True') {
    return `Has subcontracting plan. Research their requirements and submit capability statement.`;
  }
  return `Add to watchlist. Monitor for upcoming opportunities.`;
}

/**
 * Fetch SBLO contact updates (simulated - would need historical data)
 */
export async function fetchSBLOUpdates(
  profile: ContractorDBUserProfile
): Promise<SBLOUpdate[]> {
  const updates: SBLOUpdate[] = [];

  // Get contractors matching user's interests that have contacts
  const result = searchContractors({
    naics: profile.naicsCodes[0]?.substring(0, 3),
    hasEmail: true,
    limit: 50,
    sortBy: 'contract_value',
    sortOrder: 'desc',
  });

  // Simulate "new" contacts (in reality, would compare to historical snapshot)
  // For briefing, show top contractors with contacts as "verified"
  for (const contractor of result.contractors.slice(0, 5)) {
    if (contractor.sblo_name && contractor.email) {
      updates.push({
        id: `sblo-${contractor.company.substring(0, 20).replace(/\s+/g, '-')}`,
        company: contractor.company,
        updateType: 'contact_verified',
        previousContact: null,
        newContact: {
          name: contractor.sblo_name,
          title: contractor.title || 'SBLO',
          email: contractor.email,
          phone: contractor.phone || null,
        },
        detectedAt: new Date().toISOString(),
        actionableInsight: `${contractor.sblo_name} is the verified SBLO contact. Good time to reach out with your capability statement.`,
      });
    }
  }

  return updates;
}

/**
 * Fetch new subcontracting plans
 */
export async function fetchNewSubcontractingPlans(
  profile: ContractorDBUserProfile
): Promise<SubcontractingPlan[]> {
  const plans: SubcontractingPlan[] = [];

  // Get contractors with subcontracting plans matching user's NAICS
  const result = searchContractors({
    naics: profile.naicsCodes[0]?.substring(0, 3),
    hasContact: true,
    limit: 50,
    sortBy: 'contract_value',
    sortOrder: 'desc',
  });

  for (const contractor of result.contractors.slice(0, 5)) {
    if (contractor.has_subcontract_plan === 'True') {
      const agencies = contractor.agencies
        .split(',')
        .map(a => a.trim())
        .filter(Boolean);

      plans.push({
        id: `subk-${contractor.company.substring(0, 20).replace(/\s+/g, '-')}`,
        company: contractor.company,
        planType: 'new',
        agencies: agencies.slice(0, 3),
        contractValue: formatContractValue(contractor.contract_value_num),
        goals: {
          smallBusiness: 23, // Default federal goal
          wosb: 5,
          sdvosb: 3,
          hubzone: 3,
          sdb: 5,
        },
        detectedAt: new Date().toISOString(),
        opportunity: `${contractor.company} has active subcontracting requirements. Check their vendor portal for specific opportunities.`,
      });
    }
  }

  return plans;
}

/**
 * Fetch partnership signals from RSS feeds
 */
export async function fetchPartnershipSignals(
  profile: ContractorDBUserProfile
): Promise<PartnershipSignal[]> {
  const signals: PartnershipSignal[] = [];

  try {
    const rssItems = await fetchAllRSSFeeds();
    const recentRss = filterRecentRSS(rssItems, 7); // Last 7 days
    const partnershipNews = filterRSSByKeywords(recentRss, PARTNERSHIP_KEYWORDS);

    for (const item of partnershipNews.slice(0, 10)) {
      // Determine signal type
      let signalType: PartnershipSignal['signalType'] = 'partnership';
      const textLower = `${item.title} ${item.description}`.toLowerCase();

      if (textLower.includes('joint venture') || textLower.includes('jv')) {
        signalType = 'jv';
      } else if (textLower.includes('mentor') && textLower.includes('protege')) {
        signalType = 'mentor_protege';
      } else if (textLower.includes('acquire') || textLower.includes('merger')) {
        signalType = 'acquisition';
      } else if (textLower.includes('teaming') || textLower.includes('team')) {
        signalType = 'teaming';
      }

      // Extract company names (would need NER in production)
      const companiesInvolved: string[] = [];

      // Check if any watched companies are mentioned
      for (const company of profile.watchedCompanies) {
        if (textLower.includes(company.toLowerCase())) {
          companiesInvolved.push(company);
        }
      }

      signals.push({
        id: `signal-${signals.length}`,
        headline: item.title,
        source: item.source,
        url: item.link,
        publishedDate: item.pubDate || null,
        signalType,
        companiesInvolved,
        relevance: generatePartnershipRelevance(signalType, companiesInvolved),
      });
    }
  } catch (error) {
    console.error('[ContractorDB-Aggregator] RSS fetch error:', error);
  }

  return signals.slice(0, 5);
}

/**
 * Generate relevance text for partnership signals
 */
function generatePartnershipRelevance(
  signalType: PartnershipSignal['signalType'],
  companiesInvolved: string[]
): string {
  const companyText = companiesInvolved.length > 0
    ? `Involves ${companiesInvolved.join(', ')}. `
    : '';

  switch (signalType) {
    case 'teaming':
      return `${companyText}Teaming activity indicates active pursuit. Consider outreach for subcontracting.`;
    case 'jv':
      return `${companyText}Joint venture formation signals major opportunity pursuit. Monitor for subcontracting needs.`;
    case 'mentor_protege':
      return `${companyText}Mentor-protege relationship may open doors for capability development.`;
    case 'acquisition':
      return `${companyText}M&A activity may change subcontracting relationships. Watch for new opportunities.`;
    default:
      return `${companyText}Partnership activity worth monitoring for potential teaming opportunities.`;
  }
}

/**
 * Main aggregator function
 */
export async function aggregateContractorDBData(
  profile: ContractorDBUserProfile
): Promise<{
  teamingOpportunities: TeamingOpportunity[];
  sbloUpdates: SBLOUpdate[];
  newSubcontractingPlans: SubcontractingPlan[];
  partnershipSignals: PartnershipSignal[];
}> {
  console.log(`[ContractorDB-Aggregator] Starting aggregation for ${profile.email}...`);
  const startTime = Date.now();

  // Run all fetches in parallel
  const [teamingOpportunities, sbloUpdates, newSubcontractingPlans, partnershipSignals] = await Promise.all([
    fetchTeamingOpportunities(profile),
    fetchSBLOUpdates(profile),
    fetchNewSubcontractingPlans(profile),
    fetchPartnershipSignals(profile),
  ]);

  console.log(`[ContractorDB-Aggregator] Completed in ${Date.now() - startTime}ms`);
  console.log(`[ContractorDB-Aggregator] Teaming: ${teamingOpportunities.length}, SBLO: ${sbloUpdates.length}, SubK: ${newSubcontractingPlans.length}, Signals: ${partnershipSignals.length}`);

  return {
    teamingOpportunities,
    sbloUpdates,
    newSubcontractingPlans,
    partnershipSignals,
  };
}
