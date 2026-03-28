/**
 * Admin: Send All 3 Briefing Types
 *
 * GET /api/admin/send-all-briefings?password=...&email=eric@govcongiants.com
 *
 * Fetches REAL contract data from USASpending based on user's NAICS codes,
 * then generates and sends using Claude AI:
 * 1. Daily Brief (Top 10 + 3 Ghosting Plays)
 * 2. Weekly Deep Dive (Full analysis + competitive landscape)
 * 3. Pursuit Brief (Single opportunity deep dive)
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

// NAICS prefix expansion for 3-digit codes
const NAICS_EXPANSION: Record<string, string[]> = {
  '236': ['236220', '236210', '236115', '236116', '236117', '236118'], // Construction of Buildings
  '237': ['237110', '237120', '237130', '237210', '237310', '237990'], // Heavy & Civil Engineering
  '238': ['238110', '238120', '238130', '238140', '238150', '238160', '238170', '238190', '238210', '238220', '238290', '238310', '238320', '238330', '238340', '238350', '238390', '238910', '238990'], // Specialty Trade Contractors
  '541': ['541511', '541512', '541513', '541519', '541611', '541612', '541613', '541614', '541618', '541620', '541690', '541710', '541720', '541810', '541820', '541830', '541840', '541850', '541860', '541870', '541890', '541910', '541921', '541922', '541930', '541940', '541990'], // Professional Services
  '518': ['518210'], // Data Processing, Hosting
  '519': ['519130', '519190'], // Other Information Services
  '561': ['561110', '561210', '561311', '561312', '561320', '561330', '561410', '561421', '561422', '561431', '561439', '561440', '561450', '561491', '561492', '561499', '561510', '561520', '561591', '561599', '561611', '561612', '561613', '561621', '561622', '561710', '561720', '561730', '561740', '561790', '561910', '561920', '561990'], // Administrative and Support Services
};

function expandNaicsCodes(codes: string[]): string[] {
  const expanded: string[] = [];
  for (const code of codes) {
    if (code.length === 3 && NAICS_EXPANSION[code]) {
      expanded.push(...NAICS_EXPANSION[code]);
    } else if (code.length === 6) {
      expanded.push(code);
    } else {
      // Try to match as prefix
      for (const [prefix, fullCodes] of Object.entries(NAICS_EXPANSION)) {
        if (code.startsWith(prefix)) {
          expanded.push(...fullCodes);
          break;
        }
      }
    }
  }
  return [...new Set(expanded)].slice(0, 10); // Dedupe and limit to 10
}

interface ContractForBriefing {
  contractNumber: string;
  contractName: string;
  agency: string;
  incumbent: string;
  value: number;
  naicsCode: string;
  expirationDate: string;
  daysUntilExpiration: number;
  setAside: string;
  description: string;
  numberOfBids?: number;
  competitionLevel?: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const toEmail = searchParams.get('email')?.toLowerCase().trim();

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!toEmail) {
    return NextResponse.json({ error: 'Email required (?email=...)' }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Get user's NAICS codes from settings
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: userSettings } = await supabase
    .from('user_notification_settings')
    .select('naics_codes, agencies, keywords')
    .eq('user_email', toEmail)
    .single();

  const userNaics = userSettings?.naics_codes || ['541512', '541611'];
  const userAgencies = userSettings?.agencies || [];
  const userKeywords = userSettings?.keywords || [];

  console.log(`[SendAllBriefings] User NAICS codes: ${userNaics.join(', ')}`);

  // Expand NAICS codes (3-digit → 6-digit)
  const expandedNaics = expandNaicsCodes(userNaics);
  console.log(`[SendAllBriefings] Expanded NAICS: ${expandedNaics.join(', ')}`);

  // Fetch REAL contract data from USASpending
  // Use the searchContractAwards function directly to get high-value contracts
  const allContracts: ContractForBriefing[] = [];
  for (const naics of expandedNaics.slice(0, 5)) { // Limit to 5 NAICS codes for speed
    try {
      console.log(`[SendAllBriefings] Fetching contracts for NAICS ${naics}...`);
      // Fetch ALL contracts for market intel (not just expiring ones)
      const response = await fetch(`https://api.usaspending.gov/api/v2/search/spending_by_award/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: {
            time_period: [{ start_date: '2022-01-01', end_date: '2027-12-31' }],
            award_type_codes: ['A', 'B', 'C', 'D'], // Contracts only
            naics_codes: { require: [naics] },
          },
          fields: [
            'Award ID', 'Recipient Name', 'Start Date', 'End Date',
            'Award Amount', 'Awarding Agency', 'Awarding Sub Agency',
            'generated_internal_id'
          ],
          page: 1,
          limit: 25,
          sort: 'Award Amount',
          order: 'desc',
        }),
      });

      if (!response.ok) {
        console.error(`[SendAllBriefings] USASpending error for ${naics}: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const awards = data.results || [];

      // Fetch detail for top contracts to get bid counts
      for (const award of awards.slice(0, 5)) {
        const awardId = award.generated_internal_id || award['Award ID'];
        try {
          const detailRes = await fetch(`https://api.usaspending.gov/api/v2/awards/${awardId}/`);
          if (detailRes.ok) {
            const detail = await detailRes.json();
            const contractData = detail.latest_transaction_contract_data || {};
            const periodPerf = detail.period_of_performance || {};
            const endDate = periodPerf.end_date || award['End Date'] || '';
            const daysUntil = endDate ? Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 180;

            const numberOfBids = parseInt(contractData.number_of_offers_received || '0', 10) || 0;
            const extentCompeted = contractData.extent_competed || '';
            let competitionLevel: 'sole_source' | 'low' | 'medium' | 'high' = 'medium';
            if (extentCompeted === 'C' || extentCompeted === 'B' || numberOfBids === 0) {
              competitionLevel = 'sole_source';
            } else if (numberOfBids <= 2) {
              competitionLevel = 'low';
            } else if (numberOfBids <= 5) {
              competitionLevel = 'medium';
            } else {
              competitionLevel = 'high';
            }

            allContracts.push({
              contractNumber: detail.piid || award['Award ID'],
              contractName: detail.description || `${naics} Contract - ${detail.awarding_agency?.toptier_agency?.name || award['Awarding Agency'] || 'Federal'}`,
              agency: detail.awarding_agency?.toptier_agency?.name || award['Awarding Agency'] || '',
              incumbent: detail.recipient?.recipient_name || award['Recipient Name'] || '',
              value: detail.total_obligation || Number(award['Award Amount']) || 0,
              naicsCode: naics,
              expirationDate: endDate,
              daysUntilExpiration: daysUntil,
              setAside: contractData.extent_competed_description || 'Full & Open',
              description: detail.description || `Federal contract in NAICS ${naics}`,
              numberOfBids,
              competitionLevel,
            });
          }
        } catch (detailErr) {
          console.error(`[SendAllBriefings] Error fetching award detail ${awardId}:`, detailErr);
        }
      }

      console.log(`[SendAllBriefings] NAICS ${naics}: ${awards.length} awards found, ${allContracts.length} total`);
    } catch (err) {
      console.error(`[SendAllBriefings] Error fetching NAICS ${naics}:`, err);
    }
  }

  // Sort by value (highest first) and take top 15
  allContracts.sort((a, b) => b.value - a.value);
  const topContracts = allContracts.slice(0, 15);

  console.log(`[SendAllBriefings] Total contracts fetched: ${allContracts.length}, using top ${topContracts.length}`);

  if (topContracts.length === 0) {
    return NextResponse.json({
      success: false,
      error: 'No contracts found for user NAICS codes',
      naicsCodes: userNaics,
      expandedNaics,
    }, { status: 400 });
  }

  const results = {
    daily: { success: false, error: '' },
    weekly: { success: false, error: '' },
    pursuit: { success: false, error: '' },
  };

  // 1. Generate and send Daily Brief
  try {
    console.log(`[SendAllBriefings] Generating Daily Brief with ${topContracts.length} contracts...`);
    const dailyBriefing = await generateDailyBrief(anthropic, topContracts);
    const dailyHtml = generateDailyEmailHtml(dailyBriefing);
    const dailyText = generateDailyEmailText(dailyBriefing);

    await sendEmail({
      to: toEmail,
      subject: `[1/3] DAILY BRIEF: 🎯 ${dailyBriefing.opportunities.length} Displacement Opportunities - ${dailyBriefing.opportunities[0]?.agency || 'Federal'} $${formatValue(dailyBriefing.opportunities[0]?.value || 0)} recompete`,
      html: dailyHtml,
      text: dailyText,
    });

    results.daily = { success: true, error: '' };
    console.log(`[SendAllBriefings] Daily Brief sent`);
  } catch (err) {
    console.error('[SendAllBriefings] Daily Brief error:', err);
    results.daily = { success: false, error: String(err) };
  }

  // 2. Generate and send Weekly Deep Dive
  try {
    console.log(`[SendAllBriefings] Generating Weekly Deep Dive...`);
    const weeklyBriefing = await generateWeeklyDeepDive(anthropic, topContracts);
    const weeklyHtml = generateWeeklyEmailHtml(weeklyBriefing);
    const weeklyText = generateWeeklyEmailText(weeklyBriefing);

    await sendEmail({
      to: toEmail,
      subject: `[2/3] WEEKLY DEEP DIVE: ${weeklyBriefing.opportunities.length} Opportunities Analyzed - Week of ${weeklyBriefing.weekOf}`,
      html: weeklyHtml,
      text: weeklyText,
    });

    results.weekly = { success: true, error: '' };
    console.log(`[SendAllBriefings] Weekly Deep Dive sent`);
  } catch (err) {
    console.error('[SendAllBriefings] Weekly error:', err);
    results.weekly = { success: false, error: String(err) };
  }

  // 3. Generate and send Pursuit Brief (for the top opportunity)
  try {
    console.log(`[SendAllBriefings] Generating Pursuit Brief for top opportunity...`);
    const pursuitBrief = await generatePursuitBrief(anthropic, topContracts[0]);
    const pursuitHtml = generatePursuitEmailHtml(pursuitBrief);
    const pursuitText = generatePursuitEmailText(pursuitBrief);

    await sendEmail({
      to: toEmail,
      subject: `[3/3] PURSUIT BRIEF: ${pursuitBrief.contractName} - Score: ${pursuitBrief.opportunityScore}/100`,
      html: pursuitHtml,
      text: pursuitText,
    });

    results.pursuit = { success: true, error: '' };
    console.log(`[SendAllBriefings] Pursuit Brief sent`);
  } catch (err) {
    console.error('[SendAllBriefings] Pursuit error:', err);
    results.pursuit = { success: false, error: String(err) };
  }

  const allSuccess = results.daily.success && results.weekly.success && results.pursuit.success;

  return NextResponse.json({
    success: allSuccess,
    toEmail,
    naicsUsed: userNaics,
    expandedNaics,
    contractsFetched: allContracts.length,
    contractsUsed: topContracts.length,
    results,
    message: allSuccess ? `All 3 briefings sent to ${toEmail}` : 'Some briefings failed - check results',
  });
}

// ============ DAILY BRIEF GENERATOR ============

interface DailyOpportunity {
  rank: number;
  contractName: string;
  agency: string;
  incumbent: string;
  value: number;
  window: string;
  displacementAngle: string;
}

interface DailyTeamingPlay {
  playNumber: number;
  strategyName: string;
  targetPrimes: string[];
  rationale: string;
  suggestedOpener: string;
}

interface DailyBriefing {
  date: string;
  opportunities: DailyOpportunity[];
  teamingPlays: DailyTeamingPlay[];
  mustWatch: string[];
}

async function generateDailyBrief(anthropic: Anthropic, contracts: ContractForBriefing[]): Promise<DailyBriefing> {
  const prompt = `You are a senior GovCon capture strategist. Analyze these federal contracts and generate a Daily Market Intel Briefing.

CONTRACT DATA (REAL DATA FROM USASPENDING):
${JSON.stringify(contracts, null, 2)}

Generate JSON with:
1. "opportunities" - Rank top 10 by actionability (not just value). Each needs: rank, contractName, agency, incumbent, value (number), window (timeline string), displacementAngle (strategic insight - WHY winnable NOW)
2. "teamingPlays" - 3 specific teaming plays. Each needs: playNumber, strategyName, targetPrimes (array of company names), rationale, suggestedOpener (copy-paste ready outreach message)
3. "mustWatch" - 4 key signals/events to monitor this week

DISPLACEMENT ANGLES TO IDENTIFY:
- Bridge contracts (vulnerability)
- Multiple extensions (procurement fatigue)
- 8(a) → unrestricted transitions
- M&A integration friction
- Performance issues (look at numberOfBids - low bids = vulnerable)
- New technology requirements
- Contracts with competitionLevel "sole_source" or "low" are high priority

Return ONLY valid JSON.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const data = JSON.parse(jsonMatch?.[0] || '{}');

  return {
    date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    opportunities: data.opportunities || [],
    teamingPlays: data.teamingPlays || [],
    mustWatch: data.mustWatch || [],
  };
}

// ============ WEEKLY DEEP DIVE GENERATOR ============

interface WeeklyOpportunity {
  rank: number;
  contractName: string;
  agency: string;
  incumbent: string;
  value: number;
  window: string;
  displacementAngle: string;
  keyDates: { label: string; date: string }[];
  competitiveLandscape: string[];
  recommendedApproach: string;
}

interface WeeklyTeamingPlay {
  playNumber: number;
  strategyName: string;
  targetCompany: string;
  whyTarget: string[];
  whoToContact: string[];
  suggestedOpener: string;
  followUpMessage: string;
}

interface WeeklyBriefing {
  weekOf: string;
  opportunities: WeeklyOpportunity[];
  teamingPlays: WeeklyTeamingPlay[];
  marketSignals: { headline: string; source: string; implication: string; actionRequired: boolean }[];
  calendar: { date: string; event: string; type: string; priority: string }[];
}

async function generateWeeklyDeepDive(anthropic: Anthropic, contracts: ContractForBriefing[]): Promise<WeeklyBriefing> {
  const monday = new Date();
  monday.setDate(monday.getDate() - monday.getDay() + 1);

  const prompt = `You are a senior GovCon capture strategist. Generate a Weekly Deep Dive briefing with full analysis.

CONTRACT DATA (REAL DATA FROM USASPENDING):
${JSON.stringify(contracts, null, 2)}

Generate JSON with:
1. "opportunities" - Top 10 with FULL analysis. Each needs: rank, contractName, agency, incumbent, value (number), window, displacementAngle, keyDates (array of {label, date}), competitiveLandscape (array of 3-4 insights about competition), recommendedApproach (string)
2. "teamingPlays" - 3 DETAILED plays. Each: playNumber, strategyName, targetCompany, whyTarget (array of reasons), whoToContact (array of roles/titles), suggestedOpener, followUpMessage
3. "marketSignals" - 4 news items based on the contract data. Each: headline, source, implication, actionRequired (boolean)
4. "calendar" - 6 key dates based on expiration dates. Each: date, event, type (deadline/industry_day/rfi_due/award_expected), priority (high/medium/low)

Focus on contracts with:
- Low numberOfBids (1-2 bids = vulnerable incumbent)
- competitionLevel "sole_source" or "low"
- Near-term expiration (daysUntilExpiration < 180)

Be specific with dates, names, dollar amounts. This is for strategic planning.

Return ONLY valid JSON.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 6000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const data = JSON.parse(jsonMatch?.[0] || '{}');

  return {
    weekOf: monday.toISOString().split('T')[0],
    opportunities: data.opportunities || [],
    teamingPlays: data.teamingPlays || [],
    marketSignals: data.marketSignals || [],
    calendar: data.calendar || [],
  };
}

// ============ PURSUIT BRIEF GENERATOR ============

interface PursuitBrief {
  contractName: string;
  agency: string;
  value: string;
  opportunityScore: number;
  whyWorthPursuing: string;
  workingHypothesis: string;
  priorityIntel: string[];
  outreachTargets: { priority: number; name: string; role: string; company?: string; approach: string }[];
  actionPlan: { day: number; action: string; owner: string }[];
  risks: { risk: string; likelihood: string; impact: string; mitigation: string }[];
  immediateNextMove: { action: string; owner: string; deadline: string };
}

async function generatePursuitBrief(anthropic: Anthropic, contract: ContractForBriefing): Promise<PursuitBrief> {
  const prompt = `You are a senior GovCon capture manager. Generate a 1-page Pursuit Brief for this opportunity.

OPPORTUNITY (REAL DATA FROM USASPENDING):
${JSON.stringify(contract, null, 2)}

Key factors:
- numberOfBids: ${contract.numberOfBids || 'Unknown'} (1-2 bids = high displacement potential)
- competitionLevel: ${contract.competitionLevel || 'Unknown'}
- daysUntilExpiration: ${contract.daysUntilExpiration} days

Generate JSON with:
1. "opportunityScore" - 0-100 based on winability (75+ = strong pursuit, 60-74 = conditional, <60 = evaluate). Factor in low bid count = higher score.
2. "whyWorthPursuing" - 2-3 sentence strategic rationale
3. "workingHypothesis" - Theory of the case for winning
4. "priorityIntel" - 5 must-answer questions before bid/no-bid
5. "outreachTargets" - 4 people to contact. Each: priority (1-4), name (title/role), role, company (optional), approach
6. "actionPlan" - 5-day plan. Each: day (1-5), action, owner (role)
7. "risks" - 4 risks. Each: risk, likelihood (high/medium/low), impact (high/medium/low), mitigation
8. "immediateNextMove" - Single most important action: action, owner, deadline

Be specific and actionable. This enables capture team decisions.

Return ONLY valid JSON.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const data = JSON.parse(jsonMatch?.[0] || '{}');

  return {
    contractName: contract.contractName,
    agency: contract.agency,
    value: `$${(contract.value / 1000000).toFixed(0)}M`,
    opportunityScore: data.opportunityScore || 70,
    whyWorthPursuing: data.whyWorthPursuing || '',
    workingHypothesis: data.workingHypothesis || '',
    priorityIntel: data.priorityIntel || [],
    outreachTargets: data.outreachTargets || [],
    actionPlan: data.actionPlan || [],
    risks: data.risks || [],
    immediateNextMove: data.immediateNextMove || { action: 'Review opportunity', owner: 'Capture Lead', deadline: 'Tomorrow' },
  };
}

// ============ EMAIL HTML GENERATORS ============

const BRAND_COLOR = '#1e3a8a';
const ACCENT_COLOR = '#7c3aed';
const SUCCESS_COLOR = '#10b981';

function formatValue(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M`;
  return `${(value / 1_000).toFixed(0)}K`;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Daily Brief Email
function generateDailyEmailHtml(briefing: DailyBriefing): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Market Intel</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; }
    .container { max-width: 680px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${ACCENT_COLOR} 100%); color: white; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; font-weight: 700; }
    .header p { margin: 12px 0 0; font-size: 16px; opacity: 0.9; }
    .section { padding: 24px; }
    .section-header { margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #e5e7eb; }
    .section-header h2 { margin: 0; font-size: 18px; color: ${BRAND_COLOR}; font-weight: 700; }
    .opportunity { background: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 16px; border-left: 4px solid ${ACCENT_COLOR}; }
    .opp-rank { display: inline-block; width: 28px; height: 28px; background: ${BRAND_COLOR}; color: white; border-radius: 50%; text-align: center; line-height: 28px; font-size: 14px; font-weight: 700; margin-right: 10px; }
    .opp-title { font-size: 17px; font-weight: 700; color: #111827; margin: 0 0 12px; }
    .opp-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; font-size: 13px; }
    .opp-meta-label { color: #6b7280; }
    .opp-meta-value { color: #111827; font-weight: 600; }
    .displacement-box { background: #fef3c7; border-radius: 6px; padding: 12px; margin-top: 12px; }
    .displacement-label { font-size: 11px; color: #92400e; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; }
    .displacement-text { font-size: 14px; color: #78350f; margin: 0; line-height: 1.5; }
    .teaming-play { background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-radius: 8px; padding: 20px; margin-bottom: 16px; border-left: 4px solid ${SUCCESS_COLOR}; }
    .play-number { background: ${SUCCESS_COLOR}; color: white; font-size: 12px; padding: 4px 10px; border-radius: 4px; font-weight: 700; }
    .play-name { font-size: 16px; font-weight: 700; color: #065f46; margin: 8px 0; }
    .play-targets { font-size: 13px; color: #047857; margin: 8px 0; }
    .play-rationale { font-size: 14px; color: #064e3b; line-height: 1.5; margin: 8px 0; }
    .play-opener { background: white; border-radius: 6px; padding: 14px; margin-top: 12px; border: 1px dashed #10b981; }
    .play-opener-label { font-size: 11px; color: #047857; font-weight: 700; text-transform: uppercase; margin-bottom: 6px; }
    .play-opener-text { font-size: 13px; color: #1f2937; line-height: 1.5; margin: 0; font-style: italic; }
    .must-watch { background: #fff7ed; border-radius: 8px; padding: 16px; margin-bottom: 12px; border-left: 4px solid #f97316; }
    .must-watch-item { font-size: 14px; color: #9a3412; margin: 8px 0; }
    .footer { background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb; }
    .footer p { margin: 0 0 8px; font-size: 12px; color: #6b7280; }
    .footer a { color: ${ACCENT_COLOR}; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎯 Daily Market Intel</h1>
      <p>${briefing.date}</p>
    </div>

    <div class="section">
      <div class="section-header">
        <h2>TOP ${briefing.opportunities.length} RECOMPETE OPPORTUNITIES</h2>
      </div>
      ${briefing.opportunities.map(opp => `
        <div class="opportunity">
          <h3 class="opp-title">
            <span class="opp-rank">${opp.rank}</span>
            ${escapeHtml(opp.contractName)}
          </h3>
          <div class="opp-meta">
            <div><span class="opp-meta-label">Agency:</span> <span class="opp-meta-value">${escapeHtml(opp.agency)}</span></div>
            <div><span class="opp-meta-label">Incumbent:</span> <span class="opp-meta-value">${escapeHtml(opp.incumbent)}</span></div>
            <div><span class="opp-meta-label">Value:</span> <span class="opp-meta-value" style="color: ${SUCCESS_COLOR};">$${formatValue(opp.value)}</span></div>
            <div><span class="opp-meta-label">Window:</span> <span class="opp-meta-value">${escapeHtml(opp.window)}</span></div>
          </div>
          <div class="displacement-box">
            <div class="displacement-label">Displacement Angle</div>
            <p class="displacement-text">${escapeHtml(opp.displacementAngle)}</p>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="section" style="background: #f0fdf4;">
      <div class="section-header">
        <h2>🤝 GHOSTING/TEAMING PLAYS</h2>
      </div>
      ${briefing.teamingPlays.map(play => `
        <div class="teaming-play">
          <span class="play-number">PLAY ${play.playNumber}</span>
          <h3 class="play-name">${escapeHtml(play.strategyName)}</h3>
          <p class="play-targets"><strong>Target:</strong> ${play.targetPrimes.map(p => escapeHtml(p)).join(', ')}</p>
          <p class="play-rationale">${escapeHtml(play.rationale)}</p>
          <div class="play-opener">
            <div class="play-opener-label">Suggested Opener (Copy & Paste)</div>
            <p class="play-opener-text">"${escapeHtml(play.suggestedOpener)}"</p>
          </div>
        </div>
      `).join('')}
    </div>

    ${briefing.mustWatch.length > 0 ? `
    <div class="section">
      <div class="section-header">
        <h2>👀 MUST WATCH THIS WEEK</h2>
      </div>
      <div class="must-watch">
        ${briefing.mustWatch.map(item => `<p class="must-watch-item">• ${escapeHtml(item)}</p>`).join('')}
      </div>
    </div>
    ` : ''}

    <div class="footer">
      <p>Generated by <strong>GovCon Giants AI</strong> • ${briefing.opportunities.length} contracts analyzed</p>
      <p><a href="https://shop.govcongiants.org/briefings">View Full Analysis</a> | <a href="https://shop.govcongiants.org/briefings/settings">Manage Preferences</a></p>
    </div>
  </div>
</body>
</html>
`;
}

function generateDailyEmailText(briefing: DailyBriefing): string {
  let text = `🎯 DAILY MARKET INTEL\n${briefing.date}\n${'='.repeat(40)}\n\n`;
  text += `TOP ${briefing.opportunities.length} RECOMPETE OPPORTUNITIES\n${'='.repeat(40)}\n\n`;

  for (const opp of briefing.opportunities) {
    text += `${opp.rank}. ${opp.contractName}\n`;
    text += `   Agency: ${opp.agency}\n`;
    text += `   Incumbent: ${opp.incumbent}\n`;
    text += `   Value: $${formatValue(opp.value)}\n`;
    text += `   Window: ${opp.window}\n\n`;
    text += `   DISPLACEMENT ANGLE: ${opp.displacementAngle}\n\n`;
    text += `${'─'.repeat(40)}\n\n`;
  }

  text += `🤝 TEAMING PLAYS\n${'='.repeat(40)}\n\n`;

  for (const play of briefing.teamingPlays) {
    text += `PLAY ${play.playNumber}: ${play.strategyName}\n`;
    text += `Target: ${play.targetPrimes.join(', ')}\n`;
    text += `${play.rationale}\n\n`;
    text += `SUGGESTED OPENER:\n"${play.suggestedOpener}"\n\n`;
    text += `${'─'.repeat(40)}\n\n`;
  }

  return text;
}

// Weekly Deep Dive Email
function generateWeeklyEmailHtml(briefing: WeeklyBriefing): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Deep Dive</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; }
    .container { max-width: 700px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${ACCENT_COLOR} 100%); color: white; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 26px; font-weight: 700; }
    .header p { margin: 12px 0 0; font-size: 15px; opacity: 0.9; }
    .section { padding: 24px; }
    .section-header { margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #e5e7eb; }
    .section-header h2 { margin: 0; font-size: 18px; color: ${BRAND_COLOR}; font-weight: 700; }
    .opportunity { background: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 20px; border-left: 4px solid ${ACCENT_COLOR}; }
    .opp-rank { display: inline-block; width: 28px; height: 28px; background: ${BRAND_COLOR}; color: white; border-radius: 50%; text-align: center; line-height: 28px; font-size: 14px; font-weight: 700; margin-right: 10px; }
    .opp-title { font-size: 17px; font-weight: 700; color: #111827; margin: 0 0 15px; }
    .opp-meta-row { display: flex; margin-bottom: 6px; font-size: 13px; }
    .opp-meta-label { color: #6b7280; width: 100px; }
    .opp-meta-value { color: #111827; font-weight: 600; }
    .displacement-box { background: #fef3c7; border-radius: 6px; padding: 12px; margin: 12px 0; }
    .displacement-label { font-size: 11px; color: #92400e; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; }
    .displacement-text { font-size: 14px; color: #78350f; margin: 0; line-height: 1.5; }
    .landscape-box { background: #f0f9ff; border-radius: 6px; padding: 12px; margin: 12px 0; }
    .landscape-label { font-size: 11px; color: #0369a1; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; }
    .landscape-item { font-size: 13px; color: #0c4a6e; margin: 4px 0; padding-left: 12px; border-left: 2px solid #0ea5e9; }
    .dates-box { background: #fdf4ff; border-radius: 6px; padding: 12px; margin: 12px 0; }
    .dates-label { font-size: 11px; color: #86198f; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; }
    .date-item { font-size: 13px; color: #4a044e; margin: 4px 0; }
    .teaming-play { background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-radius: 8px; padding: 20px; margin-bottom: 16px; border-left: 4px solid ${SUCCESS_COLOR}; }
    .play-number { background: ${SUCCESS_COLOR}; color: white; font-size: 12px; padding: 4px 10px; border-radius: 4px; font-weight: 700; }
    .play-name { font-size: 16px; font-weight: 700; color: #065f46; margin: 8px 0 0; }
    .play-target { font-size: 14px; color: #047857; margin: 8px 0; }
    .play-why-item { font-size: 13px; color: #064e3b; margin: 4px 0; padding-left: 12px; border-left: 2px solid #10b981; }
    .contacts-box { background: white; border-radius: 6px; padding: 12px; margin: 12px 0; border: 1px solid #d1fae5; }
    .contacts-label { font-size: 11px; color: #047857; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; }
    .contact-item { font-size: 13px; color: #1f2937; margin: 4px 0; }
    .opener-box { background: white; border-radius: 6px; padding: 14px; margin: 12px 0; border: 1px dashed #10b981; }
    .opener-label { font-size: 11px; color: #047857; font-weight: 700; text-transform: uppercase; margin-bottom: 6px; }
    .opener-text { font-size: 13px; color: #1f2937; line-height: 1.5; margin: 0; font-style: italic; }
    .signal-box { background: #fff7ed; border-radius: 8px; padding: 16px; margin-bottom: 12px; border-left: 4px solid #f97316; }
    .signal-headline { font-size: 15px; font-weight: 700; color: #9a3412; margin: 0 0 8px; }
    .signal-source { font-size: 12px; color: #ea580c; margin-bottom: 8px; }
    .signal-implication { font-size: 14px; color: #7c2d12; margin: 0; }
    .calendar-item { display: flex; padding: 12px; background: #f9fafb; border-radius: 6px; margin-bottom: 8px; align-items: center; }
    .cal-date { font-size: 13px; font-weight: 700; color: ${BRAND_COLOR}; width: 100px; }
    .cal-event { font-size: 13px; color: #111827; flex: 1; }
    .cal-priority { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    .priority-high { background: #fee2e2; color: #991b1b; }
    .priority-medium { background: #fef3c7; color: #92400e; }
    .priority-low { background: #dbeafe; color: #1e40af; }
    .footer { background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb; }
    .footer p { margin: 0 0 8px; font-size: 12px; color: #6b7280; }
    .footer a { color: ${ACCENT_COLOR}; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Weekly Deep Dive</h1>
      <p>Week of ${briefing.weekOf} • ${briefing.opportunities.length} Opportunities Analyzed</p>
    </div>

    <div class="section">
      <div class="section-header">
        <h2>TOP ${briefing.opportunities.length} OPPORTUNITIES (Full Analysis)</h2>
      </div>
      ${briefing.opportunities.map(opp => `
        <div class="opportunity">
          <h3 class="opp-title">
            <span class="opp-rank">${opp.rank}</span>
            ${escapeHtml(opp.contractName)}
          </h3>
          <div style="margin-bottom: 12px;">
            <div class="opp-meta-row"><span class="opp-meta-label">Agency:</span><span class="opp-meta-value">${escapeHtml(opp.agency)}</span></div>
            <div class="opp-meta-row"><span class="opp-meta-label">Incumbent:</span><span class="opp-meta-value">${escapeHtml(opp.incumbent)}</span></div>
            <div class="opp-meta-row"><span class="opp-meta-label">Value:</span><span class="opp-meta-value" style="color: ${SUCCESS_COLOR};">$${formatValue(opp.value)}</span></div>
            <div class="opp-meta-row"><span class="opp-meta-label">Window:</span><span class="opp-meta-value">${escapeHtml(opp.window)}</span></div>
          </div>
          <div class="displacement-box">
            <div class="displacement-label">Displacement Angle</div>
            <p class="displacement-text">${escapeHtml(opp.displacementAngle)}</p>
          </div>
          ${opp.competitiveLandscape?.length > 0 ? `
            <div class="landscape-box">
              <div class="landscape-label">Competitive Landscape</div>
              ${opp.competitiveLandscape.map(item => `<div class="landscape-item">${escapeHtml(item)}</div>`).join('')}
            </div>
          ` : ''}
          ${opp.keyDates?.length > 0 ? `
            <div class="dates-box">
              <div class="dates-label">Key Dates</div>
              ${opp.keyDates.map(d => `<div class="date-item">📅 <strong>${escapeHtml(d.label)}:</strong> ${escapeHtml(d.date)}</div>`).join('')}
            </div>
          ` : ''}
          ${opp.recommendedApproach ? `<div style="font-size: 13px; color: #4b5563; margin-top: 12px;"><strong>Recommended Approach:</strong> ${escapeHtml(opp.recommendedApproach)}</div>` : ''}
        </div>
      `).join('')}
    </div>

    <div class="section" style="background: #f0fdf4;">
      <div class="section-header">
        <h2>🤝 TEAMING PLAYS (with Outreach Templates)</h2>
      </div>
      ${briefing.teamingPlays.map(play => `
        <div class="teaming-play">
          <span class="play-number">PLAY ${play.playNumber}</span>
          <h3 class="play-name">${escapeHtml(play.strategyName)}</h3>
          <p class="play-target"><strong>Target:</strong> ${escapeHtml(play.targetCompany)}</p>
          ${play.whyTarget?.length > 0 ? `
            <div style="margin: 12px 0;">
              <strong style="font-size: 12px; color: #065f46;">Why Target:</strong>
              ${play.whyTarget.map(item => `<div class="play-why-item">${escapeHtml(item)}</div>`).join('')}
            </div>
          ` : ''}
          ${play.whoToContact?.length > 0 ? `
            <div class="contacts-box">
              <div class="contacts-label">Who to Contact</div>
              ${play.whoToContact.map(c => `<div class="contact-item">• ${escapeHtml(c)}</div>`).join('')}
            </div>
          ` : ''}
          <div class="opener-box">
            <div class="opener-label">Suggested Opener</div>
            <p class="opener-text">"${escapeHtml(play.suggestedOpener)}"</p>
          </div>
          ${play.followUpMessage ? `
            <div class="opener-box" style="border-color: #86efac;">
              <div class="opener-label" style="color: #15803d;">Follow-Up Message</div>
              <p class="opener-text">"${escapeHtml(play.followUpMessage)}"</p>
            </div>
          ` : ''}
        </div>
      `).join('')}
    </div>

    ${briefing.marketSignals?.length > 0 ? `
      <div class="section">
        <div class="section-header">
          <h2>📰 MARKET SIGNALS</h2>
        </div>
        ${briefing.marketSignals.map(signal => `
          <div class="signal-box">
            <h4 class="signal-headline">${signal.actionRequired ? '🔴 ' : ''}${escapeHtml(signal.headline)}</h4>
            <p class="signal-source">Source: ${escapeHtml(signal.source)}</p>
            <p class="signal-implication"><strong>Implication:</strong> ${escapeHtml(signal.implication)}</p>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${briefing.calendar?.length > 0 ? `
      <div class="section" style="background: #faf5ff;">
        <div class="section-header">
          <h2>📅 KEY DATES (Next 30 Days)</h2>
        </div>
        ${briefing.calendar.map(item => `
          <div class="calendar-item">
            <span class="cal-date">${escapeHtml(item.date)}</span>
            <span class="cal-event">${escapeHtml(item.event)}</span>
            <span class="cal-priority priority-${item.priority}">${item.priority.toUpperCase()}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="footer">
      <p>Generated by <strong>GovCon Giants AI</strong></p>
      <p><a href="https://shop.govcongiants.org/briefings">View Full Analysis</a> | <a href="https://shop.govcongiants.org/briefings/settings">Manage Preferences</a></p>
    </div>
  </div>
</body>
</html>
`;
}

function generateWeeklyEmailText(briefing: WeeklyBriefing): string {
  let text = `📊 WEEKLY DEEP DIVE\nWeek of ${briefing.weekOf}\n${'='.repeat(40)}\n\n`;

  for (const opp of briefing.opportunities) {
    text += `${opp.rank}. ${opp.contractName}\n`;
    text += `   Agency: ${opp.agency}\n`;
    text += `   Incumbent: ${opp.incumbent}\n`;
    text += `   Value: $${formatValue(opp.value)}\n`;
    text += `   Window: ${opp.window}\n\n`;
    text += `   DISPLACEMENT ANGLE: ${opp.displacementAngle}\n\n`;
    if (opp.competitiveLandscape?.length > 0) {
      text += `   COMPETITIVE LANDSCAPE:\n`;
      opp.competitiveLandscape.forEach(c => { text += `   • ${c}\n`; });
    }
    text += `\n${'─'.repeat(40)}\n\n`;
  }

  return text;
}

// Pursuit Brief Email
function generatePursuitEmailHtml(brief: PursuitBrief): string {
  const scoreColor = brief.opportunityScore >= 75 ? SUCCESS_COLOR : brief.opportunityScore >= 60 ? '#f59e0b' : '#ef4444';
  const scoreLabel = brief.opportunityScore >= 75 ? 'STRONG PURSUIT' : brief.opportunityScore >= 60 ? 'CONDITIONAL' : 'EVALUATE';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pursuit Brief</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; }
    .container { max-width: 700px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, ${BRAND_COLOR} 0%, ${ACCENT_COLOR} 100%); color: white; padding: 32px 24px; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 700; }
    .header-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; flex-wrap: wrap; gap: 16px; }
    .header-meta p { margin: 0; font-size: 14px; opacity: 0.9; }
    .score-badge { background: ${scoreColor}; color: white; padding: 8px 16px; border-radius: 6px; font-weight: 700; text-align: center; }
    .score-number { font-size: 24px; }
    .score-label { font-size: 11px; text-transform: uppercase; }
    .section { padding: 24px; border-bottom: 1px solid #e5e7eb; }
    .section-title { font-size: 14px; color: ${BRAND_COLOR}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 12px; }
    .section-content { font-size: 15px; color: #374151; line-height: 1.6; margin: 0; }
    .hypothesis-box { background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-radius: 8px; padding: 20px; border-left: 4px solid ${BRAND_COLOR}; }
    .intel-list { list-style: none; padding: 0; margin: 0; }
    .intel-item { display: flex; align-items: flex-start; padding: 10px 0; border-bottom: 1px dashed #e5e7eb; }
    .intel-item:last-child { border-bottom: none; }
    .intel-number { width: 24px; height: 24px; background: ${ACCENT_COLOR}; color: white; border-radius: 50%; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-right: 12px; flex-shrink: 0; }
    .intel-text { font-size: 14px; color: #374151; }
    .outreach-card { background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .outreach-priority { display: inline-block; background: ${BRAND_COLOR}; color: white; font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; margin-bottom: 8px; }
    .outreach-name { font-size: 15px; font-weight: 700; color: #111827; margin: 0 0 4px; }
    .outreach-role { font-size: 13px; color: #6b7280; margin: 0 0 8px; }
    .outreach-approach { font-size: 13px; color: #374151; font-style: italic; }
    .action-timeline { background: #f0fdf4; border-radius: 8px; padding: 16px; }
    .action-item { display: flex; padding: 8px 0; border-bottom: 1px dashed #d1fae5; }
    .action-item:last-child { border-bottom: none; }
    .action-day { width: 60px; font-size: 13px; font-weight: 700; color: ${SUCCESS_COLOR}; }
    .action-task { font-size: 13px; color: #374151; flex: 1; }
    .action-owner { font-size: 12px; color: #6b7280; width: 80px; text-align: right; }
    .risk-card { background: #fef2f2; border-radius: 8px; padding: 16px; margin-bottom: 12px; border-left: 4px solid #ef4444; }
    .risk-header { display: flex; align-items: center; margin-bottom: 8px; gap: 8px; flex-wrap: wrap; }
    .risk-likelihood { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    .likelihood-high { background: #fee2e2; color: #991b1b; }
    .likelihood-medium { background: #fef3c7; color: #92400e; }
    .likelihood-low { background: #dbeafe; color: #1e40af; }
    .risk-text { font-size: 14px; font-weight: 600; color: #991b1b; margin: 0; }
    .risk-mitigation { font-size: 13px; color: #7f1d1d; margin: 8px 0 0; }
    .next-move { background: linear-gradient(135deg, ${SUCCESS_COLOR} 0%, #059669 100%); border-radius: 8px; padding: 24px; color: white; text-align: center; }
    .next-move h3 { margin: 0 0 12px; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9; }
    .next-move-action { font-size: 18px; font-weight: 700; margin: 0 0 12px; }
    .next-move-meta { font-size: 14px; opacity: 0.9; }
    .footer { background: #f9fafb; padding: 24px; text-align: center; }
    .footer p { margin: 0 0 8px; font-size: 12px; color: #6b7280; }
    .footer a { color: ${ACCENT_COLOR}; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎯 PURSUIT BRIEF</h1>
      <div class="header-meta">
        <div>
          <p><strong>${escapeHtml(brief.contractName)}</strong></p>
          <p>${escapeHtml(brief.agency)} • ${escapeHtml(brief.value)}</p>
        </div>
        <div class="score-badge">
          <div class="score-number">${brief.opportunityScore}</div>
          <div class="score-label">${scoreLabel}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Why This Is Worth Pursuing</h2>
      <p class="section-content">${escapeHtml(brief.whyWorthPursuing)}</p>
    </div>

    <div class="section">
      <h2 class="section-title">Working Hypothesis</h2>
      <div class="hypothesis-box">
        <p class="section-content">${escapeHtml(brief.workingHypothesis)}</p>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Priority Intelligence Requirements</h2>
      <ul class="intel-list">
        ${brief.priorityIntel.map((intel, i) => `
          <li class="intel-item">
            <span class="intel-number">${i + 1}</span>
            <span class="intel-text">${escapeHtml(intel)}</span>
          </li>
        `).join('')}
      </ul>
    </div>

    <div class="section">
      <h2 class="section-title">First Outreach Targets</h2>
      ${brief.outreachTargets.map(target => `
        <div class="outreach-card">
          <span class="outreach-priority">PRIORITY ${target.priority}</span>
          <h4 class="outreach-name">${escapeHtml(target.name)}</h4>
          <p class="outreach-role">${escapeHtml(target.role)}${target.company ? ` • ${escapeHtml(target.company)}` : ''}</p>
          <p class="outreach-approach">Approach: ${escapeHtml(target.approach)}</p>
        </div>
      `).join('')}
    </div>

    <div class="section">
      <h2 class="section-title">5-Day Action Plan</h2>
      <div class="action-timeline">
        ${brief.actionPlan.map(action => `
          <div class="action-item">
            <span class="action-day">Day ${action.day}</span>
            <span class="action-task">${escapeHtml(action.action)}</span>
            <span class="action-owner">${escapeHtml(action.owner)}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Risk Assessment</h2>
      ${brief.risks.map(risk => `
        <div class="risk-card">
          <div class="risk-header">
            <span class="risk-likelihood likelihood-${risk.likelihood}">${risk.likelihood.toUpperCase()}</span>
            <span class="risk-likelihood likelihood-${risk.impact}">Impact: ${risk.impact.toUpperCase()}</span>
          </div>
          <p class="risk-text">${escapeHtml(risk.risk)}</p>
          <p class="risk-mitigation"><strong>Mitigation:</strong> ${escapeHtml(risk.mitigation)}</p>
        </div>
      `).join('')}
    </div>

    <div class="section" style="border-bottom: none;">
      <h2 class="section-title">Immediate Next Move</h2>
      <div class="next-move">
        <h3>Do This Today</h3>
        <p class="next-move-action">${escapeHtml(brief.immediateNextMove.action)}</p>
        <p class="next-move-meta">
          <strong>Owner:</strong> ${escapeHtml(brief.immediateNextMove.owner)} •
          <strong>Deadline:</strong> ${escapeHtml(brief.immediateNextMove.deadline)}
        </p>
      </div>
    </div>

    <div class="footer">
      <p>Generated by <strong>GovCon Giants AI</strong></p>
      <p><a href="https://shop.govcongiants.org/briefings">View Full Analysis</a> | <a href="https://shop.govcongiants.org/briefings/settings">Manage Preferences</a></p>
    </div>
  </div>
</body>
</html>
`;
}

function generatePursuitEmailText(brief: PursuitBrief): string {
  return `
🎯 PURSUIT BRIEF
${'='.repeat(40)}

${brief.contractName}
${brief.agency} • ${brief.value}

OPPORTUNITY SCORE: ${brief.opportunityScore}/100

${'='.repeat(40)}
WHY THIS IS WORTH PURSUING
${'='.repeat(40)}
${brief.whyWorthPursuing}

${'='.repeat(40)}
WORKING HYPOTHESIS
${'='.repeat(40)}
${brief.workingHypothesis}

${'='.repeat(40)}
PRIORITY INTELLIGENCE REQUIREMENTS
${'='.repeat(40)}
${brief.priorityIntel.map((intel, i) => `${i + 1}. ${intel}`).join('\n')}

${'='.repeat(40)}
FIRST OUTREACH TARGETS
${'='.repeat(40)}
${brief.outreachTargets.map(t => `[Priority ${t.priority}] ${t.name}\nRole: ${t.role}${t.company ? ` • ${t.company}` : ''}\nApproach: ${t.approach}`).join('\n\n')}

${'='.repeat(40)}
5-DAY ACTION PLAN
${'='.repeat(40)}
${brief.actionPlan.map(a => `Day ${a.day}: ${a.action} [${a.owner}]`).join('\n')}

${'='.repeat(40)}
RISK ASSESSMENT
${'='.repeat(40)}
${brief.risks.map(r => `⚠️ ${r.risk}\n   Likelihood: ${r.likelihood} | Impact: ${r.impact}\n   Mitigation: ${r.mitigation}`).join('\n\n')}

${'='.repeat(40)}
IMMEDIATE NEXT MOVE
${'='.repeat(40)}
${brief.immediateNextMove.action}
Owner: ${brief.immediateNextMove.owner}
Deadline: ${brief.immediateNextMove.deadline}

Generated by GovCon Giants AI
`;
}
