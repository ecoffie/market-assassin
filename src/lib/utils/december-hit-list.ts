// December Hit List - Low Competition Contracts Database and Utilities
import decemberHitListData from '@/data/december-hit-list.json';
import { CoreInputs } from '@/types/federal-market-assassin';

export interface HitListOpportunity {
  id: string;
  rank: number;
  title: string;
  noticeId?: string;
  deadline?: string;
  type: string;
  naics: string;
  setAside: string;
  isUrgent: boolean;
  description: string;
  poc?: string;
  link: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  source?: 'curated' | 'usaspending';
  agency?: string;
  amount?: number;
  awardDate?: string;
  competitionLevel?: 'low' | 'medium' | 'high';
  winProbability?: 'high' | 'medium' | 'low';
  generatedInternalId?: string | null;
}

interface HitListDatabase {
  metadata: {
    title: string;
    description: string;
    generatedAt: string;
    totalOpportunities: number;
    source: string;
    targetNaics: string[];
  };
  opportunities: HitListOpportunity[];
}

const hitListDB = decemberHitListData as HitListDatabase;

/**
 * Get all hit list opportunities
 */
export function getAllHitListOpportunities(): HitListOpportunity[] {
  return hitListDB.opportunities;
}

/**
 * Get hit list metadata
 */
export function getHitListMetadata() {
  return hitListDB.metadata;
}

/**
 * Filter opportunities by NAICS code
 */
export function getHitListByNAICS(naicsCode: string): HitListOpportunity[] {
  const naicsPrefix = naicsCode.substring(0, 3);
  return hitListDB.opportunities.filter(opp => {
    const oppNaics = opp.naics || '';
    return oppNaics === naicsCode ||
           oppNaics.startsWith(naicsPrefix) ||
           naicsCode.startsWith(oppNaics.substring(0, 3));
  });
}

/**
 * Filter opportunities by business type (set-aside)
 */
export function getHitListBySetAside(businessType: string): HitListOpportunity[] {
  const lowerBusinessType = businessType.toLowerCase();

  // Map business types to set-aside keywords
  const setAsideKeywords: Record<string, string[]> = {
    '8(a)': ['8(a)', '8a'],
    'sdvosb': ['sdvosb', 'service-disabled veteran'],
    'wosb': ['wosb', 'women-owned'],
    'hubzone': ['hubzone'],
    'small business': ['small business', 'total small'],
  };

  const keywords = setAsideKeywords[lowerBusinessType] || [lowerBusinessType];

  return hitListDB.opportunities.filter(opp => {
    const lowerSetAside = opp.setAside.toLowerCase();
    return keywords.some(keyword => lowerSetAside.includes(keyword));
  });
}

/**
 * Get urgent opportunities (deadline within 7 days or marked urgent)
 */
export function getUrgentHitListOpportunities(): HitListOpportunity[] {
  return hitListDB.opportunities.filter(opp => opp.isUrgent || opp.priority === 'high');
}

/**
 * Get opportunities matching core inputs
 * Returns only curated opportunities that match the user's NAICS code
 * Returns empty array if no matches (so we don't show unrelated opportunities)
 */
export function getHitListByCoreInputs(inputs: CoreInputs): HitListOpportunity[] {
  // If NAICS is provided, only return matching opportunities
  // Don't fall back to showing all opportunities if none match
  if (inputs.naicsCode) {
    let opportunities = getHitListByNAICS(inputs.naicsCode);

    // If we have matches, also filter by business type if provided
    if (opportunities.length > 0 && inputs.businessType) {
      const setAsideFiltered = getHitListBySetAside(inputs.businessType);
      if (setAsideFiltered.length > 0) {
        opportunities = opportunities.filter(opp =>
          setAsideFiltered.some(filtered => filtered.id === opp.id)
        );
      }
    }

    // Sort and return matching opportunities
    return opportunities.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const aPriority = priorityOrder[a.priority];
      const bPriority = priorityOrder[b.priority];
      if (aPriority !== bPriority) return bPriority - aPriority;
      if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
      return a.rank - b.rank;
    });
  }

  // No NAICS provided - return all opportunities
  let opportunities = getAllHitListOpportunities();

  // Filter by business type if provided
  if (inputs.businessType) {
    const setAsideFiltered = getHitListBySetAside(inputs.businessType);
    if (setAsideFiltered.length > 0) {
      opportunities = opportunities.filter(opp =>
        setAsideFiltered.some(filtered => filtered.id === opp.id)
      );
    }
  }

  // Sort by priority and deadline urgency
  return opportunities.sort((a, b) => {
    // Priority: high > medium > low
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    const aPriority = priorityOrder[a.priority];
    const bPriority = priorityOrder[b.priority];

    if (aPriority !== bPriority) {
      return bPriority - aPriority;
    }

    // Then by urgency flag
    if (a.isUrgent !== b.isUrgent) {
      return a.isUrgent ? -1 : 1;
    }

    // Then by rank (lower rank = better)
    return a.rank - b.rank;
  });
}

/**
 * Calculate days until deadline
 */
export function getDaysUntilDeadline(deadline: string | undefined): number | null {
  if (!deadline) return null;
  try {
    // Parse deadline format: "Dec 15, 2025 01:00 PM EST"
    const deadlineDate = new Date(deadline);
    const now = new Date();
    const diffTime = deadlineDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  } catch {
    return null;
  }
}

/**
 * Get urgency badge info based on deadline
 */
export function getUrgencyBadge(opportunity: HitListOpportunity): {
  text: string;
  color: string;
} {
  const daysUntil = getDaysUntilDeadline(opportunity.deadline);

  if (opportunity.isUrgent || (daysUntil !== null && daysUntil <= 3)) {
    return { text: 'URGENT', color: 'red' };
  } else if (daysUntil !== null && daysUntil <= 7) {
    return { text: 'HIGH PRIORITY', color: 'orange' };
  } else if (opportunity.priority === 'high') {
    return { text: 'HIGH PRIORITY', color: 'orange' };
  } else {
    return { text: 'LOW COMPETITION', color: 'green' };
  }
}

/**
 * Generate action strategy for hit list opportunity
 */
export function getHitListActionStrategy(
  opportunity: HitListOpportunity,
  inputs: CoreInputs
): string {
  const strategies: string[] = [];
  const daysUntil = getDaysUntilDeadline(opportunity.deadline);

  // Deadline urgency
  if (daysUntil !== null) {
    if (daysUntil <= 3) {
      strategies.push(`IMMEDIATE ACTION REQUIRED - ${daysUntil} days until deadline`);
    } else if (daysUntil <= 7) {
      strategies.push(`Act fast - ${daysUntil} days until deadline`);
    } else {
      strategies.push(`Deadline in ${daysUntil} days`);
    }
  }

  // POC contact
  if (opportunity.poc) {
    strategies.push(`Contact POC: ${opportunity.poc}`);
  }

  // Set-aside advantage
  if (opportunity.setAside && opportunity.setAside !== 'Unrestricted') {
    strategies.push(`Set-aside: ${opportunity.setAside} - leverage your certification`);
  }

  // Low competition emphasis
  strategies.push('Low competition opportunity - higher win probability');

  // NAICS match
  if (inputs.naicsCode && opportunity.naics) {
    const naicsMatch = opportunity.naics.startsWith(inputs.naicsCode.substring(0, 3));
    if (naicsMatch) {
      strategies.push(`Strong NAICS match (${opportunity.naics})`);
    }
  }

  // SAM.gov link
  strategies.push(`Review full solicitation at SAM.gov`);

  return strategies.join('. ') + '.';
}

/**
 * Get hit list statistics
 */
export function getHitListStats(): {
  total: number;
  urgent: number;
  setAsides: Record<string, number>;
  averageDaysUntilDeadline: number;
} {
  const opportunities = getAllHitListOpportunities();

  const stats = {
    total: opportunities.length,
    urgent: opportunities.filter(o => o.isUrgent).length,
    setAsides: {} as Record<string, number>,
    averageDaysUntilDeadline: 0,
  };

  // Count set-asides
  opportunities.forEach(opp => {
    const setAside = opp.setAside || 'Unrestricted';
    stats.setAsides[setAside] = (stats.setAsides[setAside] || 0) + 1;
  });

  // Calculate average days until deadline (only for curated opportunities with deadlines)
  const deadlines = opportunities
    .filter(o => o.deadline) // Only opportunities with deadlines
    .map(o => getDaysUntilDeadline(o.deadline))
    .filter((d): d is number => d !== null);

  if (deadlines.length > 0) {
    stats.averageDaysUntilDeadline = Math.round(
      deadlines.reduce((sum, d) => sum + d, 0) / deadlines.length
    );
  }

  return stats;
}

/**
 * Fetch dynamic hit list opportunities from USAspending API
 * Includes retry logic for transient network failures
 */
export async function fetchDynamicHitList(inputs: CoreInputs): Promise<HitListOpportunity[]> {
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch('/api/usaspending/find-hit-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs),
      });

      if (!response.ok) {
        if (attempt < maxRetries) {
          console.warn(`Hit list fetch attempt ${attempt + 1} failed, retrying...`);
          continue;
        }
        console.error('Failed to fetch dynamic hit list after retries');
        return [];
      }

      const data = await response.json();

      if (!data.success || !data.opportunities) {
        return [];
      }

      // Transform USAspending results to HitListOpportunity format
      return data.opportunities.map((opp: any, index: number) => {
        // Use generatedInternalId for the URL (e.g., CONT_AWD_ZN31_9700_W91QUZ06D0004_9700)
        // This is the correct format for USAspending award pages: /award/{generated_internal_id}
        const awardIdForUrl = opp.generatedInternalId || opp.id;
        return {
          id: opp.id || `dynamic-${index}`,
          rank: index + 100, // Start ranking after curated list
          title: opp.title || 'Contract Opportunity',
          noticeId: opp.id,
          deadline: '', // Historical awards don't have future deadlines
          type: 'Award',
          naics: opp.naics || inputs.naicsCode || '',
          setAside: opp.setAside || 'Unrestricted',
          isUrgent: false, // Historical awards are not urgent
          description: opp.description || 'Historical contract award in your NAICS code',
          poc: opp.contractingOfficeName || '',
          link: `https://www.usaspending.gov/award/${awardIdForUrl}`,
          category: 'low-competition',
          priority: opp.winProbability === 'high' ? 'high' as const :
                   opp.winProbability === 'medium' ? 'medium' as const : 'low' as const,
          source: 'usaspending' as const,
          agency: opp.agency,
          amount: opp.amount,
          awardDate: opp.awardDate,
          competitionLevel: opp.competitionLevel,
          winProbability: opp.winProbability,
          generatedInternalId: opp.generatedInternalId,
        };
      });
    } catch (error) {
      if (attempt < maxRetries) {
        console.warn(`Hit list fetch attempt ${attempt + 1} failed with error, retrying...`);
        continue;
      }
      console.error('Error fetching dynamic hit list after retries:', error);
      return [];
    }
  }

  return []; // Return empty array if all retries exhausted
}

/**
 * Get combined hit list: curated + dynamic opportunities
 */
export async function getCombinedHitList(inputs: CoreInputs): Promise<HitListOpportunity[]> {
  // Get curated opportunities
  const curatedOpps = getHitListByCoreInputs(inputs).map(opp => ({
    ...opp,
    source: 'curated' as const,
  }));

  // Fetch dynamic opportunities from USAspending
  const dynamicOpps = await fetchDynamicHitList(inputs);

  // Combine and sort: curated first (they have deadlines), then dynamic
  const combined = [
    ...curatedOpps, // Curated opportunities with active deadlines
    ...dynamicOpps.slice(0, 50), // Top 50 dynamic opportunities
  ];

  return combined;
}
