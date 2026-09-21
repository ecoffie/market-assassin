/**
 * Contractor DB Briefing Module
 *
 * Exports all Contractor DB briefing functionality
 */

// Types
export type {
  ContractorDBBriefing,
  CondensedContractorDBBriefing,
  TeamingOpportunity,
  SBLOUpdate,
  SubcontractingPlan,
  PartnershipSignal,
  ContractorDBEmailTemplate,
  ContractorDBUserProfile,
} from './types';

// Generator
export {
  generateContractorDBBriefing,
  getContractorDBUserProfile,
} from './generator';

// Data Aggregator
export {
  aggregateContractorDBData,
  fetchTeamingOpportunities,
  fetchSBLOUpdates,
  fetchNewSubcontractingPlans,
  fetchPartnershipSignals,
} from './data-aggregator';

// Email Templates
export {
  generateContractorDBBriefingEmail,
  generateCondensedContractorDBBriefingEmail,
} from './email-templates';
