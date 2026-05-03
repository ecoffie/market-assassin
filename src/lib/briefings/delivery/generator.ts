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
import { calculateWinProbability, WinProbabilityResult } from '../win-probability';
import { getBriefingProfile, BriefingUserProfile } from '../../smart-profile';

const MAX_TOP_ITEMS = 5;
const MAX_PER_CATEGORY = 3;

const CATEGORY_ICONS: Record<string, string> = {
  // Recompete Intel
  recompete_alert: '🔄',
  timeline_change: '📅',
  // Award Intel
  new_award: '🏆',
  competitor_win: '⚔️',
  spending_shift: '💰',
  // Contractor/Teaming Intel
  teaming_signal: '🤝',
  sblo_update: '📋',
  certification_change: '📜',
  // Web Intelligence
  web_signal: '🌐',
  // Legacy (kept for compatibility but not actively used)
  new_opportunity: '🎯',
  deadline_alert: '⏰',
  amendment: '📝',
};

const CATEGORY_TITLES: Record<string, string> = {
  // Recompete Intel
  recompete_alert: 'Recompete Opportunities',
  timeline_change: 'Contract Timeline Changes',
  // Award Intel
  new_award: 'Recent Contract Awards',
  competitor_win: 'Competitor Wins',
  spending_shift: 'Agency Spending Shifts',
  // Contractor/Teaming Intel
  teaming_signal: 'Teaming Opportunities',
  sblo_update: 'SBLO Contact Updates',
  certification_change: 'Certification Changes',
  // Web Intelligence
  web_signal: 'Market Intelligence',
  // Legacy
  new_opportunity: 'New Opportunities',
  deadline_alert: 'Deadline Alerts',
  amendment: 'Amendments',
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

  // Fallback NAICS codes for users without profile data
  const FALLBACK_NAICS = [
    '541512', // Computer Systems Design
    '541611', // Management Consulting
    '541330', // Engineering Services
    '541990', // Other Professional Services
    '561210', // Facilities Support Services
  ];

  try {
    // Step 1: Get user profile from unified user_notification_settings table
    const { data: notificationSettings } = await supabase
      .from('user_notification_settings')
      .select('naics_codes, agencies, keywords, aggregated_profile')
      .eq('user_email', userEmail)
      .single();

    let profileData;

    if (notificationSettings) {
      console.log(`[BriefingGen] Found profile for ${userEmail}`);
      profileData = {
        naics_codes: notificationSettings.naics_codes || [],
        agencies: notificationSettings.agencies || [],
        keywords: notificationSettings.keywords || [],
        business_description: null,
        zip_codes: [],
        watched_companies: [],
        watched_contracts: [],
        aggregated_profile: notificationSettings.aggregated_profile,
      };
    } else {
      // No profile - use fallback NAICS
      console.log(`[BriefingGen] No profile for ${userEmail}, using fallback NAICS`);
      profileData = {
        naics_codes: FALLBACK_NAICS,
        agencies: [],
        keywords: [],
        business_description: null,
        zip_codes: [],
        watched_companies: [],
        watched_contracts: [],
        aggregated_profile: null,
      };
    }

    // Use aggregated_profile JSONB if populated, otherwise build from individual columns
    const hasJsonb = profileData.aggregated_profile
      && typeof profileData.aggregated_profile === 'object'
      && Object.keys(profileData.aggregated_profile).length > 0
      && (profileData.aggregated_profile as Record<string, unknown>).naics_codes;

    const profileSource = hasJsonb
      ? profileData.aggregated_profile
      : {
          naics_codes: profileData.naics_codes || [],
          agencies: profileData.agencies || [],
          keywords: profileData.keywords || [],
          zip_codes: profileData.zip_codes || [],
          watched_companies: profileData.watched_companies || [],
          watched_contracts: profileData.watched_contracts || [],
        };

    const userProfile = buildUserProfile(profileSource as Record<string, unknown>);

    // Check if profile has any meaningful data - use fallback if empty
    if (userProfile.naics_codes.length === 0 && userProfile.agencies.length === 0 && userProfile.keywords.length === 0) {
      console.log(`[BriefingGen] Empty profile for ${userEmail}, using fallback NAICS`);
      userProfile.naics_codes = FALLBACK_NAICS;
    }

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

    // Step 2.5: Fetch LIVE recompete data if snapshots are empty (fallback)
    let recompetesToday = (snapshotsByTool.recompetes?.today || []) as RecompeteContract[];
    if (recompetesToday.length === 0 && userProfile.naics_codes.length > 0) {
      console.log(`[BriefingGen] No recompete snapshots, fetching live data for ${userEmail}`);
      try {
        const { fetchRecompetesForUser } = await import('../pipelines/fpds-recompete');
        const liveResult = await fetchRecompetesForUser({
          naics_codes: userProfile.naics_codes.slice(0, 5), // Limit to 5 NAICS for speed
          agencies: userProfile.agencies,
          watched_companies: [],
          watched_contracts: [],
        });
        recompetesToday = liveResult.contracts;
        console.log(`[BriefingGen] Fetched ${recompetesToday.length} live recompetes`);
      } catch (err) {
        console.error(`[BriefingGen] Live recompete fetch failed:`, err);
      }
    }

    // Step 3: Run diff engine
    // NOTE: SAM.gov opportunities excluded - those go to Daily Alerts
    // Briefings focus on: recompetes, awards, contractor intel, web signals
    const diffResult = generateBriefingDiff(
      {
        today: [], // SAM.gov opps excluded - handled by Daily Alerts
        yesterday: [],
      },
      {
        today: recompetesToday,
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

    // Step 4: Filter out low-relevance noise and apply urgency flagging
    const MIN_RELEVANCE_SCORE = 20; // Items below this are generic noise
    const URGENCY_DEADLINE_DAYS = 7; // Flag items with deadlines within this many days

    const filteredItems = diffResult.items.filter((item) => {
      // Keep items with decent relevance OR high urgency (deadlines matter even if low relevance)
      return item.relevanceScore >= MIN_RELEVANCE_SCORE || item.urgencyScore >= 80;
    });

    // Boost urgency score for items with near-term deadlines
    for (const item of filteredItems) {
      if (item.deadline) {
        const daysUntil = Math.ceil((new Date(item.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysUntil >= 0 && daysUntil <= URGENCY_DEADLINE_DAYS) {
          item.urgencyScore = Math.max(item.urgencyScore, 90); // Ensure URGENT badge
          if (!item.signals.includes('deadline_within_7_days')) {
            item.signals.push('deadline_within_7_days');
          }
        }
      }
    }

    // Re-sort after urgency boost (urgent items bubble up)
    filteredItems.sort((a, b) => b.overallScore - a.overallScore);

    const maxItems = options.maxItems || 15;
    const items = filteredItems.slice(0, maxItems);

    // Get smart profile for win probability scoring
    const smartProfile = await getBriefingProfile(userEmail);

    // Calculate win probability for each item
    const itemsWithWinProb = items.map(item => {
      // Only calculate for opportunities and recompetes
      if (['new_opportunity', 'deadline_alert', 'amendment', 'recompete_alert', 'timeline_change'].includes(item.category)) {
        const winResult = calculateWinProbability(
          {
            naicsCode: item.naicsCode,
            setAside: item.setAside,
            agency: item.agency,
            amount: item.amount || undefined,
            description: item.description,
            title: item.title,
          },
          smartProfile
        );
        return {
          ...item,
          winProbability: winResult.score,
          winTier: winResult.tier,
          winSummary: winResult.summary,
        };
      }
      return item;
    });

    const briefing = formatBriefing(
      userEmail,
      briefingDate,
      itemsWithWinProb,
      diffResult.summary,
      Date.now() - startTime
    );

    console.log(
      `[BriefingGen] Generated briefing for ${userEmail}: ${itemsWithWinProb.length} items in ${Date.now() - startTime}ms`
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
    // Win probability
    winProbability: item.winProbability,
    winTier: item.winTier,
    winSummary: item.winSummary,
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

  // Prioritize recompetes (exclusive intel)
  if (summary.byCategory.recompete_alert > 0) {
    const recompeteCount = summary.byCategory.recompete_alert;
    return `${recompeteCount} recompete ${recompeteCount > 1 ? 'opportunities' : 'opportunity'} in your market`;
  }

  // Teaming signals are high-value
  if (summary.byCategory.teaming_signal > 0) {
    return `${summary.byCategory.teaming_signal} new teaming ${summary.byCategory.teaming_signal > 1 ? 'opportunities' : 'opportunity'} identified`;
  }

  // Competitor wins need attention
  if (summary.byCategory.competitor_win > 0) {
    return `${summary.byCategory.competitor_win} competitor win${summary.byCategory.competitor_win > 1 ? 's' : ''} to analyze`;
  }

  // Award intel
  if (summary.byCategory.new_award > 0) {
    return `${summary.byCategory.new_award} new contract awards in your NAICS`;
  }

  // Urgent items
  if (urgentCount > 0) {
    return `${urgentCount} urgent intel item${urgentCount > 1 ? 's' : ''} requiring attention`;
  }

  return `${summary.totalItems} market intelligence items for today`;
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

  // Recompetes (high-value exclusive intel)
  if (summary.byCategory.recompete_alert) {
    stats.push({
      label: 'Recompetes',
      value: summary.byCategory.recompete_alert,
    });
  }

  // Teaming opportunities
  const teamingCount = (summary.byCategory.teaming_signal || 0) + (summary.byCategory.sblo_update || 0);
  if (teamingCount > 0) {
    stats.push({
      label: 'Teaming Leads',
      value: teamingCount,
    });
  }

  // Awards
  const awardCount = (summary.byCategory.new_award || 0) + (summary.byCategory.competitor_win || 0);
  if (awardCount > 0) {
    stats.push({
      label: 'Awards',
      value: awardCount,
    });
  }

  // Total intel items
  stats.push({
    label: 'Intel Items',
    value: summary.totalItems,
  });

  // Top agency if we have room
  if (stats.length < 4 && summary.topAgencies.length > 0) {
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

    const data = snap.raw_data as Record<string, unknown> | null;
    if (!data) continue;

    switch (snap.tool) {
      case 'opportunity_hunter':
        // Cron stores as { opportunities: [...] }
        if (Array.isArray(data.opportunities)) {
          organized.opportunities[bucket].push(...data.opportunities);
        } else if (Array.isArray(data.items)) {
          organized.opportunities[bucket].push(...data.items);
        }
        break;
      case 'recompete':
        // Cron stores as { contracts: [...] }
        if (Array.isArray(data.contracts)) {
          organized.recompetes[bucket].push(...data.contracts);
        } else if (Array.isArray(data.items)) {
          organized.recompetes[bucket].push(...data.items);
        }
        break;
      case 'market_assassin':
      case 'usaspending':
        // Cron stores as { awards: [...] }
        if (Array.isArray(data.awards)) {
          organized.awards[bucket].push(...data.awards);
        } else if (Array.isArray(data.items)) {
          organized.awards[bucket].push(...data.items);
        }
        break;
      case 'contractor_db':
        // Cron stores as { contractors: [...] }
        if (Array.isArray(data.contractors)) {
          organized.contractors[bucket].push(...data.contractors);
        } else if (Array.isArray(data.items)) {
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
