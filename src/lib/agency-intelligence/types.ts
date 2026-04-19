// Agency Intelligence Types
// For fetching and storing federal oversight data

export interface AgencyIntelligence {
  id?: string;
  agency_name: string;
  agency_code?: string;
  parent_agency?: string;
  intelligence_type: IntelligenceType;
  title: string;
  description?: string;
  keywords?: string[];
  fiscal_year?: number;
  source_name: string;
  source_url?: string;
  source_document?: string;
  publication_date?: string;
  verified?: boolean;
  verified_at?: string;
  verification_source?: string;
  verification_notes?: string;
  created_at?: string;
  updated_at?: string;
}

export type IntelligenceType =
  | 'gao_high_risk'
  | 'ig_challenge'
  | 'budget_priority'
  | 'it_investment'
  | 'strategic_goal'
  | 'contract_pattern'
  | 'pain_point';

export interface IntelligenceSource {
  id?: string;
  source_name: string;
  api_endpoint?: string;
  api_key_env_var?: string;
  requires_auth: boolean;
  rate_limit_per_minute?: number;
  rate_limit_per_day?: number;
  enabled: boolean;
  last_sync_at?: string;
  last_sync_status?: string;
  agency_coverage?: string[];
  data_types?: string[];
}

export interface SyncRun {
  id?: string;
  source_name: string;
  sync_type: 'full' | 'incremental' | 'manual';
  started_at?: string;
  completed_at?: string;
  status: 'running' | 'completed' | 'failed';
  records_fetched: number;
  records_inserted: number;
  records_updated: number;
  records_verified: number;
  error_message?: string;
  metadata?: Record<string, unknown>;
}

// API Response types

export interface GovInfoDocument {
  packageId: string;
  title: string;
  documentType: string;
  dateIssued: string;
  branch: string;
  governmentAuthor: string[];
  publisher: string;
  download?: {
    pdfLink?: string;
    txtLink?: string;
  };
}

export interface ITDashboardInvestment {
  InvestmentID: string;
  InvestmentName: string;
  AgencyCode: string;
  AgencyName: string;
  TotalLifecycleCost: number;
  ProjectedCostVsActual: number;
  ScheduleVariance: string;
  RiskLevel: string;
  CIOPriority: string;
  Description: string;
}

export interface USASpendingAgency {
  toptier_code: string;
  name: string;
  abbreviation: string;
  total_obligated_amount: number;
  agency_slug: string;
}

export interface PerplexityVerification {
  verified: boolean;
  confidence: number;
  sources: string[];
  notes: string;
}

// Fetcher function types
export type IntelligenceFetcher = (
  options?: FetcherOptions
) => Promise<AgencyIntelligence[]>;

export interface FetcherOptions {
  agency?: string;
  fiscalYear?: number;
  limit?: number;
  dryRun?: boolean;
}
