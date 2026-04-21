/**
 * Weekly Deep Dive Cron Job
 *
 * Generates and sends comprehensive weekly market intelligence to ALL users.
 * Pulls from unified user_notification_settings table.
 * Schedule: Sunday 10 AM UTC (after weekly-alerts digest)
 *
 * This is separate from daily briefings - it's a more detailed analysis.
 *
 * Process:
 * 1. Get all users with briefings_enabled=true and NAICS codes
 * 2. Fetch market data from USASpending
 * 3. Generate AI analysis with Claude
 * 4. Send email with teaming plays, calendar, competitive landscape
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';
import {
  recordBriefingProgramDelivery,
  resolveBriefingAudience,
} from '@/lib/briefings/delivery/rollout';
import { extractAndParseJSON, generateBriefingJson } from '@/lib/briefings/delivery/llm-router';

const BATCH_SIZE = 5;
const BRAND_COLOR = '#1e3a8a';
const ACCENT_COLOR = '#7c3aed';
const SUCCESS_COLOR = '#10b981';

// NAICS prefix expansion for 3-digit codes (comprehensive version)
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
      // Try prefix matching for partial codes
      for (const [prefix, fullCodes] of Object.entries(NAICS_EXPANSION)) {
        if (code.startsWith(prefix)) {
          expanded.push(...fullCodes);
          break;
        }
      }
      // If still no match and it's a valid-looking code, keep it as-is
      if (expanded.length === 0 && code.length >= 3) {
        expanded.push(code);
      }
    }
  }
  return [...new Set(expanded)].slice(0, 10);
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

interface BriefingUser {
  email: string;
  naics_codes: string[];
  agencies: string[];
  timezone?: string;
}

export async function GET(request: NextRequest) {
  const testEmail = request.nextUrl.searchParams.get('email');
  const isTest = request.nextUrl.searchParams.get('test') === 'true';

  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !hasCronSecret && !(testEmail && isTest)) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({
        message: 'Weekly Deep Dive Cron Job (FREE FOR EVERYONE)',
        usage: {
          test: 'GET ?email=xxx&test=true to send test deep dive',
          manual: 'Triggered by Vercel cron or CRON_SECRET',
        },
        schedule: 'Every Sunday at 10 AM UTC',
        features: [
          'FREE for all users (no paywall)',
          'Full competitive landscape analysis',
          'Teaming play recommendations',
          'Key dates calendar',
          'Market signals & news',
        ],
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

  const startTime = Date.now();
  let briefingsSent = 0;
  let briefingsFailed = 0;
  let briefingsSkipped = 0;
  const errors: string[] = [];
  let activeCohortId: string | null = null;
  let audienceMode = 'beta_all';

  console.log('[WeeklyDeepDive] Starting weekly deep dive delivery...');

  try {
    const audienceResolution = await resolveBriefingAudience(getSupabase());
    const allUsers: BriefingUser[] = audienceResolution.users
      .filter(user => user.naics_codes.length > 0)
      .map(user => ({
        email: user.email,
        naics_codes: user.naics_codes,
        agencies: user.agencies,
        timezone: user.timezone,
      }));
    activeCohortId = audienceResolution.activeCohort?.id || null;
    audienceMode = audienceResolution.config.mode;

    // Filter to test email if specified
    let usersToProcess = allUsers;
    if (testEmail) {
      usersToProcess = allUsers.filter(u => u.email === testEmail.toLowerCase());
      if (usersToProcess.length === 0) {
        return NextResponse.json({
          success: false,
          error: `No user found with email: ${testEmail}`,
          totalUsers: allUsers.length,
        });
      }
    }

    if (usersToProcess.length === 0) {
      console.log('[WeeklyDeepDive] No users with NAICS codes');
      return NextResponse.json({
        success: true,
        message: 'No users with NAICS codes',
        briefingsSent: 0,
        elapsed: Date.now() - startTime,
      });
    }

    console.log(`[WeeklyDeepDive] Processing ${usersToProcess.length} users`);

    // Process in batches
    for (let i = 0; i < usersToProcess.length; i += BATCH_SIZE) {
      const batch = usersToProcess.slice(i, i + BATCH_SIZE);

      for (const user of batch) {
        try {
          // Fetch contracts for this user's NAICS
          const expandedNaics = expandNaicsCodes(user.naics_codes);
          const contracts = await fetchContractsForNaics(expandedNaics);

          if (contracts.length === 0) {
            console.log(`[WeeklyDeepDive] No contracts for ${user.email}`);
            briefingsSkipped++;
            continue;
          }

          // Generate weekly deep dive with AI
          const briefing = await generateWeeklyDeepDive(contracts);

          // Send email
          await sendEmail({
            to: user.email,
            subject: `📊 Weekly Deep Dive: ${briefing.opportunities.length} Opportunities - Week of ${briefing.weekOf}`,
            html: generateWeeklyEmailHtml(briefing),
            text: generateWeeklyEmailText(briefing),
          });
          if (!isTest) {
            await recordBriefingProgramDelivery(activeCohortId, user.email, 'weekly_deep_dive');
          }

          // Log to database
          await getSupabase().from('briefing_log').upsert({
            user_email: user.email,
            briefing_date: briefing.weekOf,
            briefing_type: 'weekly',
            briefing_content: briefing,
            items_count: briefing.opportunities.length,
            tools_included: ['weekly_deep_dive'],
            delivery_status: 'sent',
            email_sent_at: new Date().toISOString(),
          }, { onConflict: 'user_email,briefing_date,briefing_type' });

          briefingsSent++;
          console.log(`[WeeklyDeepDive] ✅ Sent to ${user.email}`);

        } catch (err) {
          briefingsFailed++;
          const errorMsg = `Error processing ${user.email}: ${err}`;
          console.error(`[WeeklyDeepDive] ${errorMsg}`);
          errors.push(errorMsg);
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[WeeklyDeepDive] Complete: ${briefingsSent} sent, ${briefingsSkipped} skipped, ${briefingsFailed} failed, ${elapsed}ms`);

    return NextResponse.json({
      success: true,
      briefingsSent,
      briefingsSkipped,
      briefingsFailed,
      totalUsers: usersToProcess.length,
      audienceMode,
      activeCohortId,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      elapsed,
    });
  } catch (error) {
    console.error('[WeeklyDeepDive] Fatal error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
      briefingsSent,
      briefingsFailed,
      elapsed: Date.now() - startTime,
    }, { status: 500 });
  }
}

async function fetchContractsForNaics(naicsCodes: string[]): Promise<ContractForBriefing[]> {
  const allContracts: ContractForBriefing[] = [];

  for (const naics of naicsCodes.slice(0, 3)) {
    try {
      const response = await fetch(`https://api.usaspending.gov/api/v2/search/spending_by_award/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: {
            time_period: [{ start_date: '2022-01-01', end_date: '2027-12-31' }],
            award_type_codes: ['A', 'B', 'C', 'D'],
            naics_codes: { require: [naics] },
          },
          fields: ['Award ID', 'Recipient Name', 'Start Date', 'End Date', 'Award Amount', 'Awarding Agency', 'generated_internal_id'],
          page: 1,
          limit: 10,
          sort: 'Award Amount',
          order: 'desc',
        }),
      });

      if (!response.ok) continue;

      const data = await response.json();
      const awards = data.results || [];

      for (const award of awards.slice(0, 3)) {
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

            allContracts.push({
              contractNumber: detail.piid || award['Award ID'],
              contractName: detail.description || `${naics} Contract`,
              agency: detail.awarding_agency?.toptier_agency?.name || award['Awarding Agency'] || '',
              incumbent: detail.recipient?.recipient_name || award['Recipient Name'] || '',
              value: detail.total_obligation || Number(award['Award Amount']) || 0,
              naicsCode: naics,
              expirationDate: endDate,
              daysUntilExpiration: daysUntil,
              setAside: contractData.extent_competed_description || 'Full & Open',
              description: detail.description || '',
              numberOfBids,
              competitionLevel: numberOfBids <= 2 ? 'low' : numberOfBids <= 5 ? 'medium' : 'high',
            });
          }
        } catch {
          // Skip individual award errors
        }
      }
    } catch {
      // Skip NAICS errors
    }
  }

  return allContracts.sort((a, b) => b.value - a.value).slice(0, 10);
}

async function generateWeeklyDeepDive(contracts: ContractForBriefing[]): Promise<WeeklyBriefing> {
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
- competitionLevel "low"
- Near-term expiration (daysUntilExpiration < 180)

Be specific with dates, names, dollar amounts. This is for strategic planning.

Return ONLY valid JSON.`;

  const { text, provider, model } = await generateBriefingJson(
    'weekly',
    'You are a senior GovCon capture strategist. Generate a Weekly Deep Dive briefing with full analysis.',
    prompt,
    6000
  );
  const data = extractAndParseJSON<{
    opportunities?: WeeklyOpportunity[];
    teamingPlays?: WeeklyTeamingPlay[];
    marketSignals?: { headline: string; source: string; implication: string; actionRequired: boolean }[];
    calendar?: { date: string; event: string; type: string; priority: string }[];
  }>(text);
  console.log(`[WeeklyDeepDive] Generated via ${provider}/${model}`);

  return {
    weekOf: monday.toISOString().split('T')[0],
    opportunities: data.opportunities || [],
    teamingPlays: data.teamingPlays || [],
    marketSignals: data.marketSignals || [],
    calendar: data.calendar || [],
  };
}

function formatValue(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M`;
  return `${(value / 1_000).toFixed(0)}K`;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateWeeklyEmailHtml(briefing: WeeklyBriefing): string {
  const preferencesUrl = 'https://tools.govcongiants.org/alerts/preferences';

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
    .teaming-play { background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-radius: 8px; padding: 20px; margin-bottom: 16px; border-left: 4px solid ${SUCCESS_COLOR}; }
    .play-number { background: ${SUCCESS_COLOR}; color: white; font-size: 12px; padding: 4px 10px; border-radius: 4px; font-weight: 700; }
    .play-name { font-size: 16px; font-weight: 700; color: #065f46; margin: 8px 0 0; }
    .play-target { font-size: 14px; color: #047857; margin: 8px 0; }
    .opener-box { background: white; border-radius: 6px; padding: 14px; margin: 12px 0; border: 1px dashed #10b981; }
    .opener-label { font-size: 11px; color: #047857; font-weight: 700; text-transform: uppercase; margin-bottom: 6px; }
    .opener-text { font-size: 13px; color: #1f2937; line-height: 1.5; margin: 0; font-style: italic; }
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
    <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); padding: 10px 20px; text-align: center;">
      <p style="color: white; margin: 0; font-size: 12px; font-weight: 600;">🎁 FREE DURING BETA • Full Market Intelligence at no charge!</p>
    </div>

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
          <div class="opener-box">
            <div class="opener-label">Suggested Opener</div>
            <p class="opener-text">"${escapeHtml(play.suggestedOpener)}"</p>
          </div>
        </div>
      `).join('')}
    </div>

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
      <p><a href="${preferencesUrl}">Manage Preferences</a></p>
      <p style="color: #94a3b8; font-size: 11px;">© ${new Date().getFullYear()} GovCon Giants • tools.govcongiants.org</p>
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
    text += `${'─'.repeat(40)}\n\n`;
  }

  return text;
}
