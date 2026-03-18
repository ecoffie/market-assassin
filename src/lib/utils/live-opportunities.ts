/**
 * Live Opportunities Utility
 *
 * Fetches and manages live SAM.gov opportunities for Market Assassin
 */

import { CoreInputs } from '@/types/federal-market-assassin';

export interface LiveOpportunity {
  id: string;
  title: string;
  agency: string;
  office: string;
  naics: string;
  setAside: string | null;
  setAsideDescription: string | null;
  postedDate: string;
  responseDeadline: string | null;
  daysUntilDeadline: number | null;
  noticeType: string;
  description: string;
  uiLink: string;
  urgency: 'urgent' | 'high' | 'medium' | 'low';
  source: 'sam.gov';
}

export interface LiveOpportunitiesStats {
  total: number;
  urgent: number;
  dueThisWeek: number;
  setAsides: number;
}

export interface LiveOpportunitiesResponse {
  success: boolean;
  opportunities: LiveOpportunity[];
  stats: LiveOpportunitiesStats;
  metadata: {
    searchCriteria: {
      naicsCode: string;
      businessType: string;
      postedWithin: string;
      types: string;
    };
    fetchedAt: string;
    source: string;
  };
  error?: string;
}

/**
 * Fetch live opportunities from SAM.gov
 */
export async function fetchLiveOpportunities(
  inputs: CoreInputs
): Promise<LiveOpportunitiesResponse> {
  try {
    const response = await fetch('/api/sam/live-opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputs),
    });

    if (!response.ok) {
      console.error('[Live Opps] API error:', response.status);
      return {
        success: false,
        opportunities: [],
        stats: { total: 0, urgent: 0, dueThisWeek: 0, setAsides: 0 },
        metadata: {
          searchCriteria: { naicsCode: '', businessType: '', postedWithin: '', types: '' },
          fetchedAt: new Date().toISOString(),
          source: 'SAM.gov',
        },
        error: `API error: ${response.status}`,
      };
    }

    return await response.json();
  } catch (error) {
    console.error('[Live Opps] Fetch error:', error);
    return {
      success: false,
      opportunities: [],
      stats: { total: 0, urgent: 0, dueThisWeek: 0, setAsides: 0 },
      metadata: {
        searchCriteria: { naicsCode: '', businessType: '', postedWithin: '', types: '' },
        fetchedAt: new Date().toISOString(),
        source: 'SAM.gov',
      },
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get urgency badge styling and text
 */
export function getUrgencyBadge(opp: LiveOpportunity): {
  text: string;
  color: 'red' | 'orange' | 'yellow' | 'green';
  bgClass: string;
  textClass: string;
} {
  switch (opp.urgency) {
    case 'urgent':
      return {
        text: 'URGENT',
        color: 'red',
        bgClass: 'bg-red-500/20 border border-red-500/30',
        textClass: 'text-red-400',
      };
    case 'high':
      return {
        text: 'DUE SOON',
        color: 'orange',
        bgClass: 'bg-amber-500/20 border border-amber-500/30',
        textClass: 'text-amber-400',
      };
    case 'medium':
      return {
        text: '2 WEEKS',
        color: 'yellow',
        bgClass: 'bg-yellow-500/20 border border-yellow-500/30',
        textClass: 'text-yellow-400',
      };
    default:
      return {
        text: 'OPEN',
        color: 'green',
        bgClass: 'bg-emerald-500/20 border border-emerald-500/30',
        textClass: 'text-emerald-400',
      };
  }
}

/**
 * Format deadline for display
 */
export function formatDeadline(deadline: string | null, daysUntil: number | null): string {
  if (!deadline) return 'No deadline specified';

  if (daysUntil === null) return deadline;

  if (daysUntil < 0) return 'Expired';
  if (daysUntil === 0) return 'Due today!';
  if (daysUntil === 1) return 'Due tomorrow!';
  if (daysUntil <= 7) return `${daysUntil} days left`;

  // Format date nicely
  try {
    const date = new Date(deadline);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return deadline;
  }
}
