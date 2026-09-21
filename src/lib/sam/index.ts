/**
 * SAM.gov API Integration
 *
 * Unified export for all SAM.gov API wrappers
 */

// Shared utilities
export {
  SAM_API_CONFIGS,
  makeSAMRequest,
  checkCache,
  storeInCache,
  checkRateLimit,
  getRateLimitStatus,
  cleanExpiredCache,
  withRetry,
  generateCacheKey
} from './utils';

export type {
  SAMAPIConfig,
  CacheEntry,
  SAMError
} from './utils';

// Contract Awards API
export {
  searchContractAwards,
  getExpiringContracts,
  getContractFamily,
  getContractsByIncumbent,
  getLowCompetitionContracts,
  getTroubledContracts,
  aggregateContractIntelligence
} from './contract-awards';

export type {
  ContractAward,
  ContractAwardSearchParams,
  ContractAwardSearchResult,
  ContractFamily,
  ContractIntelligence
} from './contract-awards';

// USASpending Fallback (when SAM.gov Contract Awards API unavailable)
export {
  searchUSASpendingAwards,
  getUSASpendingAward,
  getExpiringContractsUSASpending,
  getLowCompetitionContractsUSASpending
} from './usaspending-fallback';

// Entity Management API
export {
  searchEntities,
  getEntityByUEI,
  getEntityByCAGE,
  verifySAMStatus,
  getCertifications,
  searchByCertification,
  getEntityNAICS,
  findTeamingPartners
} from './entity-api';

export type {
  SAMEntity,
  EntitySearchParams,
  EntitySearchResult
} from './entity-api';

// Subaward Reporting API
export {
  searchSubawards,
  getSubsForPrime,
  getPrimesForSub,
  buildTeamingNetwork,
  findTeamingOpportunities
} from './subaward-api';

export type {
  Subaward,
  SubawardSearchParams,
  SubawardSearchResult,
  TeamingRelationship,
  TeamingNetwork
} from './subaward-api';

// Federal Hierarchy API
export {
  getAgencyStructure,
  getOfficesForNaics,
  searchOffices,
  getDepartments,
  getBuyingOfficesSummary
} from './federal-hierarchy';

export type {
  FederalOrganization,
  AgencyHierarchy,
  OfficeSearchResult
} from './federal-hierarchy';
