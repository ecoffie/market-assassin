/**
 * DSBS Profile Scorer — Scoring Engine
 *
 * Self-assessment scoring for Dynamic Small Business Search profiles.
 * 8 sections, weighted scoring, deterministic recommendations.
 */

// ============ TYPES ============

export interface DSBSInput {
  // Section 1: Business Identity (10%)
  hasUEI: boolean;
  hasCAGE: boolean;
  hasWebsite: boolean;
  hasPhysicalAddress: boolean;
  hasDBA: boolean;

  // Section 2: Size & Type (15%)
  hasSizeStandard: boolean;
  isSmallBusiness: boolean;
  designations: string[]; // '8a', 'hubzone', 'wosb', 'edwosb', 'sdvosb'

  // Section 3: NAICS Codes (15%)
  primaryNAICS: string;
  secondaryNAICSCount: number;
  naicsAlignedWithCapabilities: boolean;

  // Section 4: Capabilities Narrative (20%)
  narrativeLength: 'none' | 'short' | 'medium' | 'long' | 'comprehensive';
  mentionsAgencies: boolean;
  mentionsContractVehicles: boolean;
  hasMeasurableResults: boolean;
  hasDifferentiators: boolean;
  mentionsSpecificTech: boolean;

  // Section 5: Past Performance (15%)
  contractCount: number;
  highestContractValue: 'none' | 'under25k' | '25k_150k' | '150k_750k' | '750k_5m' | 'over5m';
  agenciesServed: number;
  mostRecentYear: number;

  // Section 6: Certifications (10%)
  sbaCerts: string[]; // '8a', 'hubzone', 'wosb', 'edwosb', 'sdvosb'
  hasISO: boolean;
  hasCMMI: boolean;
  hasStateCerts: boolean;
  otherCertsCount: number;

  // Section 7: Keywords & Searchability (10%)
  keywordCount: 'none' | 'few' | 'moderate' | 'many';
  hasPSCCodes: boolean;
  hasSICCodes: boolean;

  // Section 8: Contact (5%)
  hasNamedPOC: boolean;
  hasDirectPhone: boolean;
  hasDirectEmail: boolean;
}

export interface SectionScore {
  name: string;
  key: string;
  score: number;
  maxScore: number;
  percentage: number;
  recommendations: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export type ScoreTier = 'elite' | 'strong' | 'developing' | 'needs_work';

export interface CrossSellItem {
  product: string;
  price: string;
  reason: string;
  url: string;
}

export interface DSBSScoreResult {
  overallScore: number;
  tier: ScoreTier;
  tierLabel: string;
  sections: SectionScore[];
  topRecommendations: string[];
  crossSells: CrossSellItem[];
}

// ============ SCORING ============

function scoreTier(score: number): { tier: ScoreTier; label: string } {
  if (score >= 85) return { tier: 'elite', label: 'Elite Profile' };
  if (score >= 70) return { tier: 'strong', label: 'Strong Profile' };
  if (score >= 50) return { tier: 'developing', label: 'Developing Profile' };
  return { tier: 'needs_work', label: 'Needs Work' };
}

function scoreBusinessIdentity(input: DSBSInput): SectionScore {
  let score = 0;
  const recs: string[] = [];

  if (input.hasUEI) score += 3; else recs.push('Register for a UEI (Unique Entity Identifier) — required for all federal contracting');
  if (input.hasCAGE) score += 2; else recs.push('Obtain a CAGE code — needed for DoD contracts and subcontracting');
  if (input.hasWebsite) score += 2; else recs.push('Add your company website — agencies verify credibility through your web presence');
  if (input.hasPhysicalAddress) score += 2; else recs.push('List your physical business address — remote-only businesses score lower with some agencies');
  if (input.hasDBA) score += 1; else recs.push('Add your DBA (Doing Business As) name if applicable');

  const maxScore = 10;
  return {
    name: 'Business Identity',
    key: 'identity',
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    recommendations: recs,
    priority: score < 5 ? 'critical' : score < 8 ? 'medium' : 'low',
  };
}

function scoreSizeAndType(input: DSBSInput): SectionScore {
  let score = 0;
  const recs: string[] = [];

  if (input.hasSizeStandard) score += 3; else recs.push('Declare your SBA size standard — this determines your eligibility for set-aside contracts');
  if (input.isSmallBusiness) score += 2; else score += 1;

  // Designations (up to 10 points for multiple)
  const designationPoints = Math.min(input.designations.length * 2, 10);
  score += designationPoints;

  if (input.designations.length === 0) {
    recs.push('Apply for socioeconomic designations (8(a), HUBZone, WOSB, SDVOSB) — set-aside contracts are the fastest path to wins');
  } else if (input.designations.length < 2) {
    recs.push('Consider pursuing additional certifications — multiple designations open more set-aside opportunities');
  }

  const maxScore = 15;
  score = Math.min(score, maxScore);
  return {
    name: 'Business Size & Type',
    key: 'size_type',
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    recommendations: recs,
    priority: score < 5 ? 'critical' : score < 10 ? 'high' : 'low',
  };
}

function scoreNAICS(input: DSBSInput): SectionScore {
  let score = 0;
  const recs: string[] = [];

  if (input.primaryNAICS) score += 5; else recs.push('Set a primary NAICS code — this is how agencies find you in DSBS searches');

  // Secondary NAICS
  if (input.secondaryNAICSCount >= 5) score += 5;
  else if (input.secondaryNAICSCount >= 3) score += 3;
  else if (input.secondaryNAICSCount >= 1) score += 2;
  else recs.push('Add secondary NAICS codes — agencies search by NAICS and more codes means more visibility');

  if (input.secondaryNAICSCount < 5) {
    recs.push('Add at least 5 secondary NAICS codes that reflect your full capabilities');
  }

  if (input.naicsAlignedWithCapabilities) score += 5; else recs.push('Ensure your NAICS codes align with your capabilities narrative — mismatches confuse buyers');

  const maxScore = 15;
  return {
    name: 'NAICS Codes',
    key: 'naics',
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    recommendations: recs,
    priority: score < 5 ? 'critical' : score < 10 ? 'high' : 'medium',
  };
}

function scoreCapabilities(input: DSBSInput): SectionScore {
  let score = 0;
  const recs: string[] = [];

  // Narrative length
  switch (input.narrativeLength) {
    case 'comprehensive': score += 8; break;
    case 'long': score += 6; break;
    case 'medium': score += 4; break;
    case 'short': score += 2; break;
    default: recs.push('Write a capabilities narrative — this is the single most important field in your DSBS profile'); break;
  }

  if (input.narrativeLength !== 'none' && input.narrativeLength !== 'comprehensive') {
    recs.push('Expand your capabilities narrative to 500+ words with specific details about your experience');
  }

  if (input.mentionsAgencies) score += 3; else recs.push('Name specific agencies you have worked with or want to serve');
  if (input.mentionsContractVehicles) score += 3; else recs.push('Mention contract vehicles you hold (GSA Schedule, SEWP, BPAs) — buyers search for these');
  if (input.hasMeasurableResults) score += 3; else recs.push('Add measurable results ($ saved, % improved, projects completed) to prove your value');
  if (input.hasDifferentiators) score += 2; else recs.push('State what makes you different from competitors — unique methods, technologies, or experience');
  if (input.mentionsSpecificTech) score += 1; else recs.push('Mention specific technologies, tools, or methodologies you use');

  const maxScore = 20;
  score = Math.min(score, maxScore);
  return {
    name: 'Capabilities Narrative',
    key: 'capabilities',
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    recommendations: recs,
    priority: score < 8 ? 'critical' : score < 14 ? 'high' : 'medium',
  };
}

function scorePastPerformance(input: DSBSInput): SectionScore {
  let score = 0;
  const recs: string[] = [];

  // Contract count
  if (input.contractCount >= 10) score += 4;
  else if (input.contractCount >= 5) score += 3;
  else if (input.contractCount >= 1) score += 2;
  else recs.push('List at least one federal contract or subcontract — even small wins count');

  if (input.contractCount < 5) {
    recs.push('Pursue micro-purchases (under $10K) and SAT contracts (under $250K) to build your past performance record');
  }

  // Highest contract value
  switch (input.highestContractValue) {
    case 'over5m': score += 4; break;
    case '750k_5m': score += 3; break;
    case '150k_750k': score += 3; break;
    case '25k_150k': score += 2; break;
    case 'under25k': score += 1; break;
    default: break;
  }

  // Agency diversity
  if (input.agenciesServed >= 3) score += 4;
  else if (input.agenciesServed >= 2) score += 2;
  else if (input.agenciesServed >= 1) score += 1;
  else recs.push('Diversify across agencies — serving multiple agencies shows broader capability');

  // Recency
  const currentYear = new Date().getFullYear();
  if (input.mostRecentYear >= currentYear - 1) score += 3;
  else if (input.mostRecentYear >= currentYear - 3) score += 2;
  else if (input.mostRecentYear > 0) {
    score += 1;
    recs.push('Your most recent contract is over 3 years old — actively pursue new work to keep your profile current');
  }

  const maxScore = 15;
  score = Math.min(score, maxScore);
  return {
    name: 'Past Performance',
    key: 'performance',
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    recommendations: recs,
    priority: score < 5 ? 'critical' : score < 10 ? 'high' : 'medium',
  };
}

function scoreCertifications(input: DSBSInput): SectionScore {
  let score = 0;
  const recs: string[] = [];

  // SBA certs
  const sbaCertPoints = Math.min(input.sbaCerts.length * 2, 4);
  score += sbaCertPoints;
  if (input.sbaCerts.length === 0) {
    recs.push('Pursue SBA certifications — 8(a), HUBZone, WOSB, or SDVOSB programs give you access to set-aside contracts');
  }

  if (input.hasISO) score += 2; else recs.push('Consider ISO certification (9001, 27001) — many agencies require or prefer ISO-certified contractors');
  if (input.hasCMMI) score += 2; else if (input.primaryNAICS?.startsWith('541')) recs.push('Consider CMMI certification if you do IT/engineering — it signals process maturity');
  if (input.hasStateCerts) score += 1;

  const otherPoints = Math.min(input.otherCertsCount, 1);
  score += otherPoints;

  const maxScore = 10;
  score = Math.min(score, maxScore);
  return {
    name: 'Certifications',
    key: 'certifications',
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    recommendations: recs,
    priority: score < 3 ? 'high' : score < 6 ? 'medium' : 'low',
  };
}

function scoreKeywords(input: DSBSInput): SectionScore {
  let score = 0;
  const recs: string[] = [];

  switch (input.keywordCount) {
    case 'many': score += 6; break;
    case 'moderate': score += 4; break;
    case 'few': score += 2; break;
    default: recs.push('Add keywords to your profile — agencies search DSBS by keyword, and no keywords means you are invisible'); break;
  }

  if (input.keywordCount !== 'many') {
    recs.push('Add 15+ keywords covering your services, technologies, industries, and agency-specific terms');
  }

  if (input.hasPSCCodes) score += 2; else recs.push('Add PSC (Product Service Codes) — these map directly to how agencies categorize procurements');
  if (input.hasSICCodes) score += 2; else recs.push('Add SIC codes for broader searchability');

  const maxScore = 10;
  return {
    name: 'Keywords & Searchability',
    key: 'keywords',
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    recommendations: recs,
    priority: score < 4 ? 'high' : score < 7 ? 'medium' : 'low',
  };
}

function scoreContact(input: DSBSInput): SectionScore {
  let score = 0;
  const recs: string[] = [];

  if (input.hasNamedPOC) score += 2; else recs.push('Add a named point of contact — agencies want to reach a real person, not a generic inbox');
  if (input.hasDirectPhone) score += 1.5; else recs.push('Add a direct phone number — some contracting officers prefer calling over email');
  if (input.hasDirectEmail) score += 1.5; else recs.push('Add a direct email address (not info@ or contact@)');

  const maxScore = 5;
  return {
    name: 'Contact Info',
    key: 'contact',
    score: Math.round(score * 10) / 10,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    recommendations: recs,
    priority: score < 2 ? 'high' : score < 4 ? 'medium' : 'low',
  };
}

// ============ CROSS-SELL ============

function getCrossSells(sections: SectionScore[], overallScore: number): CrossSellItem[] {
  const sells: CrossSellItem[] = [];

  const capSection = sections.find(s => s.key === 'capabilities');
  if (capSection && capSection.percentage < 60) {
    sells.push({
      product: 'Content Reaper',
      price: '$197',
      reason: 'AI-generate your DSBS narrative, capability statement, and LinkedIn posts that attract federal buyers',
      url: '/content-generator',
    });
  }

  const perfSection = sections.find(s => s.key === 'performance');
  const naicsSection = sections.find(s => s.key === 'naics');
  if ((perfSection && perfSection.percentage < 50) || (naicsSection && naicsSection.percentage < 60)) {
    sells.push({
      product: 'Market Assassin',
      price: 'from $297',
      reason: 'Discover which agencies spend the most in your NAICS and get strategic reports to target the right buyers',
      url: '/market-assassin',
    });
  }

  if (naicsSection && naicsSection.percentage < 70) {
    sells.push({
      product: 'Opportunity Hunter',
      price: 'Free',
      reason: 'See which agencies are actively buying in your NAICS codes right now',
      url: '/opportunity-hunter',
    });
  }

  sells.push({
    product: 'Contractor Database',
    price: '$497',
    reason: 'Get full profiles on 3,500+ federal prime contractors — find teaming partners and study your competition',
    url: '/contractor-database',
  });

  if (overallScore < 50) {
    sells.push({
      product: 'Pro Giant Bundle',
      price: '$997',
      reason: 'Get the complete GovCon toolkit: Market Assassin + Content Reaper + Contractor Database + Daily Briefings',
      url: '/bundles/pro-giant',
    });
  }

  return sells.slice(0, 3);
}

// ============ MAIN SCORER ============

export function calculateDSBSScore(input: DSBSInput): DSBSScoreResult {
  const sections: SectionScore[] = [
    scoreBusinessIdentity(input),
    scoreSizeAndType(input),
    scoreNAICS(input),
    scoreCapabilities(input),
    scorePastPerformance(input),
    scoreCertifications(input),
    scoreKeywords(input),
    scoreContact(input),
  ];

  const overallScore = Math.round(
    sections.reduce((sum, s) => sum + s.score, 0)
  );

  const { tier, label } = scoreTier(overallScore);

  // Collect top recommendations sorted by section priority
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const allRecs = sections
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
    .flatMap(s => s.recommendations);

  // Re-sort sections by original order
  const sectionOrder = ['identity', 'size_type', 'naics', 'capabilities', 'performance', 'certifications', 'keywords', 'contact'];
  sections.sort((a, b) => sectionOrder.indexOf(a.key) - sectionOrder.indexOf(b.key));

  return {
    overallScore,
    tier,
    tierLabel: label,
    sections,
    topRecommendations: allRecs.slice(0, 5),
    crossSells: getCrossSells(sections, overallScore),
  };
}
