// Federal Market Assassin - Core Types

export type BusinessType =
  | 'Women Owned'
  | 'HUBZone'
  | '8(a) Certified'
  | 'Small Business'
  | 'DOT Certified'
  | 'Native American/Tribal';

export type VeteranStatus =
  | 'Veteran Owned'
  | 'Service Disabled Veteran'
  | 'Not Applicable';

export type GoodsOrServices =
  | 'Goods'
  | 'Services'
  | 'Both';

// Core 5 Inputs
export interface CoreInputs {
  businessType: BusinessType;
  naicsCode: string;
  zipCode?: string;
  veteranStatus?: VeteranStatus;
  goodsOrServices?: GoodsOrServices;
  pscCode?: string;  // Product/Service Code (4-character) for precise filtering
  companyName?: string;
  excludeDOD?: boolean;  // Exclude Department of Defense agencies (civilian agencies only)
}

// Agency Data from USAspending.gov
export interface Agency {
  id: string;
  name: string;
  contractingOffice: string;    // Specific office that awards contracts
  subAgency: string;            // Intermediate agency (e.g., "Department of the Army")
  parentAgency: string;         // Top-level agency (e.g., "Department of Defense")
  setAsideSpending: number;
  contractCount: number;
  location: string;
  officeId?: string;
  subAgencyCode?: string;
  command?: string;             // Specific DoD command (e.g., "NAVFAC", "NAVSEA") for pain points matching
  hasSpecificOffice?: boolean;  // True if we have distinct contracting office data
  website?: string | null;      // Command/agency website URL
  forecastUrl?: string | null;  // Forecast opportunities URL
  samForecastUrl?: string;      // SAM.gov forecast search URL
  osbp?: {                      // Office of Small Business Programs contact info
    name: string;
    director: string;
    phone: string;
    email: string;
    address: string;
  } | null;
}

// Pain Point
export interface PainPoint {
  agency: string;
  painPoint: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
}

// Prime Contractor (enhanced with bootcamp database)
export interface PrimeContractor {
  name: string;
  sbloName?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  naicsCategories: string[];
  agencies: string[];
  contractCount?: number | null;
  totalContractValue?: number | null;
  hasSubcontractPlan?: boolean | null;
  hasContactInfo?: string | null;
  supplierPortal?: string | null;
  vendorPortalType?: string | null;
  vendorPortalNotes?: string | null;
  source?: string | null;
  // Legacy/derived fields
  specialties?: string[];
  smallBusinessLevel?: 'high' | 'medium' | 'low';
  contractTypes?: string[];
  tier2Opportunities?: string[];
  description?: string;
  opportunities?: string;
  contactStrategy?: string;
  relevantAgencies?: string[];
  industries?: string[];
}

// Tier 2 Contractor
export interface Tier2Contractor {
  name: string;
  sbloName?: string | null;
  email?: string | null;
  phone?: string | null;
  contactQuality?: string | null;
  naicsCategories: string[];
  source?: string | null;
  tierClassification: string;
  specialties?: string[];
  worksWithPrimes?: string[];
  agencies?: string[];
  certifications?: string[];
}

// Tribe (enhanced with bootcamp database)
export interface Tribe {
  name: string;
  region: string;
  capabilities: string[];
  capabilitiesNarrative?: string | null;
  capabilitiesStatementLink?: string | null;
  activeSbaCertifications?: string[];
  contactPersonsName?: string | null;
  contactPersonsEmail?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  primaryNaicsCode?: string | null;
  naicsCategories?: string[];
  allNaicsCodes?: string[];
}

// Office of Small Business Programs (OSBP) Contact Info - for government agencies
export interface OSBPContact {
  name: string;
  director: string;
  phone: string;
  email: string;
  address: string;
}

// Report Types
export interface GovernmentBuyersReport {
  agencies: Array<{
    contractingOffice: string;      // Specific office name
    subAgency: string;              // Intermediate agency (e.g., "Department of the Army")
    parentAgency: string;           // Top-level agency (e.g., "Department of Defense")
    spending: number;
    contractCount: number;
    officeId: string;
    subAgencyCode?: string;
    contactStrategy: string;
    location: string;
    // Enhanced command info for DoD agencies
    command?: string | null;                          // Detected command (e.g., "NAVFAC", "NAVSEA")
    website?: string | null;                          // Command website URL
    forecastUrl?: string | null;                      // Command-specific forecast page
    samForecastUrl?: string | null;                   // SAM.gov forecast search URL
    osbp?: OSBPContact | null;                        // Office of Small Business Programs contact
  }>;
  summary: {
    totalAgencies: number;
    totalSpending: number;
    totalContracts: number;
    commandEnhancedAgencies?: number;  // Count of agencies with command-level data
  };
  recommendations: string[];
}

export interface Tier2SubcontractingReport {
  suggestedPrimes: Array<{
    name: string;
    reason: string;
    opportunities: string[];
    relevantAgencies: string[];
    contactStrategy: string;
  }>;
  summary: {
    totalPrimes: number;
    opportunityCount: number;
  };
  recommendations: string[];
}

// Forecast Resource (command-specific forecast URL)
export interface ForecastResource {
  command: string;
  forecastUrl: string;
  samForecastUrl: string;
}

export interface ForecastListReport {
  forecasts: Array<{
    agency: string;
    quarter: string;
    estimatedValue: number;
    solicitationDate: string;
    description: string;
    naicsCode?: string;
    contractType?: string;
    setAside?: string;
  }>;
  // Command-specific forecast resources
  forecastResources?: ForecastResource[];
  summary: {
    totalForecasts: number;
    totalValue: number;
    forecastSources?: number;  // Number of command-specific forecast sources
  };
  recommendations: string[];
}

export interface AgencyNeedsReport {
  needs: Array<{
    agency: string;
    requirement: string;
    capabilityMatch: string;
    positioning: string;
  }>;
  summary: {
    totalNeeds: number;
    matchRate: number;
  };
  recommendations: string[];
}

export interface AgencyPainPointsReport {
  painPoints: Array<{
    agency: string;
    painPoint: string;
    opportunityMatch: string;
    solutionPositioning: string;
    priority: string;
  }>;
  summary: {
    totalPainPoints: number;
    highPriority: number;
  };
  recommendations: string[];
}

export interface DecemberSpendReport {
  opportunities: Array<{
    agency: string;
    estimatedQ4Spend: number;
    urgencyLevel: 'high' | 'medium' | 'low';
    quickWinStrategy: string;
  }>;
  summary: {
    totalQ4Spend: number;
    urgentOpportunities: number;
  };
  recommendations: string[];
}

export interface TribalContractingReport {
  opportunities: Array<{
    agency: string;
    tribalProgram: string;
    estimatedValue: number;
  }>;
  suggestedTribes: Tribe[];
  recommendedAgencies: string[];
  summary: {
    totalOpportunities: number;
    totalValue: number;
  };
  recommendations: string[];
}

export interface PrimeContractorReport {
  suggestedPrimes: Array<{
    name: string;
    reason: string;
    subcontractingOpportunities: string[];
    contractTypes: string[];
    smallBusinessLevel: string;
  }>;
  otherAgencies: Array<{
    name: string;
    reason: string;
    matchingPainPoints: string[];
    relevance: string;
  }>;
  summary: {
    totalPrimes: number;
    totalOtherAgencies: number;
  };
  recommendations: string[];
}

// IDV Contract (from USAspending.gov)
export interface IDVContract {
  awardId: string;
  recipientName: string;
  recipientUei: string;
  awardAmount: number;
  description: string;
  startDate: string;
  endDate: string;
  agency: string;
  subAgency: string;
  naicsCode: string;
  naicsDescription: string;
  recipientState: string;
  popState: string;
  generatedId: string;
  usaSpendingUrl: string;
}

// IDV Contracts Report
export interface IDVContractsReport {
  contracts: IDVContract[];
  summary: {
    totalContracts: number;
    totalValue: number;
    uniquePrimes: number;
  };
  recommendations: string[];
}

// All Reports Combined
export interface ComprehensiveReport {
  governmentBuyers: GovernmentBuyersReport;
  tier2Subcontracting: Tier2SubcontractingReport;
  forecastList: ForecastListReport;
  agencyNeeds: AgencyNeedsReport;
  agencyPainPoints: AgencyPainPointsReport;
  decemberSpend: DecemberSpendReport;
  tribalContracting: TribalContractingReport;
  primeContractor: PrimeContractorReport;
  idvContracts?: IDVContractsReport;  // IDV Indefinite Delivery contracts for subcontracting
  metadata: {
    generatedAt: string;
    inputs: CoreInputs;
    selectedAgencies: string[];
    totalAgencies: number;
  };
}

// Smart Suggestions
export interface SmartSuggestions {
  primes: PrimeContractor[];
  tribes: Tribe[];
  otherAgencies: Agency[];
  reasons: {
    primes: string[];
    tribes: string[];
    agencies: string[];
  };
}

// Alternative Search Option
export interface AlternativeSearchOption {
  label: string;
  description: string;
  filters: Partial<{
    naicsCode?: string | null;
    zipCode?: string | null;
    businessType?: string | null;
    veteranStatus?: string | null;
  }>;
  estimatedResults?: number;
}

// API Response Types
export interface USASpendingResponse {
  agencies: Agency[];
  totalCount: number;
  totalSpending: number;
  naicsCorrectionMessage?: string | null;
  alternativeSearches?: AlternativeSearchOption[];
}

export interface GenerateReportsRequest {
  inputs: CoreInputs;
  selectedAgencies: string[];
  selectedAgencyData?: Agency[];
}

export interface GenerateReportsResponse {
  success: boolean;
  report?: ComprehensiveReport;
  error?: string;
}
