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
