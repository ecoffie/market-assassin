/**
 * AI Generator for Recompete Briefings
 *
 * Uses Groq API to generate displacement analysis, teaming plays,
 * and content hooks in Eric's voice and style.
 */

import {
  RecompeteOpportunity,
  TeamingPlay,
  ContentHook,
  PriorityScorecardEntry,
  RawRecompeteData,
  RecompeteUserProfile,
} from './types';
import { getAgencyAcronym, formatContractValue } from './data-aggregator';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Generate displacement analysis for a contract
 */
async function generateDisplacementAngle(
  contract: RawRecompeteData['expiringContracts'][0],
  newsContext: string[]
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return getDefaultDisplacementAngle(contract);
  }

  const prompt = `You are a GovCon capture strategist. Generate a brief "displacement angle" explaining why this federal contract incumbent is vulnerable to being replaced.

Contract details:
- Agency: ${contract.agency}
- Incumbent: ${contract.vendorName}
- Value: ${formatContractValue(contract.obligatedAmount)}
- NAICS: ${contract.naicsCode} (${contract.naicsDescription})
- Set-aside: ${contract.setAsideType || 'Full & Open'}
- Contract ending: ${contract.currentEndDate}

Recent news context:
${newsContext.slice(0, 3).join('\n')}

Write ONE sentence (max 40 words) explaining why this incumbent is vulnerable. Use insider GovCon language like:
- "displacement angle"
- "transition risk"
- "incumbent fatigue"
- "measurable outcomes"
- "SOC modernization"
- "automation-led"
- "KPI-based"

Examples of good displacement angles:
- "Cyber outcomes are measurable (MTTD/MTTR, vuln closure), making 'better SOC performance + cost' a strong displacement wedge."
- "Labor-heavy field ops + distributed execution risk across many sites creates service-level exposure for a focused challenger team."
- "Platform concentration risk + integration dependencies create openings for modular data/interop alternatives."

Return ONLY the displacement angle text, nothing else.`;

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 100,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`[AI] Groq error: ${response.status}`);
      return getDefaultDisplacementAngle(contract);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content?.trim() || getDefaultDisplacementAngle(contract);
  } catch (error) {
    console.error('[AI] Error generating displacement angle:', error);
    return getDefaultDisplacementAngle(contract);
  }
}

/**
 * Default displacement angle when AI is unavailable
 */
function getDefaultDisplacementAngle(contract: RawRecompeteData['expiringContracts'][0]): string {
  const naicsPrefix = contract.naicsCode.substring(0, 3);

  // NAICS-based defaults
  const anglesByNaics: Record<string, string[]> = {
    '541': [
      'Professional services scope vulnerable to outcome-based challenger with measurable delivery metrics.',
      'Advisory-heavy scope often breakable by teams with concrete implementation + transformation outcomes.',
      'IT modernization scope rewards challengers with faster deployment velocity and security hardening.',
    ],
    '518': [
      'Cloud migration scope favors vendors with AIOps + zero-trust outcomes over legacy O&M narratives.',
      'Data center modernization creates opening for consumption-based delivery models.',
    ],
    '561': [
      'Labor-intensive support scope vulnerable to automation-led cost takeout strategy.',
      'High-volume service delivery exposed on quality metrics and throughput optimization.',
    ],
    '236': [
      'Construction management scope vulnerable to schedule recovery and risk governance challengers.',
      'Project delivery pressure creates opening for teams with strong performance-based SLA track record.',
    ],
  };

  const angles = anglesByNaics[naicsPrefix] || [
    'Long-running incumbent program exposed to transition risk and performance reset pressure.',
    'Contract scope creates openings for challengers with measurable outcomes and faster delivery.',
    'Recompete window favors teams with concrete modernization narrative and transition readiness.',
  ];

  return angles[Math.floor(Math.random() * angles.length)];
}

/**
 * Generate timing signal text
 */
function generateTimingSignal(contract: RawRecompeteData['expiringContracts'][0]): string {
  const endDate = new Date(contract.currentEndDate);
  const now = new Date();
  const daysUntil = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const monthsUntil = Math.ceil(daysUntil / 30);

  // Calculate expected FY quarter
  const expectedAwardDate = new Date(endDate);
  expectedAwardDate.setMonth(expectedAwardDate.getMonth() - 3); // Award typically 3 months before end

  const fy = expectedAwardDate.getMonth() >= 9 ? expectedAwardDate.getFullYear() + 1 : expectedAwardDate.getFullYear();
  const fyQuarter = Math.ceil(((expectedAwardDate.getMonth() + 3) % 12 + 1) / 3);

  // Format month
  const solicitationDate = new Date(endDate);
  solicitationDate.setMonth(solicitationDate.getMonth() - 6);
  const solMonth = solicitationDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  if (daysUntil < 90) {
    return `Current contract expires ${endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}; solicitation likely imminent; award in FY${String(fy).slice(2)} Q${fyQuarter}`;
  } else if (daysUntil < 180) {
    return `Solicitation expected ${solMonth}; award targeted FY${String(fy).slice(2)} Q${fyQuarter}; current deal expires ${endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
  } else if (daysUntil < 365) {
    return `Recompete planning active; solicitation expected by ${solMonth}; award projected FY${String(fy).slice(2)} Q${fyQuarter}`;
  } else {
    return `Long-term capture window; contract ends ${endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}; early positioning phase`;
  }
}

/**
 * Generate teaming plays from opportunities
 */
async function generateTeamingPlays(
  opportunities: RecompeteOpportunity[]
): Promise<TeamingPlay[]> {
  const apiKey = process.env.GROQ_API_KEY;

  // Group opportunities by theme
  const cyberOpps = opportunities.filter(o =>
    o.contractName.toLowerCase().includes('cyber') ||
    o.whyVulnerable.toLowerCase().includes('soc') ||
    o.whyVulnerable.toLowerCase().includes('security')
  );

  const itModernizationOpps = opportunities.filter(o =>
    o.contractName.toLowerCase().includes('it') ||
    o.contractName.toLowerCase().includes('modernization') ||
    o.whyVulnerable.toLowerCase().includes('modernization')
  );

  const setAsideOpps = opportunities.filter(o =>
    o.setAsideType && (
      o.setAsideType.includes('SDVOSB') ||
      o.setAsideType.includes('8(a)') ||
      o.setAsideType.includes('HUBZone')
    )
  );

  const plays: TeamingPlay[] = [];

  // Play A: Cyber cluster
  if (cyberOpps.length > 0) {
    const primes = ['SAIC', 'Booz Allen', 'ManTech', 'Leidos', 'Peraton'];
    plays.push({
      id: 'play-cyber',
      playName: 'Cyber outcome swap',
      targetOpportunityIds: cyberOpps.slice(0, 2).map(o => o.id),
      targetOpportunityNames: cyberOpps.slice(0, 2).map(o => o.contractName),
      primesToApproach: primes.slice(0, 4),
      suggestedOpener: `"We're tracking the ${cyberOpps[0]?.agency || 'DHS'} cyber recompetes and can help you improve P(win) on measurable SOC outcomes, not just labor mix. We can bring a 2-week displacement brief mapping likely incumbent weak points and a transition-safe staffing wedge. Open to a quick fit call this week?"`,
      theme: 'Help primes strengthen measurable SOC outcomes and transition confidence.',
    });
  }

  // Play B: IT Modernization
  if (itModernizationOpps.length > 0) {
    const primes = ['GDIT', 'Accenture Federal', 'CGI Federal', 'Guidehouse', 'Peraton'];
    plays.push({
      id: 'play-it-mod',
      playName: 'Mission-ops + modernization surge',
      targetOpportunityIds: itModernizationOpps.slice(0, 3).map(o => o.id),
      targetOpportunityNames: itModernizationOpps.slice(0, 3).map(o => o.contractName),
      primesToApproach: primes.slice(0, 4),
      suggestedOpener: `"We specialize in mixed legacy/cloud operating environments where SLA misses happen during scale events. We can plug in as a surgical subcontractor focused on stability + cycle-time reduction without disrupting your prime delivery model. Worth a 30-minute whiteboard this week?"`,
      theme: 'Support primes with transition architecture and delivery velocity.',
    });
  }

  // Play C: Set-aside leverage
  if (setAsideOpps.length > 0) {
    const primes = ['VETS 2 holders', 'PACTS III SB primes', 'CIO-SP3 SB positioned firms'];
    plays.push({
      id: 'play-setaside',
      playName: 'Set-aside execution play',
      targetOpportunityIds: setAsideOpps.slice(0, 2).map(o => o.id),
      targetOpportunityNames: setAsideOpps.slice(0, 2).map(o => o.contractName),
      primesToApproach: primes,
      suggestedOpener: `"You have vehicle access; we bring a displacement-ready technical narrative and rapid proposal support. Let's build a 'lower risk with measurable outcomes' story before amendment season tightens. Open to a quick teaming discussion?"`,
      theme: 'Combine set-aside alignment with low-friction transition artifacts.',
    });
  }

  // If we don't have themed plays, create generic ones
  if (plays.length === 0 && opportunities.length > 0) {
    const topThree = opportunities.slice(0, 3);
    plays.push({
      id: 'play-generic',
      playName: 'Displacement rapid-response',
      targetOpportunityIds: topThree.map(o => o.id),
      targetOpportunityNames: topThree.map(o => o.contractName),
      primesToApproach: ['Leidos', 'CACI', 'Peraton', 'Booz Allen'],
      suggestedOpener: `"We built a rapid-response pursuit cell that turns forecast signals into partner-ready capture actions in 10 business days. If you're deciding where to bid/no-bid on ${new Date().getFullYear()} recompetes, we can show where displacement odds are highest. Interested in a quick capture-fit diagnostic?"`,
      theme: 'Rapid pursuit support for high-value recompetes.',
    });
  }

  return plays.slice(0, 3);
}

/**
 * Generate content hooks for Eric's LinkedIn
 */
async function generateContentHooks(
  opportunities: RecompeteOpportunity[]
): Promise<ContentHook[]> {
  const hooks: ContentHook[] = [];

  // Calculate total value
  const totalValue = opportunities.reduce((sum, o) => sum + (o.contractValueNumeric || 0), 0);
  const totalValueStr = formatContractValue(totalValue);

  // Get unique agencies
  const agencies = [...new Set(opportunities.map(o => o.agencyAcronym))];
  const topAgency = agencies[0] || 'Federal';

  // Hook 1: Dollar value hook
  hooks.push({
    id: 'hook-value',
    title: `${totalValueStr}+ in Recompetes Opening in the Next 120 Days (And Who's Actually Vulnerable)`,
    cta: `Comment 'MAP' and I'll send the quick-score worksheet + training on displacement capture in 30 minutes/day.`,
    ctaKeyword: 'MAP',
  });

  // Hook 2: Incumbent trap hook
  hooks.push({
    id: 'hook-trap',
    title: `The Incumbent Trap: Why Long-Running ${topAgency} Programs Lose at Recompete`,
    cta: `DM 'TRAP' for Eric's transition-risk checklist and a short masterclass on replacing incumbents without protest drama.`,
    ctaKeyword: 'TRAP',
  });

  // Hook 3: Timing hook
  const quarterNow = Math.ceil((new Date().getMonth() + 1) / 3);
  hooks.push({
    id: 'hook-timing',
    title: `Top ${opportunities.length} ${topAgency} Recompetes to Watch Before Q${quarterNow + 1} (Timing + Vulnerability Breakdown)`,
    cta: `Reply 'TRACKER' and I'll send the weekly displacement watchlist + pursuit triggers.`,
    ctaKeyword: 'TRACKER',
  });

  return hooks;
}

/**
 * Generate priority scorecard
 */
function generatePriorityScorecard(
  opportunities: RecompeteOpportunity[]
): PriorityScorecardEntry[] {
  // Sort by displacement score, take top 3
  const sorted = [...opportunities].sort((a, b) => b.displacementScore - a.displacementScore);

  return sorted.slice(0, 3).map((opp, idx) => {
    // Generate score between 8.5 and 9.5 based on displacement score
    const score = 8.5 + (opp.displacementScore / 100) * 1.0;

    // Generate "why now" based on timing
    const whyNow = `${opp.timingSignal.split(';')[0]}; ${opp.whyVulnerable.split('.')[0].substring(0, 60)}`;

    // Generate immediate action
    const actions = [
      'Build incumbent gap matrix and transition-risk narrative now.',
      'Prepare pricing pressure + modernization counter-positioning.',
      'Lock teaming around technical differentiators and O&M efficiency.',
      'Map incumbent weak points and draft displacement storyline.',
      'Identify subcontracting lanes and begin prime outreach.',
    ];

    return {
      opportunityId: opp.id,
      opportunityName: opp.contractName,
      score: Math.round(score * 10) / 10,
      whyNow,
      immediateAction: actions[idx % actions.length],
    };
  });
}

/**
 * Transform raw data into ranked opportunities with AI-generated content
 */
export async function transformToOpportunities(
  rawData: RawRecompeteData,
  profile: RecompeteUserProfile
): Promise<RecompeteOpportunity[]> {
  const opportunities: RecompeteOpportunity[] = [];

  // Get news snippets for context
  const newsSnippets = rawData.newsItems.map(n => `${n.title}: ${n.snippet}`);

  // Process each contract
  for (let i = 0; i < Math.min(rawData.expiringContracts.length, 15); i++) {
    const contract = rawData.expiringContracts[i];

    // Generate displacement angle (AI or default)
    const whyVulnerable = await generateDisplacementAngle(contract, newsSnippets);

    // Calculate displacement score
    let displacementScore = 50; // Base score

    // NAICS match bonus
    if (profile.naicsCodes.some(n => contract.naicsCode.startsWith(n) || n.startsWith(contract.naicsCode))) {
      displacementScore += 20;
    }

    // Value bonus
    if (contract.obligatedAmount > 100_000_000) displacementScore += 15;
    else if (contract.obligatedAmount > 50_000_000) displacementScore += 10;
    else if (contract.obligatedAmount > 10_000_000) displacementScore += 5;

    // Set-aside bonus
    if (contract.setAsideType) displacementScore += 10;

    // Watched competitor bonus
    if (profile.watchedCompanies.some(c => contract.vendorName.toLowerCase().includes(c.toLowerCase()))) {
      displacementScore += 15;
    }

    opportunities.push({
      id: `opp-${i + 1}`,
      rank: i + 1,
      contractName: generateContractName(contract),
      agency: contract.agency,
      agencyAcronym: getAgencyAcronym(contract.agency),
      incumbent: contract.vendorName,
      contractValue: formatContractValue(contract.obligatedAmount),
      contractValueNumeric: contract.obligatedAmount,
      timingSignal: generateTimingSignal(contract),
      currentContractExpires: contract.currentEndDate,
      whyVulnerable,
      setAsideType: contract.setAsideType || undefined,
      displacementScore: Math.min(displacementScore, 100),
      sources: ['USASpending', 'GovConWire', 'SAM.gov'],
      actionUrl: `https://www.usaspending.gov/search/?hash=${encodeURIComponent(contract.piid)}`,
    });
  }

  // Sort by displacement score
  opportunities.sort((a, b) => b.displacementScore - a.displacementScore);

  // Re-rank after sorting
  opportunities.forEach((opp, idx) => {
    opp.rank = idx + 1;
    opp.id = `opp-${idx + 1}`;
  });

  return opportunities.slice(0, 10);
}

/**
 * Generate a descriptive contract name
 */
function generateContractName(contract: RawRecompeteData['expiringContracts'][0]): string {
  const agency = getAgencyAcronym(contract.agency);
  const naicsDesc = contract.naicsDescription || '';

  // Common patterns
  if (naicsDesc.toLowerCase().includes('computer')) {
    return `${agency} IT Services Support`;
  }
  if (naicsDesc.toLowerCase().includes('engineering')) {
    return `${agency} Engineering & Technical Services`;
  }
  if (naicsDesc.toLowerCase().includes('consulting') || naicsDesc.toLowerCase().includes('management')) {
    return `${agency} Program Management Support`;
  }
  if (naicsDesc.toLowerCase().includes('security')) {
    return `${agency} Cyber Security Operations`;
  }
  if (naicsDesc.toLowerCase().includes('facilities')) {
    return `${agency} Facilities Support Services`;
  }

  // Default: use NAICS description
  return `${agency} ${naicsDesc.split(',')[0] || 'Support Services'}`;
}

export {
  generateDisplacementAngle,
  generateTimingSignal,
  generateTeamingPlays,
  generateContentHooks,
  generatePriorityScorecard,
};
