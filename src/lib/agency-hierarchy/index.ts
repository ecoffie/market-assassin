/**
 * Agency Hierarchy Module
 *
 * Unified agency intelligence combining:
 * - SAM.gov Federal Hierarchy
 * - Pain Points database
 * - Contractor/SBLO contacts
 * - Agency aliases
 * - USASpending aggregations
 */

// Main search and lookup
export {
  searchAgencies,
  getAgency,
  getAllDepartments,
  getAgencyHierarchyTree,
  getServiceStats,
  type UnifiedAgencyResult,
  type UnifiedSearchOptions
} from './unified-search';

// Pain points specific functions
export {
  getPainPointsForAgency,
  searchPainPoints,
  getPainPointsByNaics,
  resolveAlias,
  resolveCgacCode,
  getParentAgency,
  getCgacCode,
  getAgencyInfo,
  getAllAgenciesWithPainPoints,
  getPainPointsStats,
  type AgencyPainPoints,
  type PainPointSearchResult
} from './pain-points-linker';

// Spending statistics
export {
  getAgencySpending,
  getSpendingSummary,
  formatSpending,
  type AgencySpending,
  type SpendingSummary
} from './spending-stats';
