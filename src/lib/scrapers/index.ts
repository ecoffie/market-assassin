/**
 * Multi-Site Aggregation - Scraper Framework
 *
 * Unified exports for all scrapers and types.
 */

// Types
export * from './types';

// API-based scrapers - NIH RePORTER
export {
  searchNIHProjects,
  searchNIHSBIR,
  getNIHProjectDetails,
  checkNIHHealth,
  NIH_INSTITUTES,
  NIH_SOURCE_ID
} from './apis/nih-reporter';

// API-based scrapers - SBIR.gov (covers NSF and all agencies)
export {
  searchSBIRSolicitations,
  searchSBIRAwards,
  searchNSFSBIR,
  checkSBIRHealth,
  SBIR_SOURCE_ID,
  SBIR_AGENCIES
} from './apis/sbir-gov';

// API-based scrapers - DARPA BAAs (via SAM.gov)
export {
  searchDARPABAAs,
  searchDARPAByOffice,
  checkDARPAHealth,
  DARPA_SOURCE_ID,
  DARPA_OFFICES
} from './apis/darpa-baa';

// Re-export types
export type {
  NIHSearchParams,
  NIHProject,
  NIHSearchResponse
} from './apis/nih-reporter';

export type {
  SBIRSearchParams
} from './apis/sbir-gov';

export type {
  DARPASearchParams
} from './apis/darpa-baa';
