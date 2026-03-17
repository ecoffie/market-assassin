/**
 * Recompete Briefing Types
 *
 * Matches Eric's vision for Daily Displacement Intel briefings.
 */

/**
 * A single recompete opportunity with full displacement analysis
 */
export interface RecompeteOpportunity {
  // Core identification
  id: string;
  rank: number;

  // Contract info
  contractName: string;
  agency: string;
  agencyAcronym: string;
  subAgency?: string;

  // Incumbent info
  incumbent: string;
  incumbentYear?: number; // Year of original award

  // Value
  contractValue: string; // Formatted: ">$100M", "~$1.9B", "$50M–$100M"
  contractValueNumeric?: number; // For sorting

  // Timing
  timingSignal: string; // "Solicitation expected May 1, 2026; award in FY26 Q4"
  currentContractExpires?: string;
  solicitationExpected?: string;
  awardExpected?: string;

  // Displacement analysis
  whyVulnerable: string; // The "displacement angle"

  // Set-aside info
  setAsideType?: string;
  vehicleType?: string; // "VETS 2", "GSA MAS", "Alliant 2", etc.

  // Scoring
  displacementScore: number; // 0-100
  priorityScore?: number; // 0-10 for scorecard

  // Sources
  sources: string[]; // "DHS APFS", "SAM.gov", "GovConWire"

  // Action URL
  actionUrl?: string;
}

/**
 * A ghosting/teaming play
 */
export interface TeamingPlay {
  id: string;
  playName: string; // "Cyber outcome swap", "SDVOSB edge"
  targetOpportunityIds: string[]; // References to opportunities #1, #7, etc.
  targetOpportunityNames: string[]; // Human readable

  primesToApproach: string[]; // "CACI, Peraton, Leidos"

  suggestedOpener: string; // Full opener message copy

  theme: string; // Brief theme description
}

/**
 * A content hook for Eric's LinkedIn
 */
export interface ContentHook {
  id: string;
  title: string; // LinkedIn post title
  cta: string; // "Comment 'MAP' and I'll send..."
  ctaKeyword: string; // "MAP", "TRAP", "FLIP"
}

/**
 * Priority scorecard entry
 */
export interface PriorityScorecardEntry {
  opportunityId: string;
  opportunityName: string;
  score: number; // 9.2, 8.9, etc.
  whyNow: string; // "FY26 Q2 award window + infrastructure/security scope"
  immediateAction: string; // "Build incumbent gap matrix..."
}

/**
 * Full recompete briefing (weekly format)
 */
export interface RecompeteBriefing {
  id: string;
  generatedAt: string;
  briefingDate: string;
  timezone: string; // "ET", "EDT"

  // Section 1: Top 10 Opportunities
  opportunities: RecompeteOpportunity[];

  // Section 2: Teaming Plays
  teamingPlays: TeamingPlay[];

  // Section 3: Content Hooks
  contentHooks: ContentHook[];

  // Section 4: Priority Scorecard
  priorityScorecard: PriorityScorecardEntry[];

  // Metadata
  sourcesUsed: string[];
  processingTimeMs: number;

  // Personalization
  userEmail?: string;
  userNaics?: string[];
}

/**
 * Condensed daily briefing format
 */
export interface CondensedBriefing {
  id: string;
  generatedAt: string;
  briefingDate: string;
  timezone: string;

  // One-liner opportunities
  opportunities: Array<{
    name: string;
    value: string;
    incumbent: string;
    displacementAngle: string;
  }>;

  // Brief teaming plays
  teamingPlays: Array<{
    theme: string;
    primes: string[];
    whatYouBring: string;
  }>;

  // Metadata
  userEmail?: string;
}

/**
 * Raw data from various sources before AI enhancement
 */
export interface RawRecompeteData {
  // From USASpending/FPDS
  expiringContracts: Array<{
    piid: string;
    contractNumber?: string;
    agency: string;
    agencyCode: string;
    vendorName: string;
    obligatedAmount: number;
    currentEndDate: string;
    naicsCode: string;
    naicsDescription: string;
    setAsideType?: string;
    placeOfPerformanceState?: string;
  }>;

  // From RSS/Web scraping
  newsItems: Array<{
    title: string;
    url: string;
    source: string;
    publishedDate?: string;
    snippet: string;
  }>;

  // From SAM.gov forecasts
  forecasts: Array<{
    title: string;
    agency: string;
    solicitationDate?: string;
    awardDate?: string;
    estimatedValue?: string;
    setAsideType?: string;
    description: string;
  }>;
}

/**
 * User profile for personalization
 */
export interface RecompeteUserProfile {
  email: string;
  naicsCodes: string[];
  agencies: string[];
  watchedCompanies: string[];
  businessType?: string;
  setAsideTypes?: string[];
}

/**
 * Email template output
 */
export interface RecompeteEmailTemplate {
  subject: string;
  preheader: string;
  htmlBody: string;
  textBody: string;
}
