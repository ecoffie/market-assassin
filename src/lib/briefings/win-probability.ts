/**
 * Win Probability Scoring
 *
 * Calculates a 0-100% win probability score for opportunities based on
 * how well they match the user's profile, capabilities, and certifications.
 */

import { BriefingUserProfile } from '../smart-profile/types';

export interface WinProbabilityResult {
  score: number; // 0-100
  tier: 'excellent' | 'good' | 'moderate' | 'low' | 'poor';
  factors: WinFactor[];
  summary: string;
}

export interface WinFactor {
  name: string;
  points: number;
  maxPoints: number;
  description: string;
  isPositive: boolean;
}

export interface OpportunityData {
  naicsCode?: string;
  setAside?: string;
  agency?: string;
  amount?: number;
  description?: string;
  title?: string;
  placeOfPerformance?: string;
}

// Set-aside type mappings for matching
const SET_ASIDE_CERT_MAP: Record<string, string[]> = {
  // Set-aside type -> matching certifications
  'SBA': ['8(a)', 'SDB'],
  '8(a)': ['8(a)'],
  '8A': ['8(a)'],
  'SDVOSB': ['SDVOSB'],
  'SDVOSBC': ['SDVOSB'],
  'VOSB': ['SDVOSB', 'VOSB'],
  'WOSB': ['WOSB', 'EDWOSB'],
  'EDWOSB': ['EDWOSB'],
  'HUBZone': ['HUBZone'],
  'HUBZONE': ['HUBZone'],
  'SB': ['Small Business', '8(a)', 'SDVOSB', 'WOSB', 'HUBZone', 'SDB'],
  'Small Business': ['Small Business', '8(a)', 'SDVOSB', 'WOSB', 'HUBZone', 'SDB'],
  'Total Small Business Set-Aside': ['Small Business', '8(a)', 'SDVOSB', 'WOSB', 'HUBZone', 'SDB'],
  'Partial Small Business Set-Aside': ['Small Business', '8(a)', 'SDVOSB', 'WOSB', 'HUBZone', 'SDB'],
};

// Contract size thresholds by company size
const SIZE_THRESHOLDS: Record<string, number> = {
  'micro': 1_000_000, // $1M
  'small': 25_000_000, // $25M
  'midsize': 100_000_000, // $100M
  'large': Infinity,
};

/**
 * Calculate win probability for an opportunity
 */
export function calculateWinProbability(
  opportunity: OpportunityData,
  profile: BriefingUserProfile | null
): WinProbabilityResult {
  const factors: WinFactor[] = [];
  let totalScore = 0;

  // If no profile, return base score
  if (!profile) {
    return {
      score: 30,
      tier: 'low',
      factors: [{
        name: 'Profile Missing',
        points: 0,
        maxPoints: 100,
        description: 'Complete your profile to get personalized win scores',
        isPositive: false,
      }],
      summary: 'Complete your profile for personalized scoring',
    };
  }

  // 1. NAICS Match (0-25 points)
  const naicsFactor = scoreNaicsMatch(opportunity.naicsCode, profile);
  factors.push(naicsFactor);
  totalScore += naicsFactor.points;

  // 2. Set-Aside Eligibility (0-25 points)
  const setAsideFactor = scoreSetAsideMatch(opportunity.setAside, profile);
  factors.push(setAsideFactor);
  totalScore += setAsideFactor.points;

  // 3. Agency Experience (0-15 points)
  const agencyFactor = scoreAgencyExperience(opportunity.agency, profile);
  factors.push(agencyFactor);
  totalScore += agencyFactor.points;

  // 4. Contract Size Fit (0-15 points)
  const sizeFactor = scoreContractSizeFit(opportunity.amount, profile);
  factors.push(sizeFactor);
  totalScore += sizeFactor.points;

  // 5. Capability Match (0-10 points)
  const capabilityFactor = scoreCapabilityMatch(
    `${opportunity.title || ''} ${opportunity.description || ''}`,
    profile
  );
  factors.push(capabilityFactor);
  totalScore += capabilityFactor.points;

  // 6. Contract Vehicle (0-10 points)
  const vehicleFactor = scoreContractVehicle(opportunity, profile);
  factors.push(vehicleFactor);
  totalScore += vehicleFactor.points;

  // Determine tier
  const tier = getTier(totalScore);
  const summary = generateSummary(totalScore, factors, profile);

  return {
    score: totalScore,
    tier,
    factors,
    summary,
  };
}

/**
 * Score NAICS code match (0-25 points)
 */
function scoreNaicsMatch(
  oppNaics: string | undefined,
  profile: BriefingUserProfile
): WinFactor {
  if (!oppNaics) {
    return {
      name: 'NAICS Match',
      points: 10,
      maxPoints: 25,
      description: 'No NAICS specified - open to all',
      isPositive: true,
    };
  }

  const userNaics = [...profile.naicsCodes, ...profile.topNaics];

  // Exact match
  if (userNaics.includes(oppNaics)) {
    return {
      name: 'NAICS Match',
      points: 25,
      maxPoints: 25,
      description: `Exact match: ${oppNaics}`,
      isPositive: true,
    };
  }

  // Prefix match (e.g., user has 541512, opp is 5415)
  const oppPrefix = oppNaics.substring(0, 4);
  const hasPrefix = userNaics.some(n => n.startsWith(oppPrefix) || oppNaics.startsWith(n.substring(0, 4)));
  if (hasPrefix) {
    return {
      name: 'NAICS Match',
      points: 15,
      maxPoints: 25,
      description: `Related NAICS: ${oppNaics}`,
      isPositive: true,
    };
  }

  // Same 2-digit sector
  const oppSector = oppNaics.substring(0, 2);
  const hasSector = userNaics.some(n => n.startsWith(oppSector));
  if (hasSector) {
    return {
      name: 'NAICS Match',
      points: 8,
      maxPoints: 25,
      description: `Same sector: ${oppSector}xx`,
      isPositive: true,
    };
  }

  return {
    name: 'NAICS Match',
    points: 0,
    maxPoints: 25,
    description: `NAICS ${oppNaics} not in your profile`,
    isPositive: false,
  };
}

/**
 * Score set-aside eligibility (0-25 points)
 */
function scoreSetAsideMatch(
  setAside: string | undefined,
  profile: BriefingUserProfile
): WinFactor {
  // No set-aside = full & open competition
  if (!setAside || setAside === 'None' || setAside === 'Full and Open') {
    return {
      name: 'Set-Aside',
      points: 10,
      maxPoints: 25,
      description: 'Full & open competition',
      isPositive: true,
    };
  }

  const userCerts = profile.certifications || [];

  // Check for matching certification
  const requiredCerts = SET_ASIDE_CERT_MAP[setAside] || [];
  const hasCert = userCerts.some(cert => requiredCerts.includes(cert));

  if (hasCert) {
    return {
      name: 'Set-Aside',
      points: 25,
      maxPoints: 25,
      description: `You qualify for ${setAside} set-aside`,
      isPositive: true,
    };
  }

  // Small business set-aside and user has any SB cert
  if (setAside.toLowerCase().includes('small') && userCerts.length > 0) {
    return {
      name: 'Set-Aside',
      points: 15,
      maxPoints: 25,
      description: `${setAside} - you may qualify`,
      isPositive: true,
    };
  }

  return {
    name: 'Set-Aside',
    points: 0,
    maxPoints: 25,
    description: `${setAside} - certification required`,
    isPositive: false,
  };
}

/**
 * Score agency experience (0-15 points)
 */
function scoreAgencyExperience(
  agency: string | undefined,
  profile: BriefingUserProfile
): WinFactor {
  if (!agency) {
    return {
      name: 'Agency Experience',
      points: 5,
      maxPoints: 15,
      description: 'Agency not specified',
      isPositive: true,
    };
  }

  const agencyLower = agency.toLowerCase();

  // Check target agencies (user is actively targeting)
  const targetMatch = profile.targetAgencies.some(a =>
    agencyLower.includes(a.toLowerCase()) || a.toLowerCase().includes(agencyLower)
  );

  if (targetMatch) {
    return {
      name: 'Agency Experience',
      points: 15,
      maxPoints: 15,
      description: `Target agency match`,
      isPositive: true,
    };
  }

  // Check top agencies (learned from behavior)
  const topMatch = profile.topAgencies.some(a =>
    agencyLower.includes(a.toLowerCase()) || a.toLowerCase().includes(agencyLower)
  );

  if (topMatch) {
    return {
      name: 'Agency Experience',
      points: 12,
      maxPoints: 15,
      description: `Agency you follow`,
      isPositive: true,
    };
  }

  return {
    name: 'Agency Experience',
    points: 3,
    maxPoints: 15,
    description: 'New agency for you',
    isPositive: false,
  };
}

/**
 * Score contract size fit (0-15 points)
 */
function scoreContractSizeFit(
  amount: number | undefined,
  profile: BriefingUserProfile
): WinFactor {
  if (!amount || amount === 0) {
    return {
      name: 'Contract Size',
      points: 8,
      maxPoints: 15,
      description: 'Value TBD',
      isPositive: true,
    };
  }

  // Get user's capacity threshold
  const threshold = SIZE_THRESHOLDS[profile.companySize || 'small'] || 25_000_000;

  // Parse max contract size if specified
  let maxSize = threshold;
  if (profile.maxContractSize) {
    const parsed = parseContractSize(profile.maxContractSize);
    if (parsed) maxSize = parsed;
  }

  // Comfortable fit (under 80% of threshold)
  if (amount <= maxSize * 0.8) {
    return {
      name: 'Contract Size',
      points: 15,
      maxPoints: 15,
      description: `${formatCurrency(amount)} - good fit`,
      isPositive: true,
    };
  }

  // Stretch (80-120% of threshold)
  if (amount <= maxSize * 1.2) {
    return {
      name: 'Contract Size',
      points: 10,
      maxPoints: 15,
      description: `${formatCurrency(amount)} - achievable stretch`,
      isPositive: true,
    };
  }

  // Too large (>120% of threshold)
  if (amount <= maxSize * 2) {
    return {
      name: 'Contract Size',
      points: 5,
      maxPoints: 15,
      description: `${formatCurrency(amount)} - may need teaming`,
      isPositive: false,
    };
  }

  return {
    name: 'Contract Size',
    points: 2,
    maxPoints: 15,
    description: `${formatCurrency(amount)} - significantly above capacity`,
    isPositive: false,
  };
}

/**
 * Score capability keyword match (0-10 points)
 */
function scoreCapabilityMatch(
  oppText: string,
  profile: BriefingUserProfile
): WinFactor {
  if (!oppText || oppText.trim().length < 10) {
    return {
      name: 'Capability Match',
      points: 5,
      maxPoints: 10,
      description: 'Limited description available',
      isPositive: true,
    };
  }

  const textLower = oppText.toLowerCase();
  const keywords = [...(profile.capabilityKeywords || []), ...(profile.keywords || [])];

  if (keywords.length === 0) {
    return {
      name: 'Capability Match',
      points: 5,
      maxPoints: 10,
      description: 'Add capabilities to your profile',
      isPositive: false,
    };
  }

  // Count matches
  const matches = keywords.filter(kw => textLower.includes(kw.toLowerCase()));
  const matchRate = matches.length / keywords.length;

  if (matchRate >= 0.5 || matches.length >= 3) {
    return {
      name: 'Capability Match',
      points: 10,
      maxPoints: 10,
      description: `Strong match: ${matches.slice(0, 3).join(', ')}`,
      isPositive: true,
    };
  }

  if (matchRate >= 0.2 || matches.length >= 1) {
    return {
      name: 'Capability Match',
      points: 6,
      maxPoints: 10,
      description: `Partial match: ${matches.slice(0, 2).join(', ')}`,
      isPositive: true,
    };
  }

  return {
    name: 'Capability Match',
    points: 2,
    maxPoints: 10,
    description: 'Limited keyword overlap',
    isPositive: false,
  };
}

/**
 * Score contract vehicle applicability (0-10 points)
 */
function scoreContractVehicle(
  opportunity: OpportunityData,
  profile: BriefingUserProfile
): WinFactor {
  // This is a simplified check - in reality you'd check if the opp
  // requires a specific vehicle and if user holds it
  const vehicles = (profile as unknown as { contractVehicles?: string[] }).contractVehicles || [];

  if (vehicles.length === 0 || vehicles.includes('None')) {
    return {
      name: 'Contract Vehicle',
      points: 3,
      maxPoints: 10,
      description: 'No vehicles listed in profile',
      isPositive: false,
    };
  }

  // Check for GSA Schedule (most common)
  if (vehicles.includes('GSA Schedule')) {
    return {
      name: 'Contract Vehicle',
      points: 8,
      maxPoints: 10,
      description: 'GSA Schedule holder',
      isPositive: true,
    };
  }

  // Has some vehicle
  return {
    name: 'Contract Vehicle',
    points: 6,
    maxPoints: 10,
    description: `Vehicles: ${vehicles.slice(0, 2).join(', ')}`,
    isPositive: true,
  };
}

/**
 * Determine tier from score
 */
function getTier(score: number): WinProbabilityResult['tier'] {
  if (score >= 80) return 'excellent';
  if (score >= 65) return 'good';
  if (score >= 45) return 'moderate';
  if (score >= 25) return 'low';
  return 'poor';
}

/**
 * Generate human-readable summary
 */
function generateSummary(
  score: number,
  factors: WinFactor[],
  profile: BriefingUserProfile
): string {
  const positives = factors.filter(f => f.isPositive && f.points > f.maxPoints * 0.5);
  const negatives = factors.filter(f => !f.isPositive);

  if (score >= 80) {
    return `Excellent fit - ${positives.map(f => f.name.toLowerCase()).join(', ')} align well`;
  }

  if (score >= 65) {
    return `Good opportunity - strong on ${positives.slice(0, 2).map(f => f.name.toLowerCase()).join(', ')}`;
  }

  if (score >= 45) {
    if (negatives.length > 0) {
      return `Moderate fit - consider ${negatives[0].name.toLowerCase()}`;
    }
    return 'Moderate fit - review details carefully';
  }

  if (negatives.length > 0) {
    return `Lower fit - ${negatives[0].description}`;
  }

  return 'Review opportunity details';
}

/**
 * Parse contract size string to number
 */
function parseContractSize(sizeStr: string): number | null {
  if (!sizeStr) return null;

  // Handle ranges like "$1M-$5M"
  const match = sizeStr.match(/\$?([\d.]+)\s*(M|K|B)?/i);
  if (!match) return null;

  let value = parseFloat(match[1]);
  const multiplier = match[2]?.toUpperCase();

  if (multiplier === 'K') value *= 1_000;
  else if (multiplier === 'M') value *= 1_000_000;
  else if (multiplier === 'B') value *= 1_000_000_000;

  return value;
}

/**
 * Format currency for display
 */
function formatCurrency(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

/**
 * Get color for win probability tier
 */
export function getWinProbabilityColor(tier: WinProbabilityResult['tier']): string {
  switch (tier) {
    case 'excellent': return '#22c55e'; // Green
    case 'good': return '#84cc16'; // Lime
    case 'moderate': return '#eab308'; // Yellow
    case 'low': return '#f97316'; // Orange
    case 'poor': return '#ef4444'; // Red
    default: return '#6b7280'; // Gray
  }
}

/**
 * Get emoji for win probability tier
 */
export function getWinProbabilityEmoji(tier: WinProbabilityResult['tier']): string {
  switch (tier) {
    case 'excellent': return '🎯';
    case 'good': return '✅';
    case 'moderate': return '⚡';
    case 'low': return '⚠️';
    case 'poor': return '❌';
    default: return '❓';
  }
}

/**
 * Get badge text for win probability
 */
export function getWinProbabilityBadge(score: number): string {
  if (score >= 80) return `${score}% FIT`;
  if (score >= 65) return `${score}% GOOD`;
  if (score >= 45) return `${score}%`;
  return '';
}

// ============================================================================
// BID TARGET SCORING - Simplified 4-Factor Algorithm for Daily Bid Target
// ============================================================================

export interface BidScoreResult {
  score: number; // 0-100
  tier: 'excellent' | 'good' | 'moderate' | 'low';
  factors: BidFactor[];
}

export interface BidFactor {
  name: string;
  points: number;
  maxPoints: number;
  description: string;
  isPositive: boolean;
}

export interface BidOpportunityData {
  naicsCode?: string;
  setAside?: string;
  amount?: number;
  responseDeadline?: string | Date;
  title?: string;
}

/**
 * Calculate Bid Score - Simplified 4-factor algorithm for Daily Bid Target
 *
 * Factors:
 * 1. NAICS Match (0-30 points) - How well does the work align with your capabilities
 * 2. Accessibility (0-30 points) - How easy is it to compete (micro-purchase, SAP, set-aside)
 * 3. Size Fit (0-20 points) - Is the contract size right for your company
 * 4. Timing (0-20 points) - Is there enough time to prepare a quality bid
 *
 * Total: 100 points
 */
export function calculateBidScore(
  opportunity: BidOpportunityData,
  profile: BriefingUserProfile | null
): BidScoreResult {
  const factors: BidFactor[] = [];
  let totalScore = 0;

  // If no profile, return base score
  if (!profile) {
    return {
      score: 30,
      tier: 'low',
      factors: [{
        name: 'Profile Missing',
        points: 0,
        maxPoints: 100,
        description: 'Complete your profile to get personalized bid scores',
        isPositive: false,
      }],
    };
  }

  // 1. NAICS Match (0-30 points)
  const naicsFactor = scoreBidNaicsMatch(opportunity.naicsCode, profile);
  factors.push(naicsFactor);
  totalScore += naicsFactor.points;

  // 2. Accessibility (0-30 points) - Micro-purchase, SAP, Set-aside
  const accessibilityFactor = scoreBidAccessibility(opportunity.amount, opportunity.setAside, profile);
  factors.push(accessibilityFactor);
  totalScore += accessibilityFactor.points;

  // 3. Size Fit (0-20 points)
  const sizeFactor = scoreBidSizeFit(opportunity.amount, profile);
  factors.push(sizeFactor);
  totalScore += sizeFactor.points;

  // 4. Timing (0-20 points)
  const timingFactor = scoreBidTiming(opportunity.responseDeadline);
  factors.push(timingFactor);
  totalScore += timingFactor.points;

  // Determine tier
  const tier = getBidTier(totalScore);

  return {
    score: totalScore,
    tier,
    factors,
  };
}

/**
 * Score NAICS match for bid scoring (0-30 points)
 */
function scoreBidNaicsMatch(
  oppNaics: string | undefined,
  profile: BriefingUserProfile
): BidFactor {
  if (!oppNaics) {
    return {
      name: 'NAICS Match',
      points: 15,
      maxPoints: 30,
      description: 'No NAICS specified',
      isPositive: true,
    };
  }

  const userNaics = [...profile.naicsCodes, ...profile.topNaics];

  // Exact match = 30 points
  if (userNaics.includes(oppNaics)) {
    return {
      name: 'NAICS Match',
      points: 30,
      maxPoints: 30,
      description: `Exact NAICS match: ${oppNaics}`,
      isPositive: true,
    };
  }

  // Prefix match (4-digit) = 20 points
  const oppPrefix = oppNaics.substring(0, 4);
  const hasPrefix = userNaics.some(n => n.startsWith(oppPrefix) || oppNaics.startsWith(n.substring(0, 4)));
  if (hasPrefix) {
    return {
      name: 'NAICS Match',
      points: 20,
      maxPoints: 30,
      description: `Related NAICS: ${oppNaics}`,
      isPositive: true,
    };
  }

  // Sector match (2-digit) = 10 points
  const oppSector = oppNaics.substring(0, 2);
  const hasSector = userNaics.some(n => n.startsWith(oppSector));
  if (hasSector) {
    return {
      name: 'NAICS Match',
      points: 10,
      maxPoints: 30,
      description: `Same sector: ${oppSector}xx`,
      isPositive: true,
    };
  }

  // No match = 0 points
  return {
    name: 'NAICS Match',
    points: 0,
    maxPoints: 30,
    description: `NAICS ${oppNaics} not in your profile`,
    isPositive: false,
  };
}

/**
 * Score accessibility - how easy is it to compete (0-30 points)
 *
 * This is KEY for SMBs who often start with micro-purchase and SAP to build past performance.
 *
 * - Micro-purchase (<$10K) = 30 pts (easiest entry, minimal competition)
 * - SAP (<$250K) = 25 pts (simplified procedures, faster award)
 * - Set-aside (user qualifies) = 20 pts (limited competition pool)
 * - Full & Open = 10 pts (maximum competition)
 * - Set-aside (user lacks cert) = 5 pts (may not qualify)
 */
function scoreBidAccessibility(
  amount: number | undefined,
  setAside: string | undefined,
  profile: BriefingUserProfile
): BidFactor {
  const MICRO_PURCHASE_THRESHOLD = 10_000; // $10K
  const SAP_THRESHOLD = 250_000; // $250K

  // Micro-purchase: easiest entry point
  if (amount && amount > 0 && amount <= MICRO_PURCHASE_THRESHOLD) {
    return {
      name: 'Accessibility',
      points: 30,
      maxPoints: 30,
      description: `Micro-purchase under $10K — minimal competition`,
      isPositive: true,
    };
  }

  // SAP (Simplified Acquisition Procedures): still favorable
  if (amount && amount > MICRO_PURCHASE_THRESHOLD && amount <= SAP_THRESHOLD) {
    return {
      name: 'Accessibility',
      points: 25,
      maxPoints: 30,
      description: `SAP threshold — simplified procedures`,
      isPositive: true,
    };
  }

  // Check set-aside qualification
  const userCerts = profile.certifications || [];
  const normalizedSetAside = setAside?.toLowerCase() || '';

  // No set-aside = full & open
  if (!setAside || setAside === 'None' || normalizedSetAside.includes('full and open')) {
    return {
      name: 'Accessibility',
      points: 10,
      maxPoints: 30,
      description: 'Full & open — maximum competition',
      isPositive: true,
    };
  }

  // Check if user qualifies for the set-aside
  const requiredCerts = SET_ASIDE_CERT_MAP[setAside] || [];
  const hasCert = userCerts.some(cert => requiredCerts.includes(cert));

  // Also check generic small business eligibility
  const isSmallBiz = setAside.toLowerCase().includes('small');
  const hasSomeCert = userCerts.length > 0;

  if (hasCert || (isSmallBiz && hasSomeCert)) {
    return {
      name: 'Accessibility',
      points: 20,
      maxPoints: 30,
      description: `${setAside} set-aside — you qualify`,
      isPositive: true,
    };
  }

  // User doesn't have the required certification
  return {
    name: 'Accessibility',
    points: 5,
    maxPoints: 30,
    description: `${setAside} — certification required`,
    isPositive: false,
  };
}

/**
 * Score contract size fit (0-20 points)
 */
function scoreBidSizeFit(
  amount: number | undefined,
  profile: BriefingUserProfile
): BidFactor {
  if (!amount || amount === 0) {
    return {
      name: 'Size Fit',
      points: 12,
      maxPoints: 20,
      description: 'Value TBD',
      isPositive: true,
    };
  }

  // Get user's capacity threshold
  const threshold = SIZE_THRESHOLDS[profile.companySize || 'small'] || 25_000_000;

  // Parse max contract size if specified
  let maxSize = threshold;
  if (profile.maxContractSize) {
    const parsed = parseContractSize(profile.maxContractSize);
    if (parsed) maxSize = parsed;
  }

  // Under threshold = good fit
  if (amount <= maxSize) {
    return {
      name: 'Size Fit',
      points: 20,
      maxPoints: 20,
      description: `${formatCurrency(amount)} fits your capacity`,
      isPositive: true,
    };
  }

  // Slightly over = stretch but achievable
  if (amount <= maxSize * 1.5) {
    return {
      name: 'Size Fit',
      points: 15,
      maxPoints: 20,
      description: `${formatCurrency(amount)} — achievable stretch`,
      isPositive: true,
    };
  }

  // Way over = needs teaming
  if (amount <= maxSize * 3) {
    return {
      name: 'Size Fit',
      points: 8,
      maxPoints: 20,
      description: `${formatCurrency(amount)} — may need teaming`,
      isPositive: false,
    };
  }

  // Far beyond capacity
  return {
    name: 'Size Fit',
    points: 3,
    maxPoints: 20,
    description: `${formatCurrency(amount)} — above capacity`,
    isPositive: false,
  };
}

/**
 * Score timing - is there enough time to prepare (0-20 points)
 *
 * Optimal: 7-21 days (enough time but still urgent)
 * Good: 22-45 days (time to prepare)
 * Urgent: <7 days (may be rushed)
 * Far out: >45 days (plan ahead)
 */
function scoreBidTiming(deadline: string | Date | undefined): BidFactor {
  if (!deadline) {
    return {
      name: 'Timing',
      points: 10,
      maxPoints: 20,
      description: 'No deadline specified',
      isPositive: true,
    };
  }

  const deadlineDate = typeof deadline === 'string' ? new Date(deadline) : deadline;
  const today = new Date();
  const daysLeft = Math.ceil((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  // Already passed
  if (daysLeft < 0) {
    return {
      name: 'Timing',
      points: 0,
      maxPoints: 20,
      description: 'Deadline has passed',
      isPositive: false,
    };
  }

  // Too urgent (<7 days)
  if (daysLeft < 7) {
    return {
      name: 'Timing',
      points: 8,
      maxPoints: 20,
      description: `${daysLeft} days left — urgent`,
      isPositive: false,
    };
  }

  // Optimal window (7-21 days)
  if (daysLeft <= 21) {
    return {
      name: 'Timing',
      points: 20,
      maxPoints: 20,
      description: `${daysLeft} days left — optimal timing`,
      isPositive: true,
    };
  }

  // Good (22-45 days)
  if (daysLeft <= 45) {
    return {
      name: 'Timing',
      points: 12,
      maxPoints: 20,
      description: `${daysLeft} days left — good timeline`,
      isPositive: true,
    };
  }

  // Far out (>45 days)
  return {
    name: 'Timing',
    points: 5,
    maxPoints: 20,
    description: `${daysLeft} days out — plan ahead`,
    isPositive: true,
  };
}

/**
 * Determine bid tier from score
 */
function getBidTier(score: number): BidScoreResult['tier'] {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'moderate';
  return 'low';
}

/**
 * Generate "Why You Can Win This" bullet points
 *
 * Returns 3-5 compelling reasons based on scoring factors
 */
export function generateWinReasons(
  opportunity: BidOpportunityData,
  profile: BriefingUserProfile | null,
  bidScore?: BidScoreResult
): string[] {
  const reasons: string[] = [];

  if (!profile) {
    return ['Complete your profile for personalized win analysis'];
  }

  // Calculate score if not provided
  const score = bidScore || calculateBidScore(opportunity, profile);

  // Generate reasons from each positive factor
  for (const factor of score.factors) {
    if (factor.isPositive && factor.points >= factor.maxPoints * 0.5) {
      // Translate factor descriptions to compelling win reasons
      switch (factor.name) {
        case 'NAICS Match':
          if (factor.points === 30) {
            reasons.push(`Exact NAICS match: ${opportunity.naicsCode}`);
          } else if (factor.points >= 20) {
            reasons.push(`Related NAICS to your capabilities`);
          }
          break;

        case 'Accessibility':
          if (factor.description.includes('Micro-purchase')) {
            reasons.push('Micro-purchase under $10K — minimal competition');
          } else if (factor.description.includes('SAP')) {
            reasons.push('SAP threshold — simplified procedures, faster award');
          } else if (factor.description.includes('you qualify')) {
            const setAsideMatch = opportunity.setAside || 'set-aside';
            reasons.push(`${setAsideMatch} — you qualify`);
          }
          break;

        case 'Size Fit':
          if (factor.points >= 15) {
            reasons.push(factor.description.replace(' fits your capacity', ' — no teaming needed'));
          }
          break;

        case 'Timing':
          if (factor.points >= 15) {
            const daysMatch = factor.description.match(/(\d+) days/);
            if (daysMatch) {
              reasons.push(`Closes in ${daysMatch[1]} days — time to prepare quality bid`);
            }
          }
          break;
      }
    }
  }

  // Add opportunity-specific insights
  if (opportunity.setAside && opportunity.setAside !== 'None' && opportunity.setAside !== 'Full and Open') {
    const userCerts = profile.certifications || [];
    const hasMatchingCert = userCerts.some(cert => {
      const required = SET_ASIDE_CERT_MAP[opportunity.setAside || ''] || [];
      return required.includes(cert);
    });
    if (hasMatchingCert && !reasons.some(r => r.includes('qualify'))) {
      reasons.push(`${opportunity.setAside} set-aside — limited competition`);
    }
  }

  // Add a generic positive if we have few reasons
  if (reasons.length < 2) {
    if (score.score >= 60) {
      reasons.push('Strong match for your company profile');
    } else if (score.score >= 40) {
      reasons.push('Good opportunity to build past performance');
    }
  }

  // Limit to 5 reasons
  return reasons.slice(0, 5);
}

/**
 * Generate action steps for the bid target
 *
 * Returns 2-3 specific action items based on timing and opportunity type
 */
export function generateActionSteps(
  opportunity: BidOpportunityData & { agency?: string; samLink?: string },
  profile: BriefingUserProfile | null
): string[] {
  const steps: string[] = [];

  // Calculate days left
  let daysLeft = 14; // default
  if (opportunity.responseDeadline) {
    const deadline = typeof opportunity.responseDeadline === 'string'
      ? new Date(opportunity.responseDeadline)
      : opportunity.responseDeadline;
    daysLeft = Math.ceil((deadline.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  }

  // First step: Always review the solicitation
  if (daysLeft <= 3) {
    steps.push('URGENT: Download and review solicitation documents immediately');
  } else if (daysLeft <= 7) {
    steps.push('Download the RFP/RFQ and review Section C requirements today');
  } else {
    steps.push('Review the solicitation and identify key requirements (30 min)');
  }

  // Second step: Agency contact
  if (opportunity.agency) {
    const agencyShort = opportunity.agency.split('/')[0].trim();
    steps.push(`Research ${agencyShort} OSDBU and identify the contracting officer`);
  } else {
    steps.push('Identify the contracting officer and OSDBU contact');
  }

  // Third step: Based on timing
  if (daysLeft > 14) {
    steps.push('Add to your pipeline tracker and set bid/no-bid review for next week');
  } else if (daysLeft > 7) {
    steps.push('Make bid/no-bid decision by end of day');
  } else {
    steps.push('Begin proposal outline if pursuing');
  }

  return steps;
}

/**
 * Get bid score badge text
 */
export function getBidScoreBadge(score: number): { text: string; color: string } {
  if (score >= 80) {
    return { text: 'EXCELLENT FIT', color: '#10b981' }; // Green
  }
  if (score >= 60) {
    return { text: 'GOOD FIT', color: '#f59e0b' }; // Amber
  }
  if (score >= 40) {
    return { text: 'POSSIBLE FIT', color: '#6b7280' }; // Gray
  }
  return { text: 'REVIEW NEEDED', color: '#6b7280' }; // Gray
}
