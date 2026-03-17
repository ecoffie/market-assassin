/**
 * Contractor DB Briefing Types
 *
 * Daily briefing on:
 * - Top teaming opportunities (contractors matching user's NAICS)
 * - SBLO contact updates
 * - New subcontracting plans
 * - Partnership signals from RSS
 */

// Full briefing structure
export interface ContractorDBBriefing {
  id: string;
  generatedAt: string;
  briefingDate: string;
  timezone: string;

  // Sections
  teamingOpportunities: TeamingOpportunity[];
  sbloUpdates: SBLOUpdate[];
  newSubcontractingPlans: SubcontractingPlan[];
  partnershipSignals: PartnershipSignal[];

  // Summary
  summary: {
    totalOpportunities: number;
    newSbloContacts: number;
    newSubkPlans: number;
    partnershipSignals: number;
    naicsesCovered: string[];
  };

  // Meta
  sourcesUsed: string[];
  processingTimeMs: number;
  userEmail: string;
  userNaics: string[];
}

// Condensed version for daily email
export interface CondensedContractorDBBriefing {
  id: string;
  generatedAt: string;
  briefingDate: string;
  timezone: string;

  topTeamingOpp: { company: string; value: string; score: number; reason: string } | null;
  topSbloUpdate: { company: string; contact: string } | null;
  topSubkPlan: { company: string; goals: string } | null;
  topPartnershipSignal: { headline: string; source: string } | null;

  teamingOppsCount: number;
  sbloUpdatesCount: number;
  userEmail: string;
}

// Teaming opportunity
export interface TeamingOpportunity {
  id: string;
  company: string;
  contractValue: string;
  contractValueNum: number;
  agencies: string[];
  naicsCodes: string[];
  matchingNaics: string[];

  // SBLO contact
  sbloName: string | null;
  sbloEmail: string | null;
  sbloPhone: string | null;

  // Teaming fit
  teamingScore: number;
  teamingReasons: string[];
  hasSubcontractingPlan: boolean;
  vendorPortalUrl: string | null;

  // Suggested action
  suggestedAction: string;
}

// SBLO contact update
export interface SBLOUpdate {
  id: string;
  company: string;
  updateType: 'new_contact' | 'contact_changed' | 'contact_verified';
  previousContact: string | null;
  newContact: {
    name: string;
    title: string;
    email: string;
    phone: string | null;
  };
  detectedAt: string;
  actionableInsight: string;
}

// New subcontracting plan
export interface SubcontractingPlan {
  id: string;
  company: string;
  planType: 'new' | 'updated';
  agencies: string[];
  contractValue: string;
  goals: {
    smallBusiness?: number;
    wosb?: number;
    sdvosb?: number;
    hubzone?: number;
    sdb?: number;
  };
  detectedAt: string;
  opportunity: string;
}

// Partnership signal from RSS/news
export interface PartnershipSignal {
  id: string;
  headline: string;
  source: string;
  url: string;
  publishedDate: string | null;
  signalType: 'teaming' | 'jv' | 'mentor_protege' | 'acquisition' | 'partnership';
  companiesInvolved: string[];
  relevance: string;
}

// Email template output
export interface ContractorDBEmailTemplate {
  subject: string;
  preheader: string;
  htmlBody: string;
  textBody: string;
}

// User profile for contractor matching
export interface ContractorDBUserProfile {
  email: string;
  naicsCodes: string[];
  targetAgencies: string[];
  watchedCompanies: string[];
  certifications: string[];
  hasDBAccess: boolean;
}
