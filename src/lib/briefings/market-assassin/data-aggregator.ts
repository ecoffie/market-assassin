/**
 * MA Briefing Data Aggregator
 *
 * Pulls data from:
 * - Budget data (agency-budget-data.json)
 * - Pain points (agency-pain-points.json)
 * - USASpending for competitor awards
 * - RSS feeds for market news
 * - SAM.gov forecasts (when available)
 */

import { BudgetShift, PainPointUpdate, CompetitorActivity, CaptureSignal, MAUserProfile } from './types';
import { fetchAllRSSFeeds, filterRSSByKeywords, filterRecentRSS } from '../web-intel/rss';
import agencyPainPoints from '@/data/agency-pain-points.json';
import agencyBudgetData from '@/data/agency-budget-data.json';

const USASPENDING_API = 'https://api.usaspending.gov/api/v2';

// Keywords for filtering competitor news
const COMPETITOR_KEYWORDS = [
  'wins contract',
  'awarded',
  'receives',
  'selected',
  'wins',
  'acquisition',
  'acquires',
  'merger',
  'layoff',
  'expansion',
  'partnership',
  'teaming',
  'joint venture',
  'protest',
];

// Keywords for capture signals
const CAPTURE_KEYWORDS = [
  'sources sought',
  'rfi',
  'request for information',
  'market research',
  'pre-solicitation',
  'draft rfp',
  'industry day',
  'forecast',
];

/**
 * Fetch budget shifts for user's target agencies
 */
export async function fetchBudgetShifts(
  profile: MAUserProfile
): Promise<BudgetShift[]> {
  const shifts: BudgetShift[] = [];
  const budgetData = agencyBudgetData as Record<string, {
    agency_name?: string;
    toptier_code?: string;
    fy26_budget?: number;
    fy25_budget?: number;
    budget_change_pct?: number;
    total_obligations?: number;
  }>;

  // Get agencies matching user profile
  const targetAgencies = profile.targetAgencies.length > 0
    ? profile.targetAgencies
    : ['DHS', 'DOD', 'VA', 'HHS', 'DOE'];

  for (const [agencyCode, data] of Object.entries(budgetData)) {
    // Check if this agency matches user's targets
    const isTarget = targetAgencies.some(t =>
      agencyCode.toLowerCase().includes(t.toLowerCase()) ||
      data.agency_name?.toLowerCase().includes(t.toLowerCase())
    );

    if (!isTarget) continue;

    const fy26 = data.fy26_budget || 0;
    const fy25 = data.fy25_budget || 0;
    const changePct = data.budget_change_pct || ((fy26 - fy25) / fy25 * 100);

    if (Math.abs(changePct) < 3) continue; // Skip minor changes

    const shiftType: BudgetShift['shiftType'] = changePct > 0 ? 'increase' : 'decrease';
    const amount = changePct > 0
      ? `+${changePct.toFixed(1)}% YoY ($${((fy26 - fy25) / 1_000_000_000).toFixed(1)}B)`
      : `${changePct.toFixed(1)}% YoY (-$${Math.abs((fy26 - fy25) / 1_000_000_000).toFixed(1)}B)`;

    shifts.push({
      id: `budget-${agencyCode}`,
      agency: data.agency_name || agencyCode,
      agencyAcronym: agencyCode,
      shiftType,
      amount,
      amountNumeric: fy26 - fy25,
      description: `${data.agency_name || agencyCode} FY26 budget ${shiftType === 'increase' ? 'increases' : 'decreases'} ${Math.abs(changePct).toFixed(1)}% compared to FY25.`,
      source: 'FY26 Budget Request',
      impactOnUser: shiftType === 'increase'
        ? `Potential for expanded contracting activity in ${agencyCode}. Position for new opportunities.`
        : `Tighter budgets may mean incumbents are more vulnerable. Focus on cost-efficiency narratives.`,
      relevantNaics: profile.naicsCodes,
      actionUrl: `https://www.usaspending.gov/agency/${data.toptier_code || agencyCode}`,
    });
  }

  // Sort by absolute change amount
  shifts.sort((a, b) => Math.abs(b.amountNumeric || 0) - Math.abs(a.amountNumeric || 0));

  return shifts.slice(0, 5);
}

/**
 * Fetch pain point updates for user's target agencies
 */
export async function fetchPainPointUpdates(
  profile: MAUserProfile
): Promise<PainPointUpdate[]> {
  const updates: PainPointUpdate[] = [];
  const painData = agencyPainPoints as Record<string, {
    painPoints?: string[];
    priorities?: string[];
    acronym?: string;
  }>;

  const targetAgencies = profile.targetAgencies.length > 0
    ? profile.targetAgencies
    : ['DHS', 'DOD', 'VA', 'HHS'];

  for (const [agencyName, data] of Object.entries(painData)) {
    // Check if matches target
    const isTarget = targetAgencies.some(t =>
      agencyName.toLowerCase().includes(t.toLowerCase()) ||
      data.acronym?.toLowerCase() === t.toLowerCase()
    );

    if (!isTarget) continue;

    // Get pain points that match user capabilities
    const matchingPainPoints = (data.painPoints || []).filter(pp => {
      const ppLower = pp.toLowerCase();
      return profile.capabilities.some(cap =>
        ppLower.includes(cap.toLowerCase()) ||
        cap.toLowerCase().split(' ').some(w => ppLower.includes(w))
      );
    });

    for (const painPoint of matchingPainPoints.slice(0, 2)) {
      // Find matching capability
      const matchingCap = profile.capabilities.find(cap =>
        painPoint.toLowerCase().includes(cap.toLowerCase()) ||
        cap.toLowerCase().split(' ').some(w => painPoint.toLowerCase().includes(w))
      );

      updates.push({
        id: `pain-${data.acronym || agencyName}-${updates.length}`,
        agency: agencyName,
        agencyAcronym: data.acronym || agencyName.split(' ').map(w => w[0]).join(''),
        painPoint,
        updateType: 'mentioned',
        source: 'Agency Pain Points Database',
        sourceDate: new Date().toISOString().split('T')[0],
        summary: painPoint,
        opportunityAngle: matchingCap
          ? `Your ${matchingCap} capability directly addresses this challenge. Use in proposals and outreach.`
          : `Position your capabilities as a solution to this agency challenge.`,
        relevantCapabilities: matchingCap ? [matchingCap] : [],
      });
    }
  }

  return updates.slice(0, 5);
}

/**
 * Fetch competitor activity from RSS and USASpending
 */
export async function fetchCompetitorActivity(
  profile: MAUserProfile
): Promise<CompetitorActivity[]> {
  const activities: CompetitorActivity[] = [];

  // 1. Check RSS feeds for competitor news
  try {
    const rssItems = await fetchAllRSSFeeds();
    const recentRss = filterRecentRSS(rssItems, 7);
    const competitorNews = filterRSSByKeywords(recentRss, COMPETITOR_KEYWORDS);

    for (const item of competitorNews.slice(0, 10)) {
      // Check if it mentions any watched competitors
      const watchedCompetitor = profile.watchedCompetitors.find(c =>
        item.title.toLowerCase().includes(c.toLowerCase()) ||
        item.description.toLowerCase().includes(c.toLowerCase())
      );

      if (watchedCompetitor) {
        // Determine activity type from keywords
        let activityType: CompetitorActivity['activityType'] = 'award';
        const textLower = `${item.title} ${item.description}`.toLowerCase();

        if (textLower.includes('protest')) activityType = 'protest';
        else if (textLower.includes('acquire') || textLower.includes('merger')) activityType = 'acquisition';
        else if (textLower.includes('partner') || textLower.includes('team')) activityType = 'partnership';
        else if (textLower.includes('layoff') || textLower.includes('cut')) activityType = 'layoff';
        else if (textLower.includes('expan') || textLower.includes('hire')) activityType = 'expansion';

        activities.push({
          id: `comp-${activities.length}`,
          companyName: watchedCompetitor,
          activityType,
          description: item.title,
          date: item.pubDate || new Date().toISOString(),
          implication: getCompetitorImplication(activityType, watchedCompetitor),
          source: item.source,
          actionUrl: item.link,
        });
      }
    }
  } catch (error) {
    console.error('[MA-Aggregator] RSS fetch error:', error);
  }

  // 2. Check USASpending for recent awards to watched competitors
  if (profile.watchedCompetitors.length > 0) {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const response = await fetch(`${USASPENDING_API}/search/spending_by_award/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: {
            time_period: [{
              start_date: thirtyDaysAgo.toISOString().split('T')[0],
              end_date: new Date().toISOString().split('T')[0],
              date_type: 'action_date',
            }],
            award_type_codes: ['A', 'B', 'C', 'D'],
            recipient_search_text: profile.watchedCompetitors.slice(0, 3),
            award_amounts: [{ lower_bound: 1000000 }],
          },
          fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Start Date', 'NAICS Code'],
          page: 1,
          limit: 10,
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (response.ok) {
        const data = await response.json();
        for (const award of data.results || []) {
          const competitor = profile.watchedCompetitors.find(c =>
            award['Recipient Name']?.toLowerCase().includes(c.toLowerCase())
          );

          if (competitor && !activities.some(a => a.companyName === competitor && a.activityType === 'award')) {
            activities.push({
              id: `comp-award-${activities.length}`,
              companyName: competitor,
              activityType: 'award',
              description: `Won $${(award['Award Amount'] / 1_000_000).toFixed(1)}M contract from ${award['Awarding Agency'] || 'Unknown Agency'}`,
              amount: `$${(award['Award Amount'] / 1_000_000).toFixed(1)}M`,
              agency: award['Awarding Agency'],
              naicsCode: award['NAICS Code'],
              date: award['Start Date'] || new Date().toISOString(),
              implication: `${competitor} expanding presence at ${award['Awarding Agency']}. Consider teaming or displacement strategy.`,
              source: 'USASpending',
              actionUrl: `https://www.usaspending.gov/award/${award['Award ID']}`,
            });
          }
        }
      }
    } catch (error) {
      console.error('[MA-Aggregator] USASpending fetch error:', error);
    }
  }

  return activities.slice(0, 5);
}

/**
 * Fetch capture signals from RSS (SAM.gov forecasts, sources sought, etc.)
 */
export async function fetchCaptureSignals(
  profile: MAUserProfile
): Promise<CaptureSignal[]> {
  const signals: CaptureSignal[] = [];

  try {
    const rssItems = await fetchAllRSSFeeds();
    const recentRss = filterRecentRSS(rssItems, 14); // 2 weeks
    const captureNews = filterRSSByKeywords(recentRss, CAPTURE_KEYWORDS);

    for (const item of captureNews.slice(0, 15)) {
      // Determine signal type
      let signalType: CaptureSignal['signalType'] = 'market_research';
      const textLower = `${item.title} ${item.description}`.toLowerCase();

      if (textLower.includes('sources sought')) signalType = 'sources_sought';
      else if (textLower.includes('rfi') || textLower.includes('request for information')) signalType = 'rfi';
      else if (textLower.includes('pre-solicitation')) signalType = 'pre_solicitation';
      else if (textLower.includes('draft rfp')) signalType = 'draft_rfp';
      else if (textLower.includes('forecast')) signalType = 'forecast';

      // Check agency relevance
      const matchedAgency = profile.targetAgencies.find(a =>
        textLower.includes(a.toLowerCase())
      );

      // Calculate fit score
      let fitScore = 30; // Base score for being in RSS
      if (matchedAgency) fitScore += 30;
      if (profile.naicsCodes.some(n => textLower.includes(n))) fitScore += 20;
      if (profile.capabilities.some(c => textLower.includes(c.toLowerCase()))) fitScore += 20;

      if (fitScore >= 40) { // Only include decent fits
        signals.push({
          id: `signal-${signals.length}`,
          signalType,
          title: item.title.substring(0, 100),
          agency: matchedAgency || extractAgencyFromText(item.title),
          agencyAcronym: matchedAgency || '',
          description: item.description.substring(0, 300),
          fitScore: Math.min(fitScore, 100),
          actionRequired: getActionRequired(signalType),
          actionUrl: item.link,
          source: item.source,
        });
      }
    }
  } catch (error) {
    console.error('[MA-Aggregator] Capture signals fetch error:', error);
  }

  // Sort by fit score
  signals.sort((a, b) => b.fitScore - a.fitScore);

  return signals.slice(0, 5);
}

/**
 * Helper: Get implication text for competitor activity
 */
function getCompetitorImplication(activityType: CompetitorActivity['activityType'], company: string): string {
  switch (activityType) {
    case 'award':
      return `${company} expanding market presence. Track for teaming or as future displacement target.`;
    case 'protest':
      return `${company} involved in protest. May create opportunity if they're the incumbent.`;
    case 'acquisition':
      return `${company} M&A activity. Watch for integration disruptions or capability shifts.`;
    case 'partnership':
      return `${company} forming partnerships. Consider similar teaming to stay competitive.`;
    case 'layoff':
      return `${company} reducing workforce. May affect service delivery; highlight your stability.`;
    case 'expansion':
      return `${company} expanding. Increased competition in your market segments.`;
    default:
      return `Monitor ${company} activity for competitive implications.`;
  }
}

/**
 * Helper: Get action required for signal type
 */
function getActionRequired(signalType: CaptureSignal['signalType']): string {
  switch (signalType) {
    case 'sources_sought':
      return 'Respond to sources sought to get on radar. Submit capability statement.';
    case 'rfi':
      return 'Review RFI and submit response to shape requirements.';
    case 'pre_solicitation':
      return 'Begin capture planning. Identify teaming partners.';
    case 'draft_rfp':
      return 'Review draft RFP. Prepare questions and comments.';
    case 'forecast':
      return 'Add to pipeline. Begin early positioning and outreach.';
    case 'market_research':
      return 'Monitor for updates. Consider proactive outreach to agency.';
    default:
      return 'Review and assess fit for pursuit.';
  }
}

/**
 * Helper: Extract agency from text
 */
function extractAgencyFromText(text: string): string {
  const agencies = ['DHS', 'DOD', 'VA', 'HHS', 'DOE', 'DOT', 'GSA', 'NASA', 'EPA', 'DOJ', 'State', 'Treasury', 'USDA', 'Interior', 'Commerce', 'Labor', 'HUD', 'Education', 'OPM', 'SBA'];

  for (const agency of agencies) {
    if (text.includes(agency) || text.toLowerCase().includes(agency.toLowerCase())) {
      return agency;
    }
  }

  return 'Federal';
}

/**
 * Main aggregator function
 */
export async function aggregateMABriefingData(
  profile: MAUserProfile
): Promise<{
  budgetShifts: BudgetShift[];
  painPointUpdates: PainPointUpdate[];
  competitorActivity: CompetitorActivity[];
  captureSignals: CaptureSignal[];
}> {
  console.log(`[MA-Aggregator] Starting aggregation for ${profile.email}...`);
  const startTime = Date.now();

  // Run all fetches in parallel
  const [budgetShifts, painPointUpdates, competitorActivity, captureSignals] = await Promise.all([
    fetchBudgetShifts(profile),
    fetchPainPointUpdates(profile),
    fetchCompetitorActivity(profile),
    fetchCaptureSignals(profile),
  ]);

  console.log(`[MA-Aggregator] Completed in ${Date.now() - startTime}ms`);
  console.log(`[MA-Aggregator] Budget: ${budgetShifts.length}, Pain: ${painPointUpdates.length}, Competitor: ${competitorActivity.length}, Signals: ${captureSignals.length}`);

  return {
    budgetShifts,
    painPointUpdates,
    competitorActivity,
    captureSignals,
  };
}
