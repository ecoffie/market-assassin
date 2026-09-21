/**
 * Market Assassin Briefing Types
 *
 * Intelligence briefing for MA users focused on:
 * - Agency budget shifts and spending trends
 * - Pain point updates from oversight reports
 * - Competitor activity in their NAICS
 * - Capture signals (pre-solicitation, forecasts)
 */

/**
 * Budget shift alert
 */
export interface BudgetShift {
  id: string;
  agency: string;
  agencyAcronym: string;
  shiftType: 'increase' | 'decrease' | 'reallocation' | 'supplemental' | 'cr_impact';
  amount: string; // "$500M increase", "-12% YoY"
  amountNumeric?: number;
  description: string;
  source: string; // "FY26 Budget Request", "Continuing Resolution", "Supplemental"
  impactOnUser: string; // How this affects the user's target market
  relevantNaics?: string[];
  actionUrl?: string;
}

/**
 * Pain point update from oversight
 */
export interface PainPointUpdate {
  id: string;
  agency: string;
  agencyAcronym: string;
  painPoint: string;
  updateType: 'new' | 'escalated' | 'resolved' | 'mentioned';
  source: string; // "GAO-26-123", "DHS OIG Report", "Congressional Hearing"
  sourceDate: string;
  summary: string;
  opportunityAngle: string; // How to position against this pain point
  relevantCapabilities: string[];
  actionUrl?: string;
}

/**
 * Competitor activity
 */
export interface CompetitorActivity {
  id: string;
  companyName: string;
  activityType: 'award' | 'protest' | 'acquisition' | 'partnership' | 'layoff' | 'expansion';
  description: string;
  amount?: string;
  agency?: string;
  naicsCode?: string;
  date: string;
  implication: string; // What this means for the user
  source: string;
  actionUrl?: string;
}

/**
 * Capture signal (pre-solicitation, forecast, sources sought)
 */
export interface CaptureSignal {
  id: string;
  signalType: 'forecast' | 'sources_sought' | 'pre_solicitation' | 'rfi' | 'draft_rfp' | 'market_research';
  title: string;
  agency: string;
  agencyAcronym: string;
  estimatedValue?: string;
  estimatedValueNumeric?: number;
  naicsCode?: string;
  setAsideType?: string;
  responseDeadline?: string;
  solicitationExpected?: string;
  description: string;
  fitScore: number; // 0-100 based on user profile match
  actionRequired: string;
  actionUrl?: string;
  source: string; // "SAM.gov", "Acquisition Gateway", "Agency Forecast"
}

/**
 * Full MA Briefing
 */
export interface MABriefing {
  id: string;
  generatedAt: string;
  briefingDate: string;
  timezone: string;

  // Section 1: Budget & Spending Shifts
  budgetShifts: BudgetShift[];

  // Section 2: Pain Point Updates
  painPointUpdates: PainPointUpdate[];

  // Section 3: Competitor Activity
  competitorActivity: CompetitorActivity[];

  // Section 4: Capture Signals
  captureSignals: CaptureSignal[];

  // Summary stats
  summary: {
    totalAlerts: number;
    urgentItems: number;
    newOpportunities: number;
    agenciesCovered: string[];
  };

  // Metadata
  sourcesUsed: string[];
  processingTimeMs: number;
  userEmail?: string;
  userNaics?: string[];
  userAgencies?: string[];
}

/**
 * Condensed MA Briefing (daily quick version)
 */
export interface CondensedMABriefing {
  id: string;
  generatedAt: string;
  briefingDate: string;
  timezone: string;

  // Quick hits
  topBudgetShift: { agency: string; summary: string } | null;
  topPainPoint: { agency: string; summary: string } | null;
  topCompetitorMove: { company: string; summary: string } | null;
  topCaptureSignal: { title: string; agency: string; deadline?: string } | null;

  // Counts
  newSignalsCount: number;
  competitorMovesCount: number;

  userEmail?: string;
}

/**
 * User profile for MA briefing personalization
 */
export interface MAUserProfile {
  email: string;
  naicsCodes: string[];
  targetAgencies: string[];
  watchedCompetitors: string[];
  capabilities: string[];
  setAsideTypes: string[];
  hasMAAccess: boolean;
  maTier: 'standard' | 'premium';
}

/**
 * Email template output
 */
export interface MAEmailTemplate {
  subject: string;
  preheader: string;
  htmlBody: string;
  textBody: string;
}
