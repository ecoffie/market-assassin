/**
 * Unified Diff Engine
 *
 * Combines diffs from all data pipelines into a single briefing-ready format.
 * Ranks items by relevance and actionability.
 */

import { SAMOpportunity, diffOpportunities, scoreOpportunity } from './pipelines/sam-gov';
import { RecompeteContract, diffRecompetes, scoreRecompete } from './pipelines/fpds-recompete';
import { ContractAward, diffAwards, scoreAward } from './pipelines/contract-awards';
import { ContractorRecord, ContractorChangeEvent, diffContractors, scoreContractorForTeaming } from './pipelines/contractor-db';
import { WebSignal } from './web-intel/types';

// Unified briefing item that can represent any data type
interface BriefingItem {
  id: string;
  source: 'opportunity_hunter' | 'market_assassin' | 'recompete' | 'contractor_db' | 'web_intelligence';
  category:
    | 'new_opportunity'
    | 'deadline_alert'
    | 'amendment'
    | 'new_award'
    | 'competitor_win'
    | 'recompete_alert'
    | 'timeline_change'
    | 'teaming_signal'
    | 'sblo_update'
    | 'certification_change'
    | 'spending_shift'
    | 'web_signal';

  // Core display fields
  title: string;
  subtitle: string;
  description: string;

  // Scoring
  relevanceScore: number;
  urgencyScore: number;
  actionabilityScore: number;
  overallScore: number;

  // Metadata
  agency: string;
  naicsCode: string;
  amount: number | null;
  deadline: string | null;
  changeType: string | null;
  signals: string[];

  // Action
  actionUrl: string;
  actionLabel: string;

  // Raw data reference
  rawData: unknown;
}

interface UserBriefingProfile {
  naics_codes: string[];
  agencies: string[];
  keywords: string[];
  zip_codes: string[];
  watched_companies: string[];
  watched_contracts: string[];
}

interface DiffResult {
  items: BriefingItem[];
  summary: {
    totalItems: number;
    bySource: Record<string, number>;
    byCategory: Record<string, number>;
    topAgencies: Array<{ agency: string; count: number }>;
  };
  generatedAt: string;
}

/**
 * Process opportunity diffs into briefing items
 */
export function processOpportunityDiffs(
  today: SAMOpportunity[],
  yesterday: SAMOpportunity[],
  userProfile: UserBriefingProfile
): BriefingItem[] {
  const diff = diffOpportunities(today, yesterday);
  const items: BriefingItem[] = [];

  // NEW OPPORTUNITIES
  for (const opp of diff.new) {
    const score = scoreOpportunity(opp, userProfile);
    const urgency = calculateDeadlineUrgency(opp.responseDeadline);

    items.push({
      id: `opp-new-${opp.noticeId}`,
      source: 'opportunity_hunter',
      category: 'new_opportunity',

      title: opp.title,
      subtitle: `${opp.department} • ${opp.setAside || 'Open'}`,
      description: truncate(opp.description, 200),

      relevanceScore: score,
      urgencyScore: urgency,
      actionabilityScore: opp.setAside ? 80 : 60, // Set-asides more actionable
      overallScore: calculateOverallScore(score, urgency, opp.setAside ? 80 : 60),

      agency: opp.department,
      naicsCode: opp.naicsCode,
      amount: null,
      deadline: opp.responseDeadline,
      changeType: 'new',
      signals: ['new_posting'],

      actionUrl: opp.uiLink,
      actionLabel: 'View on SAM.gov',

      rawData: opp,
    });
  }

  // DEADLINE ALERTS (due within 7 days)
  const urgentOpps = today.filter(o => {
    const days = getDaysUntil(o.responseDeadline);
    return days >= 0 && days <= 7;
  });

  for (const opp of urgentOpps) {
    const daysLeft = getDaysUntil(opp.responseDeadline);
    const score = scoreOpportunity(opp, userProfile);

    items.push({
      id: `opp-deadline-${opp.noticeId}`,
      source: 'opportunity_hunter',
      category: 'deadline_alert',

      title: `${daysLeft} days left: ${opp.title}`,
      subtitle: `Due ${opp.responseDeadline}`,
      description: `Response deadline approaching for ${opp.solicitationNumber}`,

      relevanceScore: score,
      urgencyScore: 100 - (daysLeft * 10), // Higher urgency as deadline approaches
      actionabilityScore: 90,
      overallScore: calculateOverallScore(score, 100 - (daysLeft * 10), 90),

      agency: opp.department,
      naicsCode: opp.naicsCode,
      amount: null,
      deadline: opp.responseDeadline,
      changeType: 'deadline',
      signals: [`${daysLeft}_days_remaining`],

      actionUrl: opp.uiLink,
      actionLabel: 'Submit Response',

      rawData: opp,
    });
  }

  // AMENDMENTS
  for (const { opportunity: opp, changes } of diff.modified) {
    if (!changes.includes('amendment_posted')) continue;

    const score = scoreOpportunity(opp, userProfile);

    items.push({
      id: `opp-amend-${opp.noticeId}`,
      source: 'opportunity_hunter',
      category: 'amendment',

      title: `Amendment: ${opp.title}`,
      subtitle: changes.join(', '),
      description: `Solicitation ${opp.solicitationNumber} has been modified`,

      relevanceScore: score,
      urgencyScore: 70,
      actionabilityScore: 75,
      overallScore: calculateOverallScore(score, 70, 75),

      agency: opp.department,
      naicsCode: opp.naicsCode,
      amount: null,
      deadline: opp.responseDeadline,
      changeType: 'amendment',
      signals: changes,

      actionUrl: opp.uiLink,
      actionLabel: 'Review Amendment',

      rawData: opp,
    });
  }

  return items;
}

/**
 * Process recompete diffs into briefing items
 */
export function processRecompeteDiffs(
  today: RecompeteContract[],
  yesterday: RecompeteContract[],
  userProfile: UserBriefingProfile
): BriefingItem[] {
  const diff = diffRecompetes(today, yesterday);
  const items: BriefingItem[] = [];

  // ENTERED 90-DAY WINDOW
  for (const contract of diff.enteredWindow) {
    const { displacementScore, factors } = scoreRecompete(contract, userProfile);

    items.push({
      id: `rec-window-${contract.contractNumber || contract.incumbentName}`,
      source: 'recompete',
      category: 'recompete_alert',

      title: `90-Day Alert: ${contract.incumbentName}`,
      subtitle: `${contract.agency} • Expires in ${contract.daysUntilExpiration} days`,
      description: `$${(contract.obligatedAmount / 1000000).toFixed(1)}M contract entering recompete window`,

      relevanceScore: displacementScore,
      urgencyScore: 85,
      actionabilityScore: 80,
      overallScore: calculateOverallScore(displacementScore, 85, 80),

      agency: contract.agency,
      naicsCode: contract.naicsCode,
      amount: contract.obligatedAmount,
      deadline: contract.currentCompletionDate,
      changeType: 'entered_90_day_window',
      signals: factors,

      actionUrl: contract.contractNumber
        ? `https://sam.gov/search/?keywords=${encodeURIComponent(contract.contractNumber)}&sort=-modifiedDate&index=opp&is_active=true&page=1`
        : `https://sam.gov/search/?keywords=${encodeURIComponent(contract.incumbentName)}&sort=-modifiedDate&index=opp&is_active=true&page=1`,
      actionLabel: 'Research Recompete',

      rawData: contract,
    });
  }

  // TIMELINE CHANGES
  for (const { contract, changes } of diff.timelineChanges) {
    const { displacementScore, factors } = scoreRecompete(contract, userProfile);

    items.push({
      id: `rec-timeline-${contract.contractNumber || contract.incumbentName}`,
      source: 'recompete',
      category: 'timeline_change',

      title: `Timeline Change: ${contract.incumbentName}`,
      subtitle: changes.join(', '),
      description: `Contract timeline has been modified`,

      relevanceScore: displacementScore,
      urgencyScore: 60,
      actionabilityScore: 70,
      overallScore: calculateOverallScore(displacementScore, 60, 70),

      agency: contract.agency,
      naicsCode: contract.naicsCode,
      amount: contract.obligatedAmount,
      deadline: contract.currentCompletionDate,
      changeType: 'timeline',
      signals: [...factors, ...changes],

      actionUrl: contract.contractNumber
        ? `https://sam.gov/search/?keywords=${encodeURIComponent(contract.contractNumber)}&sort=-modifiedDate&index=opp&is_active=true&page=1`
        : `https://sam.gov/search/?keywords=${encodeURIComponent(contract.incumbentName)}&sort=-modifiedDate&index=opp&is_active=true&page=1`,
      actionLabel: 'View on SAM.gov',

      rawData: contract,
    });
  }

  // NEW RECOMPETES
  for (const contract of diff.newRecompetes) {
    const { displacementScore, factors } = scoreRecompete(contract, userProfile);

    items.push({
      id: `rec-new-${contract.contractNumber || contract.incumbentName}`,
      source: 'recompete',
      category: 'recompete_alert',

      title: `New Recompete: ${contract.incumbentName}`,
      subtitle: `${contract.agency} • ${contract.daysUntilExpiration} days`,
      description: `$${(contract.obligatedAmount / 1000000).toFixed(1)}M contract now in tracking window`,

      relevanceScore: displacementScore,
      urgencyScore: 50,
      actionabilityScore: 70,
      overallScore: calculateOverallScore(displacementScore, 50, 70),

      agency: contract.agency,
      naicsCode: contract.naicsCode,
      amount: contract.obligatedAmount,
      deadline: contract.currentCompletionDate,
      changeType: 'new_recompete',
      signals: factors,

      actionUrl: contract.contractNumber
        ? `https://sam.gov/search/?keywords=${encodeURIComponent(contract.contractNumber)}&sort=-modifiedDate&index=opp&is_active=true&page=1`
        : `https://sam.gov/search/?keywords=${encodeURIComponent(contract.incumbentName)}&sort=-modifiedDate&index=opp&is_active=true&page=1`,
      actionLabel: 'Find Solicitation',

      rawData: contract,
    });
  }

  return items;
}

/**
 * Process award diffs into briefing items
 */
export function processAwardDiffs(
  today: ContractAward[],
  yesterday: ContractAward[],
  userProfile: UserBriefingProfile
): BriefingItem[] {
  const diff = diffAwards(today, yesterday);
  const items: BriefingItem[] = [];

  // NEW AWARDS
  for (const award of diff.newAwards) {
    const { relevanceScore, signals } = scoreAward(award, userProfile);
    const isCompetitorWin = userProfile.watched_companies.some(c =>
      award.recipientName.toLowerCase().includes(c.toLowerCase())
    );

    items.push({
      id: `award-new-${award.awardId}`,
      source: 'market_assassin',
      category: isCompetitorWin ? 'competitor_win' : 'new_award',

      title: isCompetitorWin
        ? `Competitor Win: ${award.recipientName}`
        : `New Award: ${award.recipientName}`,
      subtitle: `$${(award.awardAmount / 1000000).toFixed(2)}M • ${award.awardingSubAgency}`,
      description: `${award.naicsDescription || award.naicsCode}`,

      relevanceScore,
      urgencyScore: 60,
      actionabilityScore: isCompetitorWin ? 85 : 65,
      overallScore: calculateOverallScore(relevanceScore, 60, isCompetitorWin ? 85 : 65),

      agency: award.awardingAgency,
      naicsCode: award.naicsCode,
      amount: award.awardAmount,
      deadline: null,
      changeType: isCompetitorWin ? 'competitor_won' : 'new_award',
      signals,

      actionUrl: `https://usaspending.gov/award/${award.awardId}`,
      actionLabel: 'View Award Details',

      rawData: award,
    });
  }

  // SPENDING SHIFTS
  for (const shift of diff.spendingShifts) {
    const direction = shift.changePercent > 0 ? 'increased' : 'decreased';
    const absPercent = Math.abs(shift.changePercent).toFixed(0);

    items.push({
      id: `award-spend-${shift.agency}`,
      source: 'market_assassin',
      category: 'spending_shift',

      title: `Spending ${direction} ${absPercent}%: ${shift.agency}`,
      subtitle: `$${(shift.currentWeekSpending / 1000000).toFixed(1)}M this week`,
      description: `Week-over-week change in ${shift.agency} spending`,

      relevanceScore: 70,
      urgencyScore: 50,
      actionabilityScore: 60,
      overallScore: calculateOverallScore(70, 50, 60),

      agency: shift.agency,
      naicsCode: '',
      amount: shift.currentWeekSpending,
      deadline: null,
      changeType: `spending_${direction}`,
      signals: [`${absPercent}%_change`],

      actionUrl: `https://usaspending.gov/agency/${encodeURIComponent(shift.agency)}`,
      actionLabel: 'View Agency Spending',

      rawData: shift,
    });
  }

  return items;
}

/**
 * Process contractor diffs into briefing items
 */
export function processContractorDiffs(
  today: ContractorRecord[],
  yesterday: ContractorRecord[],
  userProfile: UserBriefingProfile
): BriefingItem[] {
  const diff = diffContractors(today, yesterday);
  const items: BriefingItem[] = [];

  // SBLO CHANGES
  for (const change of diff.sbloChanges) {
    items.push({
      id: `cont-sblo-${change.contractorId}`,
      source: 'contractor_db',
      category: 'sblo_update',

      title: `SBLO Update: ${change.companyName}`,
      subtitle: change.changeDetails,
      description: `New contact information available for teaming outreach`,

      relevanceScore: 75,
      urgencyScore: 60,
      actionabilityScore: 85,
      overallScore: calculateOverallScore(75, 60, 85),

      agency: '',
      naicsCode: '',
      amount: null,
      deadline: null,
      changeType: 'sblo_changed',
      signals: ['contact_updated'],

      actionUrl: '#contractor-db',
      actionLabel: 'View Contact',

      rawData: change,
    });
  }

  // CERTIFICATION CHANGES
  for (const change of diff.certificationChanges) {
    const isGained = change.changeType === 'certification_gained';

    items.push({
      id: `cont-cert-${change.contractorId}-${change.newValue || change.previousValue}`,
      source: 'contractor_db',
      category: 'certification_change',

      title: `${isGained ? 'New' : 'Lost'} Cert: ${change.companyName}`,
      subtitle: change.changeDetails,
      description: isGained
        ? `May now be eligible for additional set-asides`
        : `Certification status changed`,

      relevanceScore: 70,
      urgencyScore: 50,
      actionabilityScore: isGained ? 80 : 60,
      overallScore: calculateOverallScore(70, 50, isGained ? 80 : 60),

      agency: '',
      naicsCode: '',
      amount: null,
      deadline: null,
      changeType: change.changeType,
      signals: [isGained ? 'cert_gained' : 'cert_lost'],

      actionUrl: '#contractor-db',
      actionLabel: 'View Profile',

      rawData: change,
    });
  }

  // NEW ENTRANTS (teaming opportunities)
  for (const contractor of diff.newEntrants) {
    const { teamingScore, reasons } = scoreContractorForTeaming(contractor, userProfile);

    if (teamingScore < 30) continue; // Only show relevant new entrants

    items.push({
      id: `cont-new-${contractor.id}`,
      source: 'contractor_db',
      category: 'teaming_signal',

      title: `New Contractor: ${contractor.companyName}`,
      subtitle: contractor.certifications.join(', ') || 'No certifications listed',
      description: `Potential teaming partner in your NAICS codes`,

      relevanceScore: teamingScore,
      urgencyScore: 40,
      actionabilityScore: contractor.sbloEmail ? 85 : 60,
      overallScore: calculateOverallScore(teamingScore, 40, contractor.sbloEmail ? 85 : 60),

      agency: '',
      naicsCode: contractor.primaryNaics,
      amount: null,
      deadline: null,
      changeType: 'new_entrant',
      signals: reasons,

      actionUrl: contractor.website || '#contractor-db',
      actionLabel: contractor.sbloEmail ? 'Contact SBLO' : 'View Profile',

      rawData: contractor,
    });
  }

  // SUBK PLAN CHANGES
  for (const change of diff.subkPlanChanges) {
    items.push({
      id: `cont-subk-${change.contractorId}`,
      source: 'contractor_db',
      category: 'teaming_signal',

      title: `New SubK Plan: ${change.companyName}`,
      subtitle: 'Subcontracting opportunity available',
      description: `${change.companyName} posted a new subcontracting plan`,

      relevanceScore: 80,
      urgencyScore: 65,
      actionabilityScore: 90,
      overallScore: calculateOverallScore(80, 65, 90),

      agency: '',
      naicsCode: '',
      amount: null,
      deadline: null,
      changeType: 'subk_plan',
      signals: ['new_subk_plan'],

      actionUrl: '#contractor-db',
      actionLabel: 'View SubK Goals',

      rawData: change,
    });
  }

  return items;
}

/**
 * Process web intelligence signals into briefing items
 */
export function processWebSignals(signals: WebSignal[]): BriefingItem[] {
  const items: BriefingItem[] = [];

  for (const signal of signals) {
    // Map signal urgency to urgency score
    const urgencyScore = mapUrgencyToScore(signal.urgency);

    // Map signal type to a more actionable description
    const actionLabel = getActionLabelForSignal(signal.signal_type);

    items.push({
      id: signal.id,
      source: 'web_intelligence',
      category: 'web_signal',

      title: signal.headline,
      subtitle: signal.agency || signal.source_name,
      description: signal.detail,

      relevanceScore: signal.relevance_score,
      urgencyScore: urgencyScore,
      actionabilityScore: signal.competitive_implication ? 75 : 60,
      overallScore: calculateOverallScore(
        signal.relevance_score,
        urgencyScore,
        signal.competitive_implication ? 75 : 60
      ),

      agency: signal.agency || '',
      naicsCode: signal.naics_relevance[0] || '',
      amount: null,
      deadline: null,
      changeType: signal.signal_type.toLowerCase(),
      signals: [
        signal.signal_type,
        ...signal.companies_mentioned.map((c) => `company:${c}`),
        ...signal.naics_relevance.map((n) => `naics:${n}`),
      ],

      actionUrl: signal.source_url,
      actionLabel: actionLabel,

      rawData: signal,
    });
  }

  return items;
}

/**
 * Map urgency string to numeric score
 */
function mapUrgencyToScore(urgency: string): number {
  switch (urgency) {
    case 'immediate':
      return 100;
    case 'this_week':
      return 80;
    case 'this_month':
      return 50;
    case 'monitor':
      return 30;
    default:
      return 50;
  }
}

/**
 * Get action label based on signal type
 */
function getActionLabelForSignal(signalType: string): string {
  switch (signalType) {
    case 'AWARD_NEWS':
      return 'View Award Details';
    case 'PROTEST':
      return 'View GAO Decision';
    case 'AGENCY_ANNOUNCEMENT':
      return 'Read Announcement';
    case 'COMPETITOR_MOVE':
      return 'Analyze Competitor';
    case 'PRIME_TEAMING_SIGNAL':
      return 'Explore Teaming';
    case 'BUDGET_SIGNAL':
      return 'Review Budget';
    case 'REGULATORY':
      return 'Read Policy Change';
    case 'LEADERSHIP':
      return 'View Personnel Change';
    default:
      return 'Read More';
  }
}

/**
 * Combine and rank all briefing items
 */
export function generateBriefingDiff(
  opportunities: { today: SAMOpportunity[]; yesterday: SAMOpportunity[] },
  recompetes: { today: RecompeteContract[]; yesterday: RecompeteContract[] },
  awards: { today: ContractAward[]; yesterday: ContractAward[] },
  contractors: { today: ContractorRecord[]; yesterday: ContractorRecord[] },
  userProfile: UserBriefingProfile,
  webSignals?: WebSignal[]
): DiffResult {
  // Process all diffs
  const oppItems = processOpportunityDiffs(
    opportunities.today,
    opportunities.yesterday,
    userProfile
  );

  const recompeteItems = processRecompeteDiffs(
    recompetes.today,
    recompetes.yesterday,
    userProfile
  );

  const awardItems = processAwardDiffs(
    awards.today,
    awards.yesterday,
    userProfile
  );

  const contractorItems = processContractorDiffs(
    contractors.today,
    contractors.yesterday,
    userProfile
  );

  // Process web signals if provided
  const webItems = webSignals ? processWebSignals(webSignals) : [];

  // Combine all items
  const allItems = [
    ...oppItems,
    ...recompeteItems,
    ...awardItems,
    ...contractorItems,
    ...webItems,
  ];

  // Sort by overall score (highest first)
  allItems.sort((a, b) => b.overallScore - a.overallScore);

  // Generate summary
  const bySource: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const agencyCounts: Record<string, number> = {};

  for (const item of allItems) {
    bySource[item.source] = (bySource[item.source] || 0) + 1;
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    if (item.agency) {
      agencyCounts[item.agency] = (agencyCounts[item.agency] || 0) + 1;
    }
  }

  const topAgencies = Object.entries(agencyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([agency, count]) => ({ agency, count }));

  return {
    items: allItems,
    summary: {
      totalItems: allItems.length,
      bySource,
      byCategory,
      topAgencies,
    },
    generatedAt: new Date().toISOString(),
  };
}

// Helper functions
function calculateOverallScore(relevance: number, urgency: number, actionability: number): number {
  // Weighted average: relevance 40%, urgency 35%, actionability 25%
  return Math.round(relevance * 0.4 + urgency * 0.35 + actionability * 0.25);
}

function calculateDeadlineUrgency(deadline: string | null): number {
  if (!deadline) return 30;
  const days = getDaysUntil(deadline);
  if (days < 0) return 0;
  if (days <= 3) return 100;
  if (days <= 7) return 85;
  if (days <= 14) return 70;
  if (days <= 30) return 50;
  return 30;
}

function getDaysUntil(dateString: string): number {
  if (!dateString) return 999;
  const target = new Date(dateString);
  const today = new Date();
  const diff = target.getTime() - today.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function truncate(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text || '';
  return text.substring(0, maxLength - 3) + '...';
}

export type { BriefingItem, UserBriefingProfile, DiffResult };
