/**
 * Briefing Generator
 *
 * Orchestrates all data pipelines and formats the final briefing.
 */

import { createClient } from '@supabase/supabase-js';
import {
  GeneratedBriefing,
  BriefingSummary,
  BriefingSection,
  BriefingItemFormatted,
  QuickStat,
} from './types';
import {
  generateBriefingDiff,
  BriefingItem,
  UserBriefingProfile,
} from '../diff-engine';
import { WebSignal } from '../web-intel/types';
import { SAMOpportunity } from '../pipelines/sam-gov';
import { RecompeteContract } from '../pipelines/fpds-recompete';
import { ContractAward } from '../pipelines/contract-awards';
import { ContractorRecord } from '../pipelines/contractor-db';

const MAX_TOP_ITEMS = 5;
const MAX_PER_CATEGORY = 3;

const CATEGORY_ICONS: Record<string, string> = {
  new_opportunity: '🎯',
  deadline_alert: '⏰',
  amendment: '📝',
  new_award: '🏆',
  competitor_win: '⚔️',
  recompete_alert: '🔄',
  timeline_change: '📅',
  teaming_signal: '🤝',
  sblo_update: '📋',
  certification_change: '📜',
  spending_shift: '💰',
  web_signal: '🌐',
};

const CATEGORY_TITLES: Record<string, string> = {
  new_opportunity: 'New Opportunities',
  deadline_alert: 'Deadline Alerts',
  amendment: 'Amendments',
  new_award: 'Contract Awards',
  competitor_win: 'Competitor Activity',
  recompete_alert: 'Recompete Opportunities',
  timeline_change: 'Timeline Changes',
  teaming_signal: 'Teaming Signals',
  sblo_update: 'SBLO Updates',
  certification_change: 'Certification Changes',
  spending_shift: 'Spending Shifts',
  web_signal: 'Web Intelligence',
};

/**
 * Generate a briefing for a user
 */
export async function generateBriefing(
  userEmail: string,
  options: {
    includeWebIntel?: boolean;
    maxItems?: number;
  } = {}
): Promise<GeneratedBriefing | null> {
  const startTime = Date.now();
  const supabase = getSupabaseClient();

  if (!supabase) {
    console.error('[BriefingGen] Supabase not configured');
    return null;
  }

  const briefingDate = new Date().toISOString().split('T')[0];

  try {
    // Step 1: Get user profile
    const { data: profileData } = await supabase
      .from('user_briefing_profile')
      .select('aggregated_profile')
      .eq('user_email', userEmail)
      .single();

    if (!profileData?.aggregated_profile) {
      console.log(`[BriefingGen] No profile for ${userEmail}`);
      return null;
    }

    const userProfile = buildUserProfile(profileData.aggregated_profile);

    // Step 2: Get today's and yesterday's snapshots
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const todayStr = today.toISOString().split('T')[0];
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const { data: snapshots } = await supabase
      .from('briefing_snapshots')
      .select('tool, raw_data, snapshot_date')
      .eq('user_email', userEmail)
      .in('snapshot_date', [todayStr, yesterdayStr]);

    // Organize snapshots by tool and date
    const snapshotsByTool = organizeSnapshots(snapshots || []);

    // Debug: log what we found
    console.log(`[BriefingGen] Snapshots found: ${snapshots?.length || 0}`);
    console.log(`[BriefingGen] Opportunities today: ${(snapshotsByTool.opportunities?.today || []).length}`);
    console.log(`[BriefingGen] Recompetes today: ${(snapshotsByTool.recompetes?.today || []).length}`);
    console.log(`[BriefingGen] Awards today: ${(snapshotsByTool.awards?.today || []).length}`);
    console.log(`[BriefingGen] Web signals today: ${(snapshotsByTool.webSignals?.today || []).length}`);

    // Step 3: Run diff engine
    const diffResult = generateBriefingDiff(
      {
        today: (snapshotsByTool.opportunities?.today || []) as SAMOpportunity[],
        yesterday: (snapshotsByTool.opportunities?.yesterday || []) as SAMOpportunity[],
      },
      {
        today: (snapshotsByTool.recompetes?.today || []) as RecompeteContract[],
        yesterday: (snapshotsByTool.recompetes?.yesterday || []) as RecompeteContract[],
      },
      {
        today: (snapshotsByTool.awards?.today || []) as ContractAward[],
        yesterday: (snapshotsByTool.awards?.yesterday || []) as ContractAward[],
      },
      {
        today: (snapshotsByTool.contractors?.today || []) as ContractorRecord[],
        yesterday: (snapshotsByTool.contractors?.yesterday || []) as ContractorRecord[],
      },
      userProfile,
      options.includeWebIntel !== false
        ? (snapshotsByTool.webSignals?.today as WebSignal[] | undefined)
        : undefined
    );

    // Debug: log diff result
    console.log(`[BriefingGen] Diff result items: ${diffResult.items.length}`);
    console.log(`[BriefingGen] Diff by source:`, diffResult.summary.bySource);
    console.log(`[BriefingGen] Diff by category:`, diffResult.summary.byCategory);

    // Step 4: Format the briefing
    const maxItems = options.maxItems || 15;
    const items = diffResult.items.slice(0, maxItems);

    const briefing = formatBriefing(
      userEmail,
      briefingDate,
      items,
      diffResult.summary,
      Date.now() - startTime
    );

    console.log(
      `[BriefingGen] Generated briefing for ${userEmail}: ${items.length} items in ${Date.now() - startTime}ms`
    );

    return briefing;
  } catch (error) {
    console.error(`[BriefingGen] Error generating briefing:`, error);
    return null;
  }
}

/**
 * Format items into a structured briefing
 */
function formatBriefing(
  userId: string,
  briefingDate: string,
  items: BriefingItem[],
  summary: {
    totalItems: number;
    bySource: Record<string, number>;
    byCategory: Record<string, number>;
    topAgencies: Array<{ agency: string; count: number }>;
  },
  processingTimeMs: number
): GeneratedBriefing {
  // Format top items
  const topItems: BriefingSection = {
    title: "Today's Top Intelligence",
    items: items.slice(0, MAX_TOP_ITEMS).map((item, idx) => formatItem(item, idx + 1)),
  };

  // Group by category
  const categorizedItems: Record<string, BriefingSection> = {};

  for (const item of items) {
    if (!categorizedItems[item.category]) {
      categorizedItems[item.category] = {
        title: CATEGORY_TITLES[item.category] || item.category,
        items: [],
      };
    }

    if (categorizedItems[item.category].items.length < MAX_PER_CATEGORY) {
      categorizedItems[item.category].items.push(
        formatItem(item, categorizedItems[item.category].items.length + 1)
      );
    }
  }

  // Generate summary
  const urgentCount = items.filter((i) => i.urgencyScore >= 80).length;

  const briefingSummary: BriefingSummary = {
    headline: generateHeadline(items, summary),
    subheadline: generateSubheadline(summary),
    quickStats: generateQuickStats(items, summary),
    urgentAlerts: urgentCount,
  };

  return {
    id: `briefing-${userId}-${briefingDate}`,
    userId,
    generatedAt: new Date().toISOString(),
    briefingDate,

    summary: briefingSummary,
    topItems: [topItems],
    categorizedItems,

    totalItems: items.length,
    sourcesIncluded: Object.keys(summary.bySource),
    processingTimeMs,
  };
}

/**
 * Format a single briefing item
 */
function formatItem(item: BriefingItem, rank: number): BriefingItemFormatted {
  return {
    id: item.id,
    rank,
    category: item.category,
    categoryIcon: CATEGORY_ICONS[item.category] || '📋',
    title: item.title,
    subtitle: item.subtitle,
    description: truncate(item.description, 150),
    urgencyBadge: getUrgencyBadge(item.urgencyScore),
    amount: item.amount ? formatAmount(item.amount) : undefined,
    deadline: item.deadline || undefined,
    actionUrl: item.actionUrl,
    actionLabel: item.actionLabel,
    signals: item.signals,
  };
}

/**
 * Generate headline based on content
 */
function generateHeadline(
  items: BriefingItem[],
  summary: {
    totalItems: number;
    byCategory: Record<string, number>;
  }
): string {
  const urgentCount = items.filter((i) => i.urgencyScore >= 80).length;

  if (urgentCount > 0) {
    return `${urgentCount} urgent alert${urgentCount > 1 ? 's' : ''} requiring attention`;
  }

  if (summary.byCategory.new_opportunity > 0) {
    return `${summary.byCategory.new_opportunity} new opportunities match your profile`;
  }

  if (summary.byCategory.recompete_alert > 0) {
    return `${summary.byCategory.recompete_alert} recompete opportunities identified`;
  }

  return `${summary.totalItems} intelligence items for today`;
}

/**
 * Generate subheadline
 */
function generateSubheadline(summary: {
  topAgencies: Array<{ agency: string; count: number }>;
}): string {
  if (summary.topAgencies.length > 0) {
    const topAgency = summary.topAgencies[0];
    return `Most activity from ${topAgency.agency}`;
  }
  return 'Your daily GovCon intelligence summary';
}

/**
 * Generate quick stats
 */
function generateQuickStats(
  items: BriefingItem[],
  summary: {
    totalItems: number;
    byCategory: Record<string, number>;
    topAgencies: Array<{ agency: string; count: number }>;
  }
): QuickStat[] {
  const stats: QuickStat[] = [];

  // Total items
  stats.push({
    label: 'Total Items',
    value: summary.totalItems,
  });

  // Opportunities
  if (summary.byCategory.new_opportunity) {
    stats.push({
      label: 'New Opps',
      value: summary.byCategory.new_opportunity,
    });
  }

  // Deadline alerts
  if (summary.byCategory.deadline_alert) {
    stats.push({
      label: 'Deadlines',
      value: summary.byCategory.deadline_alert,
      trend: 'down', // Deadlines decreasing = good
    });
  }

  // Top agency
  if (summary.topAgencies.length > 0) {
    stats.push({
      label: 'Top Agency',
      value: truncate(summary.topAgencies[0].agency, 20),
    });
  }

  return stats.slice(0, 4); // Max 4 stats
}

/**
 * Get urgency badge text
 */
function getUrgencyBadge(urgencyScore: number): string | undefined {
  if (urgencyScore >= 90) return 'URGENT';
  if (urgencyScore >= 80) return 'HIGH';
  if (urgencyScore >= 60) return 'MEDIUM';
  return undefined;
}

/**
 * Format dollar amount
 */
function formatAmount(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  }
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`;
  }
  return `$${amount.toFixed(0)}`;
}

/**
 * Truncate text
 */
function truncate(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text || '';
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Build user profile from aggregated data
 */
function buildUserProfile(aggregatedProfile: Record<string, unknown>): UserBriefingProfile {
  return {
    naics_codes: extractArray(aggregatedProfile.naics_codes),
    agencies: extractArray(aggregatedProfile.agencies),
    keywords: extractArray(aggregatedProfile.keywords),
    zip_codes: extractArray(aggregatedProfile.zip_codes),
    watched_companies: extractArray(aggregatedProfile.watched_companies),
    watched_contracts: extractArray(aggregatedProfile.watched_contracts),
  };
}

/**
 * Extract array from unknown value
 */
function extractArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return [];
}

/**
 * Organize snapshots by tool and date
 */
function organizeSnapshots(
  snapshots: Array<{ tool: string; raw_data: unknown; snapshot_date: string }>
): Record<string, { today: unknown[]; yesterday: unknown[] }> {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const organized: Record<string, { today: unknown[]; yesterday: unknown[] }> = {
    opportunities: { today: [], yesterday: [] },
    recompetes: { today: [], yesterday: [] },
    awards: { today: [], yesterday: [] },
    contractors: { today: [], yesterday: [] },
    webSignals: { today: [], yesterday: [] },
  };

  for (const snap of snapshots) {
    const isToday = snap.snapshot_date === today;
    const bucket = isToday ? 'today' : 'yesterday';

    const data = snap.raw_data as { items?: unknown[]; signals?: unknown[] } | null;
    if (!data) continue;

    switch (snap.tool) {
      case 'opportunity_hunter':
        if (Array.isArray(data.items)) {
          organized.opportunities[bucket].push(...data.items);
        }
        break;
      case 'recompete':
        if (Array.isArray(data.items)) {
          organized.recompetes[bucket].push(...data.items);
        }
        break;
      case 'usaspending':
        if (Array.isArray(data.items)) {
          organized.awards[bucket].push(...data.items);
        }
        break;
      case 'contractor_db':
        if (Array.isArray(data.items)) {
          organized.contractors[bucket].push(...data.items);
        }
        break;
      case 'web_intelligence':
        if (Array.isArray(data.signals)) {
          organized.webSignals[bucket].push(...data.signals);
        }
        break;
    }
  }

  return organized;
}

/**
 * Get Supabase client
 */
function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key);
}

export { formatItem, formatAmount, truncate };
