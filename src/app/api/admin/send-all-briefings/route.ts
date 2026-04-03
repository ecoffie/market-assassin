/**
 * Admin: Send All 3 Briefing Types
 *
 * GET /api/admin/send-all-briefings?password=...&email=eric@govcongiants.com
 *
 * NEW RUBRIC (April 2026):
 * 1. Daily Brief → SAM.gov ACTIVE solicitations (bid NOW, deadlines matter)
 * 2. Weekly Deep Dive → USASpending recompete intel (position BEFORE RFP drops)
 * 3. Pursuit Brief → Combined best opportunities with capture strategy
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';
import { fetchSamOpportunities, SAMOpportunity } from '@/lib/briefings/pipelines/sam-gov';

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
      for (const [prefix, fullCodes] of Object.entries(NAICS_EXPANSION)) {
        if (code.startsWith(prefix)) {
          expanded.push(...fullCodes);
          break;
        }
      }
    }
  }
  return [...new Set(expanded)].slice(0, 10);
}

// Helper: Get date N days ago in MM/dd/yyyy format for SAM.gov
function getDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
}

// Helper: Calculate days until deadline
function getDaysUntil(dateString: string): number {
  if (!dateString) return 999;
  const target = new Date(dateString);
  const today = new Date();
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
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

  // ============ FETCH DATA FOR BOTH BRIEFING TYPES ============

  // 1. SAM.gov Opportunities for Daily Brief (ACTIVE solicitations)
  const SAM_API_KEY = process.env.SAM_API_KEY || '';
  let samOpportunities: SAMOpportunity[] = [];

  try {
    console.log(`[SendAllBriefings] Fetching SAM.gov opportunities...`);
    const samResult = await fetchSamOpportunities({
      naicsCodes: expandedNaics.slice(0, 10),
      postedFrom: getDateDaysAgo(30), // Last 30 days
      limit: 50,
    }, SAM_API_KEY);
    samOpportunities = samResult.opportunities;
    console.log(`[SendAllBriefings] SAM.gov: ${samOpportunities.length} active opportunities found`);
  } catch (err) {
    console.error('[SendAllBriefings] SAM.gov fetch error:', err);
  }

  // 2. USASpending for Weekly Deep Dive (RECOMPETE intel)
  const allContracts: ContractForBriefing[] = [];
  for (const naics of expandedNaics.slice(0, 5)) {
    try {
      console.log(`[SendAllBriefings] Fetching USASpending contracts for NAICS ${naics}...`);
      const response = await fetch(`https://api.usaspending.gov/api/v2/search/spending_by_award/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: {
            time_period: [{ start_date: '2022-01-01', end_date: '2027-12-31' }],
            award_type_codes: ['A', 'B', 'C', 'D'],
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

      if (!response.ok) continue;

      const data = await response.json();
      const awards = data.results || [];

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
            let competitionLevel: 'sole_source' | 'low' | 'medium' | 'high' = 'medium';
            if (numberOfBids === 0) competitionLevel = 'sole_source';
            else if (numberOfBids <= 2) competitionLevel = 'low';
            else if (numberOfBids <= 5) competitionLevel = 'medium';
            else competitionLevel = 'high';

            allContracts.push({
              contractNumber: detail.piid || award['Award ID'],
              contractName: detail.description || `${naics} Contract - ${detail.awarding_agency?.toptier_agency?.name || 'Federal'}`,
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
          console.error(`[SendAllBriefings] Error fetching award detail:`, detailErr);
        }
      }
    } catch (err) {
      console.error(`[SendAllBriefings] Error fetching NAICS ${naics}:`, err);
    }
  }

  allContracts.sort((a, b) => b.value - a.value);
  const topContracts = allContracts.slice(0, 15);

  console.log(`[SendAllBriefings] USASpending: ${allContracts.length} contracts, using top ${topContracts.length}`);

  // Need at least one data source
  if (samOpportunities.length === 0 && topContracts.length === 0) {
    return NextResponse.json({
      success: false,
      error: 'No data found for user NAICS codes',
      naicsCodes: userNaics,
      expandedNaics,
    }, { status: 400 });
  }

  const results = {
    daily: { success: false, error: '' },
    weekly: { success: false, error: '' },
    pursuit: { success: false, error: '' },
  };

  // 1. Generate and send Daily Brief (NEW: SAM.gov Active Solicitations)
  try {
    if (samOpportunities.length > 0) {
      console.log(`[SendAllBriefings] Generating Daily Brief with ${samOpportunities.length} SAM.gov opportunities...`);
      const dailyBriefing = await generateDailyBriefFromSam(anthropic, samOpportunities);
      const dailyHtml = generateDailyEmailHtmlFromSam(dailyBriefing);
      const dailyText = generateDailyEmailTextFromSam(dailyBriefing);

      const urgentCount = dailyBriefing.opportunities.filter(o => o.daysRemaining <= 14).length;
      await sendEmail({
        to: toEmail,
        subject: `[1/3] DAILY BRIEF: 📋 ${dailyBriefing.opportunities.length} Active Solicitations${urgentCount > 0 ? ` (${urgentCount} due soon!)` : ''} - BID NOW`,
        html: dailyHtml,
        text: dailyText,
      });

      results.daily = { success: true, error: '' };
      console.log(`[SendAllBriefings] Daily Brief (SAM.gov) sent`);
    } else {
      // Fallback to old USASpending-based Daily Brief if no SAM.gov opps
      console.log(`[SendAllBriefings] No SAM.gov opps, using USASpending fallback...`);
      const dailyBriefing = await generateDailyBrief(anthropic, topContracts);
      const dailyHtml = generateDailyEmailHtml(dailyBriefing);
      const dailyText = generateDailyEmailText(dailyBriefing);

      await sendEmail({
        to: toEmail,
        subject: `[1/3] DAILY BRIEF: 🎯 ${dailyBriefing.opportunities.length} Displacement Opportunities`,
        html: dailyHtml,
        text: dailyText,
      });

      results.daily = { success: true, error: '' };
      console.log(`[SendAllBriefings] Daily Brief (fallback) sent`);
    }
  } catch (err) {
    console.error('[SendAllBriefings] Daily Brief error:', err);
    results.daily = { success: false, error: String(err) };
  }

  // 2. Generate and send Weekly Deep Dive (with SAM.gov status enrichment)
  try {
    console.log(`[SendAllBriefings] Generating Weekly Deep Dive with SAM.gov status...`);
    const weeklyBriefing = await generateWeeklyDeepDive(anthropic, topContracts, samOpportunities);
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
    samOpportunities: samOpportunities.length,
    usaSpendingContracts: topContracts.length,
    results,
    message: allSuccess ? `All 3 briefings sent to ${toEmail}` : 'Some briefings failed - check results',
  });
}

// ============ SAM.gov DAILY BRIEF GENERATOR (NEW) ============

interface SamDailyOpportunity {
  rank: number;
  title: string;
  agency: string;
  naicsCode: string;
  setAside: string | null;
  responseDeadline: string;
  daysRemaining: number;
  noticeType: string;
  solicitationNumber: string;
  samLink: string;
  quickWinAssessment: string;
}

interface SamDailyBriefing {
  date: string;
  opportunities: SamDailyOpportunity[];
  deadlinesThisWeek: { title: string; deadline: string; daysRemaining: number; samLink: string }[];
  actionTips: string[];
}

async function generateDailyBriefFromSam(anthropic: Anthropic, samOpportunities: SAMOpportunity[]): Promise<SamDailyBriefing> {
  // Sort by deadline (soonest first) and filter active
  const sorted = [...samOpportunities]
    .filter(o => o.active && o.responseDeadline)
    .sort((a, b) => new Date(a.responseDeadline).getTime() - new Date(b.responseDeadline).getTime())
    .slice(0, 10);

  // Ask Claude for strategic analysis of each opportunity
  const prompt = `You are a senior GovCon capture strategist. Analyze these ACTIVE SAM.gov solicitations and provide quick win assessments.

ACTIVE SOLICITATIONS (FROM SAM.gov):
${JSON.stringify(sorted.map(o => ({
  title: o.title,
  agency: o.department,
  naics: o.naicsCode,
  setAside: o.setAsideDescription || 'Full & Open',
  deadline: o.responseDeadline,
  type: o.noticeType,
  description: o.description?.slice(0, 300),
})), null, 2)}

For each opportunity, generate a "quickWinAssessment" - ONE sentence explaining:
- WHY this is winnable for a small/mid business
- What makes it actionable NOW
- Key consideration (timeline, teaming, set-aside advantage)

Also provide 3 "actionTips" - brief actionable advice for this batch of opportunities.

Return JSON:
{
  "assessments": [
    { "title": "exact title from input", "quickWinAssessment": "one sentence assessment" }
  ],
  "actionTips": ["tip 1", "tip 2", "tip 3"]
}

Return ONLY valid JSON.`;

  let assessmentsMap: Record<string, string> = {};
  let actionTips: string[] = [];

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      assessmentsMap = Object.fromEntries(
        (data.assessments || []).map((a: any) => [a.title, a.quickWinAssessment])
      );
      actionTips = data.actionTips || [];
    }
  } catch (err) {
    console.error('[DailyBriefSam] Claude analysis error:', err);
  }

  // Build the briefing
  const opportunities: SamDailyOpportunity[] = sorted.slice(0, 5).map((opp, idx) => ({
    rank: idx + 1,
    title: opp.title,
    agency: opp.department || opp.subTier || 'Federal',
    naicsCode: opp.naicsCode,
    setAside: opp.setAsideDescription || opp.setAside,
    responseDeadline: opp.responseDeadline,
    daysRemaining: getDaysUntil(opp.responseDeadline),
    noticeType: opp.noticeType,
    solicitationNumber: opp.solicitationNumber,
    samLink: opp.uiLink || `https://sam.gov/opp/${opp.noticeId}/view`,
    quickWinAssessment: assessmentsMap[opp.title] || 'Active opportunity matching your NAICS - review requirements and deadline.',
  }));

  // Deadlines this week
  const weekFromNow = 7;
  const deadlinesThisWeek = sorted
    .filter(o => getDaysUntil(o.responseDeadline) <= weekFromNow && getDaysUntil(o.responseDeadline) >= 0)
    .map(o => ({
      title: o.title.slice(0, 60) + (o.title.length > 60 ? '...' : ''),
      deadline: o.responseDeadline,
      daysRemaining: getDaysUntil(o.responseDeadline),
      samLink: o.uiLink || `https://sam.gov/opp/${o.noticeId}/view`,
    }));

  return {
    date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    opportunities,
    deadlinesThisWeek,
    actionTips: actionTips.length > 0 ? actionTips : [
      'Review solicitation documents within 48 hours of receiving this brief',
      'Identify teaming partners for larger opportunities',
      'Check SAM.gov for amendments and Q&A updates',
    ],
  };
}

// SAM.gov Daily Brief Email HTML
function generateDailyEmailHtmlFromSam(briefing: SamDailyBriefing): string {
  const getUrgencyColor = (days: number) => {
    if (days <= 3) return '#dc2626'; // Red
    if (days <= 7) return '#f97316'; // Orange
    if (days <= 14) return '#eab308'; // Yellow
    return '#22c55e'; // Green
  };

  const getUrgencyLabel = (days: number) => {
    if (days <= 0) return 'DUE TODAY';
    if (days === 1) return 'DUE TOMORROW';
    if (days <= 3) return 'URGENT';
    if (days <= 7) return 'THIS WEEK';
    return `${days} DAYS`;
  };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Brief - Active Solicitations</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6; }
    .container { max-width: 680px; margin: 0 auto; background: #ffffff; }
    .header { background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 26px; font-weight: 700; }
    .header p { margin: 12px 0 0; font-size: 15px; opacity: 0.95; }
    .header-badge { display: inline-block; background: rgba(255,255,255,0.2); padding: 6px 14px; border-radius: 20px; font-size: 13px; margin-top: 12px; }
    .section { padding: 24px; }
    .section-header { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #e5e7eb; }
    .section-header h2 { margin: 0; font-size: 16px; color: #059669; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .opp-card { background: #f9fafb; border-radius: 10px; padding: 20px; margin-bottom: 16px; border-left: 4px solid #059669; }
    .opp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
    .opp-rank { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: #059669; color: white; border-radius: 50%; font-size: 13px; font-weight: 700; flex-shrink: 0; }
    .opp-title { font-size: 15px; font-weight: 700; color: #111827; margin: 0; flex: 1; padding-left: 10px; }
    .urgency-badge { padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; color: white; white-space: nowrap; }
    .opp-meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin: 12px 0; font-size: 13px; }
    .opp-meta-item { display: flex; flex-direction: column; }
    .opp-meta-label { color: #6b7280; font-size: 11px; text-transform: uppercase; }
    .opp-meta-value { color: #111827; font-weight: 600; }
    .assessment-box { background: #ecfdf5; border-radius: 6px; padding: 12px; margin: 12px 0; }
    .assessment-label { font-size: 11px; color: #047857; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; }
    .assessment-text { font-size: 14px; color: #065f46; margin: 0; line-height: 1.5; }
    .sam-link { display: inline-block; background: #059669; color: white; padding: 10px 20px; border-radius: 6px; font-size: 13px; font-weight: 600; text-decoration: none; margin-top: 12px; }
    .sam-link:hover { background: #047857; }
    .deadline-section { background: #fef3c7; border-radius: 8px; padding: 16px; margin-top: 16px; }
    .deadline-header { font-size: 14px; font-weight: 700; color: #92400e; margin: 0 0 12px; }
    .deadline-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px dashed #fcd34d; }
    .deadline-item:last-child { border-bottom: none; }
    .deadline-title { font-size: 13px; color: #78350f; flex: 1; }
    .deadline-days { font-size: 12px; font-weight: 700; padding: 3px 8px; border-radius: 4px; color: white; }
    .tips-section { background: #eff6ff; border-radius: 8px; padding: 16px; margin-top: 16px; }
    .tips-header { font-size: 14px; font-weight: 700; color: #1e40af; margin: 0 0 12px; }
    .tip-item { font-size: 13px; color: #1e3a8a; padding: 6px 0; padding-left: 20px; position: relative; }
    .tip-item:before { content: "✓"; position: absolute; left: 0; color: #3b82f6; font-weight: bold; }
    .footer { background: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb; }
    .footer p { margin: 0 0 8px; font-size: 12px; color: #6b7280; }
    .footer a { color: #059669; text-decoration: none; }
    .source-badge { display: inline-block; background: #d1fae5; color: #065f46; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📋 Active Solicitations</h1>
      <p>${briefing.date}</p>
      <div class="header-badge">✅ VERIFIED FROM SAM.gov</div>
    </div>

    <div class="section">
      <div class="section-header">
        <h2>🎯 TOP ${briefing.opportunities.length} OPPORTUNITIES TO BID</h2>
      </div>
      ${briefing.opportunities.map(opp => `
        <div class="opp-card">
          <div class="opp-header">
            <div style="display: flex; align-items: flex-start;">
              <span class="opp-rank">${opp.rank}</span>
              <h3 class="opp-title">${escapeHtml(opp.title)}</h3>
            </div>
            <span class="urgency-badge" style="background: ${getUrgencyColor(opp.daysRemaining)};">${getUrgencyLabel(opp.daysRemaining)}</span>
          </div>
          <div class="opp-meta">
            <div class="opp-meta-item">
              <span class="opp-meta-label">Agency</span>
              <span class="opp-meta-value">${escapeHtml(opp.agency)}</span>
            </div>
            <div class="opp-meta-item">
              <span class="opp-meta-label">Response Due</span>
              <span class="opp-meta-value">${escapeHtml(opp.responseDeadline)}</span>
            </div>
            <div class="opp-meta-item">
              <span class="opp-meta-label">NAICS</span>
              <span class="opp-meta-value">${escapeHtml(opp.naicsCode)}</span>
            </div>
            <div class="opp-meta-item">
              <span class="opp-meta-label">Set-Aside</span>
              <span class="opp-meta-value">${escapeHtml(opp.setAside || 'Full & Open')}</span>
            </div>
          </div>
          <div class="assessment-box">
            <div class="assessment-label">Quick Win Assessment</div>
            <p class="assessment-text">${escapeHtml(opp.quickWinAssessment)}</p>
          </div>
          <a href="${opp.samLink}" class="sam-link" target="_blank">View on SAM.gov →</a>
        </div>
      `).join('')}
    </div>

    ${briefing.deadlinesThisWeek.length > 0 ? `
    <div class="section" style="padding-top: 0;">
      <div class="deadline-section">
        <h3 class="deadline-header">⏰ DEADLINES THIS WEEK</h3>
        ${briefing.deadlinesThisWeek.map(d => `
          <div class="deadline-item">
            <span class="deadline-title">${escapeHtml(d.title)}</span>
            <span class="deadline-days" style="background: ${getUrgencyColor(d.daysRemaining)};">${d.daysRemaining === 0 ? 'TODAY' : d.daysRemaining === 1 ? 'TOMORROW' : d.daysRemaining + ' days'}</span>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <div class="section" style="padding-top: 0;">
      <div class="tips-section">
        <h3 class="tips-header">💡 ACTION TIPS</h3>
        ${briefing.actionTips.map(tip => `<div class="tip-item">${escapeHtml(tip)}</div>`).join('')}
      </div>
    </div>

    <div class="footer">
      <p>Generated by <strong>GovCon Giants AI</strong></p>
      <span class="source-badge">Data Source: SAM.gov Opportunities API</span>
      <p style="margin-top: 12px;"><a href="https://tools.govcongiants.org/alerts/preferences">Manage Preferences</a> | <a href="https://shop.govcongiants.org/briefings">View All Briefings</a></p>
    </div>
  </div>
</body>
</html>
`;
}

function generateDailyEmailTextFromSam(briefing: SamDailyBriefing): string {
  let text = `📋 ACTIVE SOLICITATIONS - BID NOW\n${briefing.date}\n${'='.repeat(50)}\n\n`;
  text += `✅ Data verified from SAM.gov\n\n`;

  for (const opp of briefing.opportunities) {
    text += `${opp.rank}. ${opp.title}\n`;
    text += `   Agency: ${opp.agency}\n`;
    text += `   NAICS: ${opp.naicsCode} | Set-Aside: ${opp.setAside || 'Full & Open'}\n`;
    text += `   Response Due: ${opp.responseDeadline} (${opp.daysRemaining} days remaining)\n`;
    text += `   Assessment: ${opp.quickWinAssessment}\n`;
    text += `   SAM.gov: ${opp.samLink}\n\n`;
  }

  if (briefing.deadlinesThisWeek.length > 0) {
    text += `\n⏰ DEADLINES THIS WEEK\n${'─'.repeat(30)}\n`;
    for (const d of briefing.deadlinesThisWeek) {
      text += `• ${d.title} - ${d.daysRemaining === 0 ? 'TODAY' : d.daysRemaining + ' days'}\n`;
    }
  }

  text += `\n💡 ACTION TIPS\n${'─'.repeat(30)}\n`;
  for (const tip of briefing.actionTips) {
    text += `✓ ${tip}\n`;
  }

  return text;
}

// ============ DAILY BRIEF GENERATOR (LEGACY - USASpending) ============

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
  const prompt = `You are a senior GovCon capture strategist. Generate a CONCISE Daily Market Intel Briefing - quick to scan, actionable.

CONTRACT DATA (REAL DATA FROM USASPENDING):
${JSON.stringify(contracts, null, 2)}

Generate JSON with:
1. "opportunities" - Rank TOP 5 ONLY by actionability (not just value). Each needs: rank, contractName, agency, incumbent, value (number), window (timeline string), displacementAngle (1-2 sentence strategic insight - WHY winnable NOW)
2. "teamingPlays" - 2 specific teaming plays. Each needs: playNumber, strategyName, targetPrimes (array of company names), rationale, suggestedOpener (copy-paste ready outreach message)
3. "mustWatch" - 3 key signals/events to monitor this week

KEEP IT CONCISE - this is a 2-minute read. Focus on the BEST opportunities, not all of them.

DISPLACEMENT ANGLES TO IDENTIFY:
- Bridge contracts (vulnerability)
- Multiple extensions (procurement fatigue)
- 8(a) → unrestricted transitions
- M&A integration friction
- Performance issues (low numberOfBids = vulnerable)
- Contracts with competitionLevel "sole_source" or "low" are high priority

Return ONLY valid JSON with exactly 5 opportunities, 2 teaming plays, and 3 must-watch items.`;

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

// ============ SAM.gov STATUS CHECKER FOR RECOMPETES ============

interface SamStatusResult {
  status: 'no_activity' | 'sources_sought' | 'presolicitation' | 'active_rfp';
  message: string;
  noticeId?: string;
  deadline?: string;
  samLink?: string;
}

async function checkSamStatusForContract(
  contract: ContractForBriefing,
  samOpportunities: SAMOpportunity[]
): Promise<SamStatusResult> {
  // Search through already-fetched SAM.gov opportunities for matches
  // Match by: agency name similarity, NAICS code, or keywords from contract description

  const agencyLower = contract.agency.toLowerCase();
  const descWords = contract.contractName.toLowerCase().split(/\s+/).filter(w => w.length > 4);

  // Find matches in SAM.gov opportunities
  const matches = samOpportunities.filter(opp => {
    const oppAgencyLower = (opp.department || '').toLowerCase();
    const oppTitleLower = (opp.title || '').toLowerCase();
    const oppDescLower = (opp.description || '').toLowerCase();

    // Agency match
    const agencyMatch = oppAgencyLower.includes(agencyLower.split(' ')[0]) ||
                       agencyLower.includes(oppAgencyLower.split(' ')[0]);

    // NAICS match
    const naicsMatch = opp.naicsCode === contract.naicsCode;

    // Keyword match (at least 2 significant words)
    const keywordMatches = descWords.filter(word =>
      oppTitleLower.includes(word) || oppDescLower.includes(word)
    ).length;
    const keywordMatch = keywordMatches >= 2;

    return naicsMatch && (agencyMatch || keywordMatch);
  });

  if (matches.length === 0) {
    return {
      status: 'no_activity',
      message: 'No solicitation posted yet - early positioning opportunity'
    };
  }

  // Analyze the best match
  const bestMatch = matches[0];
  const noticeTypeLower = (bestMatch.noticeType || '').toLowerCase();

  if (noticeTypeLower.includes('solicit') || noticeTypeLower.includes('rfp') || noticeTypeLower.includes('rfq')) {
    return {
      status: 'active_rfp',
      message: `Active solicitation found - Response due ${bestMatch.responseDeadline || 'TBD'}`,
      noticeId: bestMatch.noticeId,
      deadline: bestMatch.responseDeadline,
      samLink: bestMatch.uiLink || `https://sam.gov/opp/${bestMatch.noticeId}/view`
    };
  }

  if (noticeTypeLower.includes('source') || noticeTypeLower.includes('rfi') || noticeTypeLower.includes('market research')) {
    return {
      status: 'sources_sought',
      message: 'Sources Sought/RFI posted - Respond to get on radar',
      noticeId: bestMatch.noticeId,
      samLink: bestMatch.uiLink || `https://sam.gov/opp/${bestMatch.noticeId}/view`
    };
  }

  if (noticeTypeLower.includes('presolic') || noticeTypeLower.includes('intent')) {
    return {
      status: 'presolicitation',
      message: 'Pre-solicitation notice posted - RFP coming soon',
      noticeId: bestMatch.noticeId,
      samLink: bestMatch.uiLink || `https://sam.gov/opp/${bestMatch.noticeId}/view`
    };
  }

  // Default for any other match
  return {
    status: 'sources_sought',
    message: `Related notice found: ${bestMatch.noticeType || 'Notice'}`,
    noticeId: bestMatch.noticeId,
    samLink: bestMatch.uiLink || `https://sam.gov/opp/${bestMatch.noticeId}/view`
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
  samStatus?: {
    status: 'no_activity' | 'sources_sought' | 'presolicitation' | 'active_rfp';
    message: string;
    noticeId?: string;
    deadline?: string;
    samLink?: string;
  };
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

async function generateWeeklyDeepDive(anthropic: Anthropic, contracts: ContractForBriefing[], samOpportunities: SAMOpportunity[] = []): Promise<WeeklyBriefing> {
  const monday = new Date();
  monday.setDate(monday.getDate() - monday.getDay() + 1);

  const prompt = `You are a senior GovCon capture strategist. Generate a COMPREHENSIVE Weekly Deep Dive briefing. This is MORE DETAILED than the daily brief.

CONTRACT DATA (REAL DATA FROM USASPENDING):
${JSON.stringify(contracts, null, 2)}

REQUIRED JSON STRUCTURE - ALL FIELDS ARE MANDATORY:

{
  "opportunities": [
    {
      "rank": 1,
      "contractName": "string",
      "agency": "string",
      "incumbent": "string",
      "value": number,
      "window": "string (e.g. 'Recompete expected Q2 FY26')",
      "displacementAngle": "string - WHY this incumbent is vulnerable",
      "keyDates": [
        {"label": "Contract End", "date": "2026-06-30"},
        {"label": "Expected RFP", "date": "2026-03-15"},
        {"label": "Industry Day (Estimated)", "date": "2026-02-01"}
      ],
      "competitiveLandscape": [
        "Incumbent has held contract for 8 years with minimal competition",
        "Only 2 bidders on last recompete suggests limited awareness",
        "Recent M&A activity may create teaming opportunities",
        "Small business set-aside limits large prime participation"
      ],
      "recommendedApproach": "string - specific capture strategy for this opportunity"
    }
  ],
  "teamingPlays": [
    {
      "playNumber": 1,
      "strategyName": "string",
      "targetCompany": "string - specific company name",
      "whyTarget": ["reason 1", "reason 2", "reason 3"],
      "whoToContact": ["VP of BD", "Capture Manager", "Program Manager"],
      "suggestedOpener": "string - copy-paste outreach message",
      "followUpMessage": "string - follow-up if no response"
    }
  ],
  "marketSignals": [
    {
      "headline": "string - news headline based on contract data",
      "source": "string - publication name",
      "implication": "string - what this means for capture",
      "actionRequired": true/false
    }
  ],
  "calendar": [
    {
      "date": "2026-04-15",
      "event": "string - specific event",
      "type": "deadline|industry_day|rfi_due|award_expected",
      "priority": "high|medium|low"
    }
  ]
}

CRITICAL REQUIREMENTS:
1. EVERY opportunity MUST have keyDates (at least 2-3 dates), competitiveLandscape (at least 3 items), and recommendedApproach
2. Generate EXACTLY 4 marketSignals based on the contract data patterns you see
3. Generate EXACTLY 6 calendar items with specific dates
4. Be specific with company names, dollar amounts, and dates
5. This is for strategic planning - be actionable and detailed

Return ONLY valid JSON with ALL required fields populated.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 6000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const data = JSON.parse(jsonMatch?.[0] || '{}');

  // Enrich opportunities with SAM.gov status
  const enrichedOpportunities: WeeklyOpportunity[] = [];
  const aiOpportunities = data.opportunities || [];

  for (let i = 0; i < Math.min(aiOpportunities.length, contracts.length); i++) {
    const aiOpp = aiOpportunities[i];
    const contract = contracts[i];

    // Check SAM.gov status for this contract
    const samStatus = await checkSamStatusForContract(contract, samOpportunities);

    enrichedOpportunities.push({
      ...aiOpp,
      samStatus,
    });
  }

  return {
    weekOf: monday.toISOString().split('T')[0],
    opportunities: enrichedOpportunities,
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
        <h2>🎯 TOP 5 RECOMPETE OPPORTUNITIES</h2>
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
    .sam-status-box { background: #f0fdf4; border-radius: 6px; padding: 12px; margin: 12px 0; border-left: 4px solid #10b981; }
    .sam-status-label { font-size: 11px; color: #047857; font-weight: 700; text-transform: uppercase; margin-bottom: 6px; }
    .sam-status-badge { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; margin-bottom: 8px; }
    .sam-status-no_activity { background: #f3f4f6; color: #4b5563; }
    .sam-status-sources_sought { background: #fef3c7; color: #92400e; }
    .sam-status-presolicitation { background: #dbeafe; color: #1e40af; }
    .sam-status-active_rfp { background: #dcfce7; color: #166534; }
    .sam-status-message { font-size: 13px; color: #065f46; margin: 0 0 8px; }
    .sam-link-btn { display: inline-block; background: #10b981; color: white; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; text-decoration: none; }
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
          ${opp.samStatus ? `
            <div class="sam-status-box">
              <div class="sam-status-label">📡 SAM.gov Status</div>
              <span class="sam-status-badge sam-status-${opp.samStatus.status}">${
                opp.samStatus.status === 'no_activity' ? '⏳ NO ACTIVITY YET' :
                opp.samStatus.status === 'sources_sought' ? '📋 SOURCES SOUGHT' :
                opp.samStatus.status === 'presolicitation' ? '📢 PRE-SOLICITATION' :
                '🎯 ACTIVE RFP'
              }</span>
              <p class="sam-status-message">${escapeHtml(opp.samStatus.message)}</p>
              ${opp.samStatus.samLink ? `<a href="${opp.samStatus.samLink}" class="sam-link-btn" target="_blank">View on SAM.gov →</a>` : ''}
            </div>
          ` : ''}
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
    if (opp.samStatus) {
      text += `\n   📡 SAM.gov STATUS: ${opp.samStatus.status === 'no_activity' ? 'No activity yet' :
        opp.samStatus.status === 'sources_sought' ? 'Sources Sought' :
        opp.samStatus.status === 'presolicitation' ? 'Pre-solicitation' :
        'Active RFP'}\n`;
      text += `   ${opp.samStatus.message}\n`;
      if (opp.samStatus.samLink) {
        text += `   Link: ${opp.samStatus.samLink}\n`;
      }
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
