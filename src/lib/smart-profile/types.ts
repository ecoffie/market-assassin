/**
 * Smart User Profile Types
 *
 * Comprehensive user profile for personalized briefings
 */

// Full smart profile for briefing personalization
export interface SmartUserProfile {
  email: string;

  // Core targeting (explicit)
  naicsCodes: string[];
  targetAgencies: string[];
  watchedCompanies: string[];
  keywords: string[];

  // Location
  state: string | null;
  zipCode: string | null;
  metroArea: string | null;
  geographicPreference: 'local' | 'regional' | 'national';

  // Business attributes
  companyName: string | null;
  cageCode: string | null;
  dunsNumber: string | null;
  companySize: 'micro' | 'small' | 'midsize' | 'large' | null;
  annualRevenue: '<$1M' | '$1M-$5M' | '$5M-$25M' | '$25M-$100M' | '>$100M' | null;
  employeeCount: '<10' | '10-50' | '50-250' | '250-500' | '>500' | null;

  // Certifications
  certifications: string[]; // ['8(a)', 'SDVOSB', 'WOSB', 'HUBZone', 'EDWOSB']
  setAsidePreferences: string[];
  verifiedCerts: {
    '8a': boolean;
    sdvosb: boolean;
    wosb: boolean;
    hubzone: boolean;
  };

  // Experience & capabilities
  capabilityKeywords: string[];
  pastPerformanceAgencies: string[];
  contractVehicles: string[]; // ['GSA Schedule', 'SEWP', 'CIO-SP3']
  maxContractSize: string | null;

  // Engagement (learned)
  engagementScore: number; // 0-100
  briefingsOpened: number;
  briefingsClicked: number;
  lastBriefingOpenedAt: string | null;
  lastClickAt: string | null;

  // Interest signals (learned from behavior)
  clickedNaics: string[];
  clickedAgencies: string[];
  clickedContractors: string[];
  clickedOpportunities: string[];

  // Weights (frequency-based)
  naicsWeights: Record<string, number>;
  agencyWeights: Record<string, number>;
  companyWeights: Record<string, number>;

  // Content preferences
  preferredContentTypes: string[]; // ['teaming', 'recompete', 'budget', 'rss']
  mutedAgencies: string[];
  mutedNaics: string[];
  minContractValue: number;
  maxDistanceMiles: number | null;

  // Meta
  profileCompleteness: number; // 0-100
  onboardingCompleted: boolean;
  timezone: string;
  emailFrequency: 'daily' | 'weekly' | 'none';
  preferredDeliveryHour: number; // 0-23

  // Timestamps
  createdAt: string;
  updatedAt: string;
  lastProfileUpdate: string | null;
}

// Simplified profile for briefing generators
export interface BriefingUserProfile {
  email: string;

  // Core filters
  naicsCodes: string[];
  targetAgencies: string[];
  watchedCompanies: string[];
  keywords: string[];

  // Location
  state: string | null;
  zipCode: string | null;
  geographicPreference: 'local' | 'regional' | 'national';

  // Certifications (for set-aside filtering)
  certifications: string[];
  setAsidePreferences: string[];

  // Size/capacity
  companySize: string | null;
  maxContractSize: string | null;

  // Learned preferences (ranked by weight)
  topNaics: string[]; // Top 5 by weight
  topAgencies: string[]; // Top 5 by weight
  topCompanies: string[]; // Top 5 by weight

  // Exclusions
  mutedAgencies: string[];
  mutedNaics: string[];
  minContractValue: number;

  // Engagement
  engagementScore: number;
}

// Profile update payload (from onboarding or settings)
export interface ProfileUpdatePayload {
  // Can update any of these
  naicsCodes?: string[];
  targetAgencies?: string[];
  watchedCompanies?: string[];
  keywords?: string[];

  state?: string;
  zipCode?: string;
  geographicPreference?: 'local' | 'regional' | 'national';

  companyName?: string;
  cageCode?: string;
  companySize?: 'micro' | 'small' | 'midsize' | 'large';
  annualRevenue?: string;
  employeeCount?: string;

  certifications?: string[];
  setAsidePreferences?: string[];

  capabilityKeywords?: string[];
  pastPerformanceAgencies?: string[];
  contractVehicles?: string[];
  maxContractSize?: string;

  timezone?: string;
  emailFrequency?: 'daily' | 'weekly' | 'none';
  preferredDeliveryHour?: number;

  mutedAgencies?: string[];
  mutedNaics?: string[];
  minContractValue?: number;
  maxDistanceMiles?: number;
}

// Briefing interaction for learning
export interface BriefingInteraction {
  userEmail: string;
  briefingId: string;
  briefingDate: string;
  interactionType: 'open' | 'click' | 'dismiss' | 'save' | 'action_taken';
  itemType?: 'opportunity' | 'contractor' | 'recompete' | 'news' | 'teaming';
  itemId?: string;
  itemNaics?: string;
  itemAgency?: string;
  itemValue?: number;
  section?: string;
  position?: number;
  deviceType?: 'desktop' | 'mobile' | 'tablet';
}

// Profile completeness breakdown
export interface ProfileCompletenessBreakdown {
  total: number;
  breakdown: {
    hasNaics: boolean;
    hasAgencies: boolean;
    hasLocation: boolean;
    hasCompanyName: boolean;
    hasCertifications: boolean;
    hasCapabilities: boolean;
    hasPastPerformance: boolean;
    hasWatchedCompanies: boolean;
    hasCompanySize: boolean;
    hasContractVehicles: boolean;
  };
  missingFields: string[];
}

// Certification options
export const CERTIFICATION_OPTIONS = [
  { value: '8(a)', label: '8(a) Business Development' },
  { value: 'SDVOSB', label: 'Service-Disabled Veteran-Owned Small Business' },
  { value: 'VOSB', label: 'Veteran-Owned Small Business' },
  { value: 'WOSB', label: 'Women-Owned Small Business' },
  { value: 'EDWOSB', label: 'Economically Disadvantaged WOSB' },
  { value: 'HUBZone', label: 'HUBZone' },
  { value: 'SDB', label: 'Small Disadvantaged Business' },
  { value: 'Small Business', label: 'Small Business' },
] as const;

// Company size options
export const COMPANY_SIZE_OPTIONS = [
  { value: 'micro', label: 'Micro (<$1M revenue)' },
  { value: 'small', label: 'Small ($1M-$25M)' },
  { value: 'midsize', label: 'Midsize ($25M-$100M)' },
  { value: 'large', label: 'Large (>$100M)' },
] as const;

// Contract vehicle options
export const CONTRACT_VEHICLE_OPTIONS = [
  { value: 'GSA Schedule', label: 'GSA Schedule' },
  { value: 'SEWP', label: 'NASA SEWP' },
  { value: 'CIO-SP3', label: 'CIO-SP3' },
  { value: 'OASIS', label: 'OASIS' },
  { value: 'Alliant 2', label: 'Alliant 2' },
  { value: 'BPA', label: 'BPA Holder' },
  { value: 'None', label: 'No contract vehicles yet' },
] as const;

// Geographic preference options
export const GEOGRAPHIC_OPTIONS = [
  { value: 'local', label: 'Local (within 50 miles)' },
  { value: 'regional', label: 'Regional (within state)' },
  { value: 'national', label: 'National (anywhere in US)' },
] as const;
