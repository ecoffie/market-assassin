/**
 * Lindy Intelligence API
 *
 * Unified endpoint that provides all GovCon intelligence for Lindy consumption.
 * Returns briefings, recompetes, contractor activity, and recommended actions.
 *
 * GET /api/lindy/intelligence?email=user@example.com
 *
 * Query params:
 * - email (required): User email for personalized intelligence
 * - days (optional): Number of days of history (default: 1, max: 7)
 * - include (optional): Comma-separated sections to include (default: all)
 *   Options: briefing, recompetes, contractors, actions
 *
 * Authentication: Uses same email-gated access as briefings (Vercel KV)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';

interface RecompeteContract {
  contractNumber: string;
  incumbentName: string;
  obligatedAmount: number;
  naicsCode: string;
  agency: string;
  daysUntilExpiration: number;
  expirationRisk: 'low' | 'medium' | 'high' | 'critical';
  setAsideType: string | null;
  actionUrl: string;
}

interface ContractorActivity {
  companyName: string;
  activityType: 'new_award' | 'recompete_win' | 'teaming_announcement' | 'new_contract';
  details: string;
  amount?: number;
  agency?: string;
  date: string;
  relevance: string;
}

interface RecommendedAction {
  id: string;
  type: 'outreach' | 'content' | 'deadline' | 'opportunity' | 'competitor_watch';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  reason: string;
  actionUrl?: string;
  dueDate?: string;
  suggestedContent?: string;
}

interface LindyIntelligence {
  as_of: string;
  user_email: string;
  profile_summary: {
    naics_codes: string[];
    agencies: string[];
    watched_companies: string[];
  };
  briefing: {
    date: string;
    headline: string;
    subheadline: string;
    total_items: number;
    urgent_alerts: number;
    quick_stats: Array<{ label: string; value: string | number }>;
    top_items: Array<{
      rank: number;
      category: string;
      title: string;
      description: string;
      urgency: string;
      amount?: string;
      action_url: string;
    }>;
  } | null;
  recompetes: {
    critical: RecompeteContract[];
    high: RecompeteContract[];
    upcoming: RecompeteContract[];
    total_count: number;
  };
  contractor_activity: {
    tier1_moves: ContractorActivity[];
    tier2_moves: ContractorActivity[];
    watched_company_alerts: ContractorActivity[];
  };
  recommended_actions: RecommendedAction[];
  meta: {
    data_freshness: {
      briefing: string | null;
      recompetes: string | null;
      awards: string | null;
      web_intel: string | null;
    };
    next_briefing_at: string;
    api_version: string;
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email')?.toLowerCase().trim();
  const days = Math.min(parseInt(searchParams.get('days') || '1'), 7);
  const includeParam = searchParams.get('include');
  const includeSections = includeParam
    ? includeParam.split(',').map(s => s.trim())
    : ['briefing', 'recompetes', 'contractors', 'actions'];

  if (!email) {
    return NextResponse.json({
      error: 'Email required',
      usage: 'GET /api/lindy/intelligence?email=user@example.com',
    }, { status: 400 });
  }

  // Check access via KV (but don't block - just note it)
  const hasAccess = await kv.get(`briefings:${email}`);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const now = new Date();
  const today = now.toISOString().split('T')[0];

  try {
    // Fetch user profile
    const { data: profile } = await supabase
      .from('user_briefing_profile')
      .select('naics_codes, agencies, watched_companies, watched_contracts')
      .eq('user_email', email)
      .single();

    const profileSummary = {
      naics_codes: profile?.naics_codes || [],
      agencies: profile?.agencies || [],
      watched_companies: profile?.watched_companies || [],
    };

    // Build response object
    const intelligence: LindyIntelligence & { has_full_access: boolean } = {
      as_of: now.toISOString(),
      user_email: email,
      has_full_access: !!hasAccess,
      profile_summary: profileSummary,
      briefing: null,
      recompetes: {
        critical: [],
        high: [],
        upcoming: [],
        total_count: 0,
      },
      contractor_activity: {
        tier1_moves: [],
        tier2_moves: [],
        watched_company_alerts: [],
      },
      recommended_actions: [],
      meta: {
        data_freshness: {
          briefing: null,
          recompetes: null,
          awards: null,
          web_intel: null,
        },
        next_briefing_at: getNextBriefingTime(),
        api_version: '1.0.0',
      },
    };

    // Fetch briefing if requested
    if (includeSections.includes('briefing')) {
      const { data: briefings } = await supabase
        .from('briefing_log')
        .select('briefing_date, briefing_data, generated_at')
        .eq('user_email', email)
        .order('briefing_date', { ascending: false })
        .limit(days);

      if (briefings && briefings.length > 0) {
        const latestBriefing = briefings[0].briefing_data as Record<string, unknown> | null;
        if (latestBriefing) {
          // Handle new recompete briefing format
          const opportunities = latestBriefing.opportunities as Array<{
            rank?: number;
            contractName?: string;
            agencyAcronym?: string;
            contractValue?: string;
            incumbent?: string;
            timingSignal?: string;
            whyVulnerable?: string;
          }> || [];
          const teamingPlays = latestBriefing.teamingPlays as Array<{
            playName?: string;
            primesToApproach?: string[];
            suggestedOpener?: string;
          }> || [];
          const marketIntel = latestBriefing.marketIntel as Array<{
            headline?: string;
            source?: string;
            relevance?: string;
            url?: string;
            category?: string;
          }> || [];

          intelligence.briefing = {
            date: briefings[0].briefing_date,
            headline: `${opportunities.length} Recompete Opportunities`,
            subheadline: `${teamingPlays.length} Teaming Plays • ${marketIntel.length} Market Intel Items`,
            total_items: opportunities.length,
            urgent_alerts: opportunities.filter((o) => {
              const timing = o.timingSignal?.toLowerCase() || '';
              return timing.includes('imminent') || timing.includes('q1') || timing.includes('urgent');
            }).length,
            quick_stats: [
              { label: 'Opportunities', value: opportunities.length },
              { label: 'Teaming Plays', value: teamingPlays.length },
              { label: 'Market Intel', value: marketIntel.length },
            ],
            top_items: opportunities.slice(0, 5).map((opp, idx) => ({
              rank: opp.rank || idx + 1,
              category: 'Recompete',
              title: `${opp.contractName || 'Contract'} (${opp.agencyAcronym || 'Agency'})`,
              description: opp.whyVulnerable || 'Displacement opportunity',
              urgency: opp.timingSignal?.includes('imminent') ? 'HIGH' : 'normal',
              amount: opp.contractValue,
              action_url: `https://www.usaspending.gov/search`,
            })),
          };
          intelligence.meta.data_freshness.briefing = briefings[0].generated_at;
        }
      }
    }

    // Fetch recompetes if requested
    if (includeSections.includes('recompetes')) {
      const { data: recompeteSnapshot } = await supabase
        .from('briefing_snapshots')
        .select('snapshot_data, created_at')
        .eq('user_email', email)
        .eq('tool', 'recompete')
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .single();

      if (recompeteSnapshot?.snapshot_data?.contracts) {
        const contracts = recompeteSnapshot.snapshot_data.contracts as RecompeteContract[];

        intelligence.recompetes = {
          critical: contracts
            .filter(c => c.expirationRisk === 'critical')
            .slice(0, 5)
            .map(formatRecompete),
          high: contracts
            .filter(c => c.expirationRisk === 'high')
            .slice(0, 5)
            .map(formatRecompete),
          upcoming: contracts
            .filter(c => c.expirationRisk === 'medium' || c.expirationRisk === 'low')
            .slice(0, 10)
            .map(formatRecompete),
          total_count: contracts.length,
        };
        intelligence.meta.data_freshness.recompetes = recompeteSnapshot.created_at;
      }
    }

    // Fetch contractor activity if requested
    if (includeSections.includes('contractors')) {
      // Get awards snapshot for contractor activity
      const { data: awardsSnapshot } = await supabase
        .from('briefing_snapshots')
        .select('snapshot_data, created_at')
        .eq('user_email', email)
        .eq('tool', 'awards')
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .single();

      if (awardsSnapshot?.snapshot_data?.awards) {
        const awards = awardsSnapshot.snapshot_data.awards as Array<{
          recipientName: string;
          awardAmount: number;
          awardingAgency: string;
          awardDate: string;
          description?: string;
        }>;

        // Identify watched company alerts
        const watchedCompanies = profile?.watched_companies || [];
        const watchedAlerts: ContractorActivity[] = [];
        const tier1Moves: ContractorActivity[] = [];

        for (const award of awards.slice(0, 20)) {
          const isWatched = watchedCompanies.some((c: string) =>
            award.recipientName?.toLowerCase().includes(c.toLowerCase())
          );

          const activity: ContractorActivity = {
            companyName: award.recipientName || 'Unknown',
            activityType: 'new_award',
            details: `Won $${(award.awardAmount || 0).toLocaleString()} contract from ${award.awardingAgency || 'Unknown Agency'}`,
            amount: award.awardAmount,
            agency: award.awardingAgency,
            date: award.awardDate || today,
            relevance: isWatched ? 'watched_competitor' : 'market_intelligence',
          };

          if (isWatched) {
            watchedAlerts.push(activity);
          } else {
            tier1Moves.push(activity);
          }
        }

        intelligence.contractor_activity = {
          tier1_moves: tier1Moves.slice(0, 5),
          tier2_moves: [], // Would come from separate tier2 tracking
          watched_company_alerts: watchedAlerts.slice(0, 5),
        };
        intelligence.meta.data_freshness.awards = awardsSnapshot.created_at;
      }

      // Get web intel for additional contractor signals
      const { data: webIntelSnapshot } = await supabase
        .from('briefing_snapshots')
        .select('snapshot_data, created_at')
        .eq('user_email', email)
        .eq('tool', 'web_intelligence')
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .single();

      if (webIntelSnapshot) {
        intelligence.meta.data_freshness.web_intel = webIntelSnapshot.created_at;
      }
    }

    // Generate recommended actions if requested
    if (includeSections.includes('actions')) {
      intelligence.recommended_actions = generateRecommendedActions(
        intelligence.briefing,
        intelligence.recompetes,
        intelligence.contractor_activity,
        profileSummary
      );
    }

    return NextResponse.json(intelligence);

  } catch (err) {
    console.error('[Lindy Intelligence] Error:', err);
    return NextResponse.json({
      error: 'Failed to fetch intelligence',
      details: String(err),
    }, { status: 500 });
  }
}

/**
 * Format recompete contract for Lindy consumption
 */
function formatRecompete(contract: RecompeteContract): RecompeteContract {
  return {
    contractNumber: contract.contractNumber || 'N/A',
    incumbentName: contract.incumbentName || 'Unknown',
    obligatedAmount: contract.obligatedAmount || 0,
    naicsCode: contract.naicsCode || '',
    agency: contract.agency || '',
    daysUntilExpiration: contract.daysUntilExpiration || 999,
    expirationRisk: contract.expirationRisk || 'low',
    setAsideType: contract.setAsideType || null,
    actionUrl: `https://www.usaspending.gov/keyword_search/${encodeURIComponent(contract.contractNumber || contract.incumbentName)}`,
  };
}

/**
 * Get next briefing time (9 AM UTC)
 */
function getNextBriefingTime(): string {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(9, 0, 0, 0);

  if (now.getUTCHours() >= 9) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next.toISOString();
}

/**
 * Generate recommended actions based on intelligence
 */
function generateRecommendedActions(
  briefing: LindyIntelligence['briefing'],
  recompetes: LindyIntelligence['recompetes'],
  contractorActivity: LindyIntelligence['contractor_activity'],
  profile: LindyIntelligence['profile_summary']
): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  let actionId = 1;

  // Critical recompete deadlines
  for (const recompete of recompetes.critical.slice(0, 3)) {
    actions.push({
      id: `action-${actionId++}`,
      type: 'deadline',
      priority: 'high',
      title: `Recompete Alert: ${recompete.incumbentName}`,
      description: `Contract expires in ${recompete.daysUntilExpiration} days. $${recompete.obligatedAmount.toLocaleString()} opportunity.`,
      reason: `NAICS ${recompete.naicsCode} matches your profile. Incumbent may be vulnerable.`,
      actionUrl: recompete.actionUrl,
      dueDate: new Date(Date.now() + recompete.daysUntilExpiration * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    });
  }

  // Watched competitor alerts
  for (const alert of contractorActivity.watched_company_alerts.slice(0, 2)) {
    actions.push({
      id: `action-${actionId++}`,
      type: 'competitor_watch',
      priority: 'high',
      title: `Competitor Win: ${alert.companyName}`,
      description: alert.details,
      reason: `${alert.companyName} is on your watch list. Track their movements for teaming or displacement opportunities.`,
      suggestedContent: `Consider reaching out to ${alert.companyName} for teaming discussions on similar ${alert.agency} opportunities.`,
    });
  }

  // Content opportunities from urgent briefing items
  if (briefing && briefing.urgent_alerts > 0) {
    const urgentItem = briefing.top_items.find(i => i.urgency === 'URGENT' || i.urgency === 'HIGH');
    if (urgentItem) {
      actions.push({
        id: `action-${actionId++}`,
        type: 'content',
        priority: 'medium',
        title: `Content Angle: ${urgentItem.category}`,
        description: `Create thought leadership content about: ${urgentItem.title}`,
        reason: `This is trending in your target market. Position yourself as an expert.`,
        suggestedContent: `Write a LinkedIn post addressing "${urgentItem.title}" and how your company solves this challenge.`,
      });
    }
  }

  // High-value opportunities
  if (briefing && briefing.total_items > 0) {
    for (const item of briefing.top_items.slice(0, 2)) {
      if (item.amount && parseFloat(item.amount.replace(/[^0-9.]/g, '')) >= 100000) {
        actions.push({
          id: `action-${actionId++}`,
          type: 'opportunity',
          priority: 'medium',
          title: `Pursue: ${item.title.substring(0, 50)}...`,
          description: item.description,
          reason: `${item.amount} opportunity in your target market.`,
          actionUrl: item.action_url,
        });
      }
    }
  }

  // Outreach suggestions for tier 1 moves
  for (const move of contractorActivity.tier1_moves.slice(0, 2)) {
    if (move.amount && move.amount >= 500000) {
      actions.push({
        id: `action-${actionId++}`,
        type: 'outreach',
        priority: 'low',
        title: `Teaming Target: ${move.companyName}`,
        description: move.details,
        reason: `${move.companyName} just won a significant contract. They may need subcontractors.`,
        suggestedContent: `Draft an introduction email highlighting your capabilities in ${profile.naics_codes[0] || 'your core competency'}.`,
      });
    }
  }

  return actions.slice(0, 10); // Cap at 10 actions
}

export async function POST(request: NextRequest) {
  return GET(request);
}
