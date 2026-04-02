/**
 * Briefings Data Pipelines
 *
 * Unified exports for all data pipeline modules.
 */

// SAM.gov Opportunities Pipeline
export {
  fetchSamOpportunities,
  fetchOpportunitiesForUser,
  diffOpportunities,
  scoreOpportunity,
} from './sam-gov';
export type {
  SAMOpportunity,
  SAMSearchParams,
  SAMSearchResult,
} from './sam-gov';

// FPDS Recompete Pipeline
export {
  fetchExpiringContracts,
  fetchRecompetesForUser,
  diffRecompetes,
  scoreRecompete,
} from './fpds-recompete';
export type {
  RecompeteContract,
  RecompeteSearchParams,
  RecompeteSearchResult,
} from './fpds-recompete';

// Contract Awards Pipeline (USAspending)
export {
  fetchContractAwards,
  fetchAwardsForUser,
  diffAwards,
  scoreAward,
} from './contract-awards';
export type {
  ContractAward,
  AwardsSearchParams,
  AwardsSearchResult,
} from './contract-awards';

// Contractor Database Pipeline
export {
  fetchContractors,
  fetchContractorsForUser,
  diffContractors,
  scoreContractorForTeaming,
} from './contractor-db';
export type {
  ContractorRecord,
  ContractorChangeEvent,
  ContractorSearchParams,
  ContractorSearchResult,
} from './contractor-db';

// Grants.gov Pipeline
export {
  searchGrants,
  searchGrantsByNAICS,
  scoreGrant,
} from './grants-gov';
export type {
  GrantOpportunity,
  GrantSearchParams,
  GrantSearchResult,
} from './grants-gov';
