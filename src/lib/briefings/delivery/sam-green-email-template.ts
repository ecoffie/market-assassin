/**
 * SAM.gov GREEN Email Template - Active Solicitations
 *
 * WORKING template extracted from send-all-briefings/route.ts
 * Uses Anthropic Claude for Quick Win Assessments
 *
 * Color scheme: Green (#059669 → #10b981) - "bid now" opportunities
 */

import Anthropic from '@anthropic-ai/sdk';
import { SAMOpportunity } from '@/lib/briefings/pipelines/sam-gov';
import agencySatData from '@/data/agency-sat-friendliness.json';
import { generateTrackingPixel, generateTrackedLink } from '@/lib/engagement';

// ============ INTERFACES ============

export interface SamDailyOpportunity {
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
  postedDate: string;
}

export interface SamDailyBriefing {
  date: string;
  opportunities: SamDailyOpportunity[];
  deadlinesThisWeek: {
    title: string;
    fullTitle: string;
    deadline: string;
    daysRemaining: number;
    samLink: string;
    noticeType: string;
    noticeId: string;
    agency: string;
    naicsCode: string;
    setAside: string;
  }[];
  actionTips: string[];
  noticeSummary: {
    totalMatched: number;
    rfp: number;
    rfq: number;
    sourcesSought: number;
    preSol: number;
    combined: number;
    other: number;
  };
}

export interface SamStrategicRankingContext {
  naicsCodes?: string[];
  agencies?: string[];
  keywords?: string[];
}

export interface NoticeSummary {
  totalMatched: number;
  rfp: number;
  rfq: number;
  sourcesSought: number;
  preSol: number;
  combined: number;
  other: number;
}

// Legacy exports for backwards compatibility
export type SamGreenBriefing = SamDailyBriefing;
export type SamGreenOpportunity = SamDailyOpportunity;

// ============ HELPERS ============

interface SatAgencyInfo {
  satPercent: number;
  microPercent: number;
  level: string;
  badge: string | null;
}

export function getSatBadgeForAgency(agencyName: string): { badge: string | null; level: string; satPercent: number } {
  if (!agencyName) return { badge: null, level: 'unknown', satPercent: 0 };

  const agencies = agencySatData.agencies as Record<string, SatAgencyInfo>;
  const normalizedAgency = agencyName.toUpperCase().trim();

  // Try exact match first
  if (agencies[normalizedAgency]) {
    const data = agencies[normalizedAgency];
    return { badge: data.badge, level: data.level, satPercent: data.satPercent };
  }

  // Try partial matching for common variations
  for (const [key, data] of Object.entries(agencies)) {
    const keyWords = key.split(/[\s,]+/).filter(w => w.length > 3);
    const agencyWords = normalizedAgency.split(/[\s,]+/).filter(w => w.length > 3);

    if (normalizedAgency.includes(key) || key.includes(normalizedAgency)) {
      return { badge: data.badge, level: data.level, satPercent: data.satPercent };
    }

    const matchingWords = keyWords.filter(kw => agencyWords.some(aw => aw.includes(kw) || kw.includes(aw)));
    if (matchingWords.length >= 1 && keyWords.length > 0) {
      return { badge: data.badge, level: data.level, satPercent: data.satPercent };
    }
  }

  return { badge: null, level: 'unknown', satPercent: 0 };
}

export function getDaysUntil(dateString: string): number {
  if (!dateString) return 999;
  const target = new Date(dateString);
  const today = new Date();
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatSamDate(isoDateString: string): string {
  if (!isoDateString) return 'TBD';
  try {
    const date = new Date(isoDateString);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    let tz = 'ET';
    if (isoDateString.includes('-04:00') || isoDateString.includes('-0400')) tz = 'EDT';
    else if (isoDateString.includes('-05:00') || isoDateString.includes('-0500')) tz = 'EST';
    else if (isoDateString.includes('Z')) tz = 'UTC';
    return `${month} ${day}, ${year} ${hours}:${minutes} ${ampm} ${tz}`;
  } catch {
    return isoDateString;
  }
}

export function escapeHtml(text: string): string {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface StrategicScoreResult {
  score: number;
  summary: string;
}

function normalizeTextList(values: string[] | undefined): string[] {
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
}

function scoreNoticeType(noticeType: string | undefined): { score: number; label: string } {
  const type = (noticeType || '').toLowerCase();

  if (type.includes('source') || type.includes('rfi') || type.includes('market research')) {
    return { score: 35, label: 'Open market research window' };
  }

  if (type.includes('presol') || type.includes('intent') || type.includes('pre-sol')) {
    return { score: 28, label: 'Presolicitation positioning window' };
  }

  if (type.includes('combined')) {
    return { score: 18, label: 'Combined synopsis/solicitation' };
  }

  if (type.includes('rfq') || type.includes('quote')) {
    return { score: 16, label: 'RFQ with near-term action' };
  }

  if (type.includes('solicitation') || type.includes('rfp')) {
    return { score: 14, label: 'Active solicitation' };
  }

  return { score: 8, label: 'Active federal opportunity' };
}

function scoreNaicsFit(oppNaics: string | undefined, userNaics: string[]): { score: number; label: string } {
  if (!oppNaics || userNaics.length === 0) {
    return { score: 6, label: 'General profile alignment' };
  }

  if (userNaics.includes(oppNaics)) {
    return { score: 18, label: 'Exact NAICS match' };
  }

  const oppPrefix = oppNaics.slice(0, 4);
  if (oppPrefix && userNaics.some(code => code.startsWith(oppPrefix) || oppNaics.startsWith(code.slice(0, 4)))) {
    return { score: 12, label: 'Related NAICS match' };
  }

  const oppSector = oppNaics.slice(0, 2);
  if (oppSector && userNaics.some(code => code.startsWith(oppSector))) {
    return { score: 7, label: 'Same NAICS sector' };
  }

  return { score: 0, label: 'Weak NAICS fit' };
}

function scoreAgencyFit(agency: string | undefined, targetAgencies: string[]): { score: number; label: string } {
  if (!agency || targetAgencies.length === 0) {
    return { score: 0, label: 'No explicit agency target' };
  }

  const normalizedAgency = agency.toLowerCase();
  const match = targetAgencies.find(target =>
    normalizedAgency.includes(target.toLowerCase()) || target.toLowerCase().includes(normalizedAgency)
  );

  if (match) {
    return { score: 14, label: `Target agency match: ${match}` };
  }

  return { score: 0, label: 'New agency' };
}

function scoreKeywordFit(opportunity: SAMOpportunity, keywords: string[]): { score: number; label: string } {
  if (keywords.length === 0) {
    return { score: 0, label: 'No strategic keywords configured' };
  }

  const searchableText = `${opportunity.title} ${opportunity.description || ''}`.toLowerCase();
  const matches = keywords.filter(keyword => searchableText.includes(keyword.toLowerCase()));

  if (matches.length >= 3) {
    return { score: 15, label: `Strong keyword match: ${matches.slice(0, 3).join(', ')}` };
  }

  if (matches.length >= 1) {
    return { score: 8, label: `Keyword match: ${matches.slice(0, 2).join(', ')}` };
  }

  return { score: 0, label: 'No keyword overlap' };
}

function scoreSetAside(setAside: string | null | undefined): { score: number; label: string } {
  if (!setAside) {
    return { score: 4, label: 'Full and open opportunity' };
  }

  const normalized = setAside.toLowerCase();

  if (normalized.includes('8') || normalized.includes('sdvosb') || normalized.includes('wosb') || normalized.includes('hub')) {
    return { score: 12, label: `Set-aside opportunity: ${setAside}` };
  }

  if (normalized.includes('small')) {
    return { score: 10, label: `Small business set-aside: ${setAside}` };
  }

  return { score: 6, label: `Restricted opportunity: ${setAside}` };
}

function scoreTiming(deadline: string): { score: number; label: string } {
  const daysRemaining = getDaysUntil(deadline);

  if (daysRemaining < 0) {
    return { score: -20, label: 'Deadline has passed' };
  }

  if (daysRemaining <= 2) {
    return { score: 4, label: 'Very short response window' };
  }

  if (daysRemaining <= 7) {
    return { score: 14, label: 'Immediate action window' };
  }

  if (daysRemaining <= 21) {
    return { score: 18, label: 'Strong action window' };
  }

  if (daysRemaining <= 45) {
    return { score: 12, label: 'Good time to position' };
  }

  return { score: 6, label: 'Longer-term opportunity' };
}

function buildStrategicAssessment(opportunity: SAMOpportunity, context?: SamStrategicRankingContext): StrategicScoreResult {
  const naicsCodes = normalizeTextList(context?.naicsCodes);
  const agencies = normalizeTextList(context?.agencies);
  const keywords = normalizeTextList(context?.keywords);

  const noticeTypeFactor = scoreNoticeType(opportunity.noticeType);
  const naicsFactor = scoreNaicsFit(opportunity.naicsCode, naicsCodes);
  const agencyFactor = scoreAgencyFit(opportunity.department || opportunity.subTier, agencies);
  const keywordFactor = scoreKeywordFit(opportunity, keywords);
  const setAsideFactor = scoreSetAside(opportunity.setAsideDescription || opportunity.setAside);
  const timingFactor = scoreTiming(opportunity.responseDeadline);

  const totalScore =
    noticeTypeFactor.score +
    naicsFactor.score +
    agencyFactor.score +
    keywordFactor.score +
    setAsideFactor.score +
    timingFactor.score;

  const topReasons = [
    noticeTypeFactor,
    naicsFactor,
    agencyFactor,
    keywordFactor,
    setAsideFactor,
    timingFactor,
  ]
    .filter(factor => factor.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(factor => factor.label.toLowerCase());

  const summary = topReasons.length > 0
    ? `${topReasons.join(' • ')}.`
    : 'Active opportunity worth a quick review.';

  return {
    score: totalScore,
    summary: summary.charAt(0).toUpperCase() + summary.slice(1),
  };
}

function buildNoticeSummary(opportunities: SAMOpportunity[]): NoticeSummary {
  const summary: NoticeSummary = {
    totalMatched: opportunities.length,
    rfp: 0,
    rfq: 0,
    sourcesSought: 0,
    preSol: 0,
    combined: 0,
    other: 0,
  };

  for (const opp of opportunities) {
    const type = (opp.noticeType || '').toLowerCase();
    if (type.includes('solicitation') || type.includes('rfp')) {
      summary.rfp++;
    } else if (type.includes('rfq') || type.includes('quote')) {
      summary.rfq++;
    } else if (type.includes('source') || type.includes('rfi') || type.includes('market research')) {
      summary.sourcesSought++;
    } else if (type.includes('presol') || type.includes('intent') || type.includes('pre-sol')) {
      summary.preSol++;
    } else if (type.includes('combined')) {
      summary.combined++;
    } else {
      summary.other++;
    }
  }

  return summary;
}

// ============ BRIEFING GENERATOR (WITH ANTHROPIC) ============

/**
 * @deprecated DO NOT USE IN CRONS - Takes ~4 seconds per call (Claude API)
 *
 * For batch sending, use pre-computed templates from `briefing_templates` table
 * with `generateAIEmailTemplate()` from `ai-email-template.ts`
 *
 * This function is only for:
 * - Admin testing (single user)
 * - Manual trigger endpoints
 * - Template pre-computation (precompute-briefings cron)
 */
export async function generateDailyBriefFromSam(samOpportunities: SAMOpportunity[]): Promise<SamDailyBriefing> {
  // GUARD: Warn if called in what looks like a batch context
  if (process.env.VERCEL_ENV === 'production') {
    console.warn('[PERF WARNING] generateDailyBriefFromSam called - this is SLOW (~4s). For batch use templates!');
  }
  // Sort by deadline (soonest first) and filter active
  const sorted = [...samOpportunities]
    .filter(o => o.active && o.responseDeadline)
    .sort((a, b) => new Date(a.responseDeadline).getTime() - new Date(b.responseDeadline).getTime())
    .slice(0, 10);

  // Ask Claude for strategic analysis of each opportunity
  const anthropicKey = process.env.BRIEFING_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  let assessmentsMap: Record<string, string> = {};
  let actionTips: string[] = [];

  if (anthropicKey && sorted.length > 0) {
    try {
      const anthropic = new Anthropic({ apiKey: anthropicKey });

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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (data.assessments || []).map((a: any) => [a.title, a.quickWinAssessment])
        );
        actionTips = data.actionTips || [];
      }
    } catch (err) {
      console.error('[SamGreenTemplate] Claude analysis error:', err);
    }
  }

  // Build the briefing
  const opportunities: SamDailyOpportunity[] = sorted.slice(0, 5).map((opp, idx) => ({
    rank: idx + 1,
    title: opp.title,
    agency: opp.department || opp.subTier || 'Federal',
    naicsCode: opp.naicsCode,
    setAside: opp.setAsideDescription || opp.setAside,
    responseDeadline: formatSamDate(opp.responseDeadline),
    daysRemaining: getDaysUntil(opp.responseDeadline),
    noticeType: opp.noticeType,
    solicitationNumber: opp.solicitationNumber,
    samLink: opp.uiLink || `https://sam.gov/opp/${opp.noticeId}/view`,
    quickWinAssessment: assessmentsMap[opp.title] || 'Active opportunity matching your NAICS - review requirements and deadline.',
    postedDate: formatSamDate(opp.postedDate),
  }));

  // Deadlines this week
  const weekFromNow = 7;
  const deadlinesThisWeek = sorted
    .filter(o => getDaysUntil(o.responseDeadline) <= weekFromNow && getDaysUntil(o.responseDeadline) >= 0)
    .map(o => ({
      title: o.title.slice(0, 60) + (o.title.length > 60 ? '...' : ''),
      fullTitle: o.title,
      deadline: o.responseDeadline,
      daysRemaining: getDaysUntil(o.responseDeadline),
      samLink: o.uiLink || `https://sam.gov/opp/${o.noticeId}/view`,
      noticeType: o.noticeType || 'Notice',
      noticeId: o.solicitationNumber || o.noticeId || '',
      agency: o.department || o.subTier || '',
      naicsCode: o.naicsCode || '',
      setAside: o.setAside || '',
    }));

  // Count notice types for summary
  const noticeSummary = buildNoticeSummary(sorted);

  return {
    date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    opportunities,
    deadlinesThisWeek,
    actionTips: actionTips.length > 0 ? actionTips : [
      'Review solicitation documents within 48 hours of receiving this brief',
      'Identify teaming partners for larger opportunities',
      'Check SAM.gov for amendments and Q&A updates',
    ],
    noticeSummary,
  };
}

// ============ BUILD BRIEFING FROM RAW OPPORTUNITIES (NO AI) ============

export function buildSamGreenBriefing(
  opportunities: SAMOpportunity[],
  context?: SamStrategicRankingContext,
  noticeSummaryOverride?: NoticeSummary
): SamDailyBriefing {
  // Fast deterministic strategic ranking for beta delivery.
  // This keeps the hot path fast while improving over pure deadline sorting.
  const ranked = [...opportunities]
    .filter(o => o.active && o.responseDeadline)
    .map(opportunity => ({
      opportunity,
      strategic: buildStrategicAssessment(opportunity, context),
    }))
    .sort((a, b) => {
      if (b.strategic.score !== a.strategic.score) {
        return b.strategic.score - a.strategic.score;
      }
      return new Date(a.opportunity.responseDeadline).getTime() - new Date(b.opportunity.responseDeadline).getTime();
    })
    .slice(0, 10);

  const sorted = ranked.map(entry => entry.opportunity);

  const briefingOpportunities: SamDailyOpportunity[] = ranked.slice(0, 5).map(({ opportunity: opp, strategic }, idx) => ({
    rank: idx + 1,
    title: opp.title,
    agency: opp.department || opp.subTier || 'Federal',
    naicsCode: opp.naicsCode,
    setAside: opp.setAsideDescription || opp.setAside,
    responseDeadline: formatSamDate(opp.responseDeadline),
    daysRemaining: getDaysUntil(opp.responseDeadline),
    noticeType: opp.noticeType,
    solicitationNumber: opp.solicitationNumber,
    samLink: opp.uiLink || `https://sam.gov/opp/${opp.noticeId}/view`,
    quickWinAssessment: strategic.summary,
    postedDate: formatSamDate(opp.postedDate),
  }));

  const weekFromNow = 7;
  const deadlinesThisWeek = sorted
    .filter(o => getDaysUntil(o.responseDeadline) <= weekFromNow && getDaysUntil(o.responseDeadline) >= 0)
    .map(o => ({
      title: o.title.slice(0, 60) + (o.title.length > 60 ? '...' : ''),
      fullTitle: o.title,
      deadline: o.responseDeadline,
      daysRemaining: getDaysUntil(o.responseDeadline),
      samLink: o.uiLink || `https://sam.gov/opp/${o.noticeId}/view`,
      noticeType: o.noticeType || 'Notice',
      noticeId: o.solicitationNumber || o.noticeId || '',
      agency: o.department || o.subTier || '',
      naicsCode: o.naicsCode || '',
      setAside: o.setAside || '',
    }));

  const noticeSummary = noticeSummaryOverride || buildNoticeSummary(
    ranked.map(entry => entry.opportunity)
  );

  return {
    date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    opportunities: briefingOpportunities,
    deadlinesThisWeek,
    actionTips: [
      'Review solicitation documents within 48 hours of receiving this brief',
      'Identify teaming partners for larger opportunities',
      'Check SAM.gov for amendments and Q&A updates',
    ],
    noticeSummary,
  };
}

// ============ EMAIL HTML GENERATOR ============

export function generateSamGreenEmailHtml(briefing: SamDailyBriefing, userEmail?: string, trackingToken?: string): { subject: string; htmlBody: string; textBody: string } {
  const getUrgencyColor = (days: number) => {
    if (days <= 3) return '#dc2626';
    if (days <= 7) return '#f97316';
    if (days <= 14) return '#eab308';
    return '#22c55e';
  };

  const getUrgencyLabel = (days: number) => {
    if (days <= 0) return 'DUE TODAY';
    if (days === 1) return 'DUE TOMORROW';
    if (days <= 3) return 'URGENT';
    if (days <= 7) return 'THIS WEEK';
    return `${days} DAYS`;
  };

  const getNoticeTypeInfo = (noticeType: string): { label: string; cssClass: string } => {
    const type = (noticeType || '').toLowerCase();
    if (type.includes('solicitation') || type.includes('rfp')) {
      return { label: 'RFP', cssClass: 'type-rfp' };
    } else if (type.includes('rfq') || type.includes('quote')) {
      return { label: 'RFQ', cssClass: 'type-rfq' };
    } else if (type.includes('source') || type.includes('rfi') || type.includes('market research')) {
      return { label: 'Sources Sought', cssClass: 'type-sources' };
    } else if (type.includes('presol') || type.includes('intent') || type.includes('pre-sol')) {
      return { label: 'Pre-Sol', cssClass: 'type-presol' };
    } else if (type.includes('combined')) {
      return { label: 'Combined', cssClass: 'type-combined' };
    }
    return { label: 'Notice', cssClass: 'type-other' };
  };

  const htmlBody = `
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
    .opp-type-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 4px; white-space: nowrap; }
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
    .notice-summary { background: #f0f9ff; padding: 16px; margin: 0; border-bottom: 1px solid #bae6fd; }
    .notice-summary-title { font-size: 12px; font-weight: 700; color: #0369a1; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    .notice-pills { display: flex; flex-wrap: wrap; gap: 8px; }
    .notice-pill { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 16px; font-size: 12px; font-weight: 600; }
    .notice-pill-count { margin-right: 4px; }
    .pill-rfp { background: #dbeafe; color: #1e40af; }
    .pill-rfq { background: #fef3c7; color: #92400e; }
    .pill-sources { background: #d1fae5; color: #065f46; }
    .pill-presol { background: #f3e8ff; color: #6b21a8; }
    .pill-combined { background: #fce7f3; color: #9d174d; }
    .pill-other { background: #f3f4f6; color: #374151; }
    .deadline-type { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; margin-left: 8px; vertical-align: middle; }
    .type-rfp { background: #dbeafe; color: #1e40af; }
    .type-rfq { background: #fef3c7; color: #92400e; }
    .type-sources { background: #d1fae5; color: #065f46; }
    .type-presol { background: #f3e8ff; color: #6b21a8; }
    .type-combined { background: #fce7f3; color: #9d174d; }
    .type-other { background: #f3f4f6; color: #374151; }
    .sat-badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 4px; white-space: nowrap; margin-left: 4px; }
    .sat-high { background: #dcfce7; color: #166534; }
    .sat-moderate { background: #fef9c3; color: #854d0e; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Market Intelligence FREE PREVIEW Banner -->
    <div style="background: linear-gradient(90deg, #dc2626 0%, #ef4444 100%); padding: 12px 20px; text-align: center;">
      <p style="color: white; margin: 0; font-size: 13px; font-weight: 600;">
        🎯 Market Intelligence • FREE PREVIEW during beta • Personalized win analysis + strategic teaming plays
      </p>
    </div>

    <div class="header">
      <h1>📋 Active Solicitations</h1>
      <p>${briefing.date}</p>
      <div class="header-badge">✅ VERIFIED FROM SAM.gov</div>
    </div>

    <div class="notice-summary">
      <div class="notice-summary-title">📊 Notice Type Summary (${briefing.noticeSummary.totalMatched} matched active)</div>
      <div class="notice-pills">
        ${briefing.noticeSummary.rfp > 0 ? `<span class="notice-pill pill-rfp"><span class="notice-pill-count">${briefing.noticeSummary.rfp}</span> RFP/Solicitation</span>` : ''}
        ${briefing.noticeSummary.rfq > 0 ? `<span class="notice-pill pill-rfq"><span class="notice-pill-count">${briefing.noticeSummary.rfq}</span> RFQ</span>` : ''}
        ${briefing.noticeSummary.sourcesSought > 0 ? `<span class="notice-pill pill-sources"><span class="notice-pill-count">${briefing.noticeSummary.sourcesSought}</span> Sources Sought/RFI</span>` : ''}
        ${briefing.noticeSummary.preSol > 0 ? `<span class="notice-pill pill-presol"><span class="notice-pill-count">${briefing.noticeSummary.preSol}</span> Pre-Sol</span>` : ''}
        ${briefing.noticeSummary.combined > 0 ? `<span class="notice-pill pill-combined"><span class="notice-pill-count">${briefing.noticeSummary.combined}</span> Combined</span>` : ''}
        ${briefing.noticeSummary.other > 0 ? `<span class="notice-pill pill-other"><span class="notice-pill-count">${briefing.noticeSummary.other}</span> Other</span>` : ''}
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <h2>🎯 TOP ${briefing.opportunities.length} OPPORTUNITIES TO BID</h2>
      </div>
      ${briefing.opportunities.map(opp => {
        const oppTypeInfo = getNoticeTypeInfo(opp.noticeType);
        const satInfo = getSatBadgeForAgency(opp.agency);
        const satBadgeHtml = satInfo.badge ? `<span class="sat-badge sat-${satInfo.level}">${satInfo.badge}</span>` : '';
        return `
        <div class="opp-card">
          <div class="opp-header">
            <div style="display: flex; align-items: flex-start; flex-wrap: wrap; gap: 6px;">
              <span class="opp-rank">${opp.rank}</span>
              <h3 class="opp-title">${escapeHtml(opp.title)}</h3>
              <span class="opp-type-badge ${oppTypeInfo.cssClass}">${oppTypeInfo.label}</span>${satBadgeHtml}
            </div>
            <span class="urgency-badge" style="background: ${getUrgencyColor(opp.daysRemaining)};">${getUrgencyLabel(opp.daysRemaining)}</span>
          </div>
          <div class="opp-meta">
            <div class="opp-meta-item">
              <span class="opp-meta-label">Agency</span>
              <span class="opp-meta-value">${escapeHtml(opp.agency)}</span>
            </div>
            <div class="opp-meta-item">
              <span class="opp-meta-label">Posted</span>
              <span class="opp-meta-value">${escapeHtml(opp.postedDate)}</span>
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
          <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px;">
            <a href="${trackingToken ? generateTrackedLink(trackingToken, opp.samLink, 'view_sam_gov') : opp.samLink}" class="sam-link" target="_blank" style="margin-top: 0;">View on SAM.gov →</a>
            ${userEmail ? `
            <a href="https://tools.govcongiants.org/api/actions/mute-opportunity?email=${encodeURIComponent(userEmail)}&title=${encodeURIComponent(opp.title)}&notice_id=${encodeURIComponent(opp.solicitationNumber || '')}" style="display: inline-block; background: #475569; color: white; padding: 10px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; text-decoration: none;">🔇 Not Interested</a>
            ` : ''}
          </div>
        </div>
      `}).join('')}
    </div>

    ${briefing.deadlinesThisWeek.length > 0 ? `
    <div class="section" style="padding-top: 0;">
      <div class="deadline-section">
        <h3 class="deadline-header">⏰ DEADLINES THIS WEEK</h3>
        ${briefing.deadlinesThisWeek.map(d => {
          const typeInfo = getNoticeTypeInfo(d.noticeType);
          const deadlineSatInfo = getSatBadgeForAgency(d.agency);
          const deadlineSatBadgeHtml = deadlineSatInfo.badge ? `<span class="sat-badge sat-${deadlineSatInfo.level}" style="font-size: 9px; padding: 2px 5px;">${deadlineSatInfo.badge}</span>` : '';
          const deadlineMuteUrl = userEmail ? `https://tools.govcongiants.org/api/actions/mute-opportunity?email=${encodeURIComponent(userEmail)}&title=${encodeURIComponent(d.fullTitle)}&notice_id=${encodeURIComponent(d.noticeId)}` : '';
          return `
          <div class="deadline-item" style="flex-direction: column; align-items: flex-start;">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
              <span class="deadline-title">${escapeHtml(d.title)}<span class="deadline-type ${typeInfo.cssClass}">${typeInfo.label}</span>${deadlineSatBadgeHtml}</span>
              <span class="deadline-days" style="background: ${getUrgencyColor(d.daysRemaining)};">${d.daysRemaining === 0 ? 'TODAY' : d.daysRemaining === 1 ? 'TOMORROW' : d.daysRemaining + ' days'}</span>
            </div>
            ${userEmail ? `
            <div style="display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;">
              <a href="${trackingToken ? generateTrackedLink(trackingToken, d.samLink, 'view_deadline') : d.samLink}" style="display: inline-block; background: #059669; color: white; padding: 6px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; text-decoration: none;">View →</a>
              <a href="${deadlineMuteUrl}" style="display: inline-block; background: #475569; color: white; padding: 6px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; text-decoration: none;">🔇</a>
            </div>
            ` : ''}
          </div>
        `}).join('')}
      </div>
    </div>
    ` : ''}

    <div class="section" style="padding-top: 0;">
      <div class="tips-section">
        <h3 class="tips-header">💡 ACTION TIPS</h3>
        ${briefing.actionTips.map(tip => `<div class="tip-item">${escapeHtml(tip)}</div>`).join('')}
      </div>
    </div>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${trackingToken ? generateTrackedLink(trackingToken, 'https://tools.govcongiants.org/briefings/dashboard', 'browse_all_opportunities') : 'https://tools.govcongiants.org/briefings/dashboard'}" style="display: inline-block; background: linear-gradient(135deg, #059669, #10b981); color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">Browse All ${briefing.noticeSummary.totalMatched} Opportunities →</a>
    </div>
    <div class="footer">
      <p>Generated by <strong>GovCon Giants AI</strong></p>
      <span class="source-badge">Data Source: SAM.gov Opportunities API</span>
      <p style="margin-top: 12px;"><a href="${trackingToken ? generateTrackedLink(trackingToken, 'https://tools.govcongiants.org/alerts/preferences', 'manage_preferences') : 'https://tools.govcongiants.org/alerts/preferences'}">Manage Preferences</a> | <a href="${trackingToken ? generateTrackedLink(trackingToken, 'https://tools.govcongiants.org/briefings/dashboard', 'view_dashboard') : 'https://tools.govcongiants.org/briefings/dashboard'}">View Dashboard</a></p>
    </div>
  </div>
  ${trackingToken ? generateTrackingPixel(trackingToken) : ''}
</body>
</html>
`;

  // Plain text version
  let textBody = `📋 ACTIVE SOLICITATIONS - BID NOW\n${briefing.date}\n${'='.repeat(50)}\n\n`;
  textBody += `✅ Data verified from SAM.gov\n\n`;

  for (const opp of briefing.opportunities) {
    textBody += `${opp.rank}. ${opp.title}\n`;
    textBody += `   Agency: ${opp.agency}\n`;
    textBody += `   NAICS: ${opp.naicsCode} | Set-Aside: ${opp.setAside || 'Full & Open'}\n`;
    textBody += `   Response Due: ${opp.responseDeadline} (${opp.daysRemaining} days remaining)\n`;
    textBody += `   Assessment: ${opp.quickWinAssessment}\n`;
    textBody += `   SAM.gov: ${opp.samLink}\n`;
    if (userEmail) {
      textBody += `   → Not Interested: https://tools.govcongiants.org/api/actions/mute-opportunity?email=${encodeURIComponent(userEmail)}&title=${encodeURIComponent(opp.title)}&notice_id=${encodeURIComponent(opp.solicitationNumber || '')}\n`;
    }
    textBody += `\n`;
  }

  if (briefing.deadlinesThisWeek.length > 0) {
    textBody += `\n⏰ DEADLINES THIS WEEK\n${'─'.repeat(30)}\n`;
    for (const d of briefing.deadlinesThisWeek) {
      textBody += `• ${d.title} - ${d.daysRemaining === 0 ? 'TODAY' : d.daysRemaining + ' days'}\n`;
      textBody += `  SAM.gov: ${d.samLink}\n`;
    }
  }

  textBody += `\n💡 ACTION TIPS\n${'─'.repeat(30)}\n`;
  for (const tip of briefing.actionTips) {
    textBody += `✓ ${tip}\n`;
  }

  const subject = `📋 ${briefing.opportunities.length} Active Solicitations - ${briefing.date.split(',')[0]}`;

  return { subject, htmlBody, textBody };
}
