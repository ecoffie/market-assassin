/**
 * Data Sources Registry
 *
 * Central registry for all data sources powering BD Assist APIs.
 * Makes it easy to add new sources, track coverage, and manage updates.
 *
 * Usage:
 * - Add new source: Add entry to appropriate category
 * - Run import: Use scripts/import-[source].js
 * - Update coverage: Run /api/admin/data-health to recalculate
 */

export interface DataSource {
  id: string;
  name: string;
  url: string;
  type: 'api' | 'scraper' | 'excel' | 'csv' | 'pdf' | 'manual';
  status: 'active' | 'pending' | 'broken' | 'retired';
  lastSync?: string;
  recordCount?: number;
  importScript?: string;
  notes?: string;
}

export interface DataCategory {
  name: string;
  api: string;
  coveragePercent: number;
  sources: DataSource[];
  missingGaps: string[];
  howToExtend: string;
}

// ============================================================
// FORECAST SOURCES (60% coverage)
// ============================================================
export const FORECAST_SOURCES: DataSource[] = [
  // Phase 1 - Working
  { id: 'doj', name: 'Department of Justice', url: 'justice.gov', type: 'excel', status: 'active', recordCount: 3140, importScript: 'import-forecasts.js --source=DOJ' },
  { id: 'doi', name: 'Department of Interior', url: 'GSA Acquisition Gateway', type: 'csv', status: 'active', recordCount: 2039, importScript: 'import-gsa-forecasts.js' },
  { id: 'doe', name: 'Department of Energy', url: 'energy.gov', type: 'excel', status: 'active', recordCount: 833, importScript: 'import-forecasts.js --source=DOE' },
  { id: 'dhs', name: 'DHS', url: 'dhs.gov/procurement-forecast', type: 'scraper', status: 'active', recordCount: 683, importScript: 'run-dhs-scraper.js' },
  { id: 'nasa', name: 'NASA', url: 'nasa.gov', type: 'excel', status: 'active', recordCount: 294, importScript: 'import-forecasts.js --source=NASA' },
  { id: 'va', name: 'VA', url: 'GSA Acquisition Gateway', type: 'csv', status: 'active', recordCount: 268, importScript: 'import-gsa-forecasts.js' },
  { id: 'gsa', name: 'GSA', url: 'GSA Acquisition Gateway', type: 'csv', status: 'active', recordCount: 164, importScript: 'import-gsa-forecasts.js' },
  { id: 'nrc', name: 'NRC', url: 'GSA Acquisition Gateway', type: 'csv', status: 'active', recordCount: 79, importScript: 'import-gsa-forecasts.js' },
  { id: 'dot', name: 'DOT', url: 'GSA Acquisition Gateway', type: 'csv', status: 'active', recordCount: 68, importScript: 'import-gsa-forecasts.js' },
  { id: 'ssa', name: 'SSA', url: 'ssa.gov', type: 'excel', status: 'active', recordCount: 60, importScript: 'import-ssa-forecasts.js' },
  { id: 'nsf', name: 'NSF', url: 'nsf.gov', type: 'pdf', status: 'active', recordCount: 56, importScript: 'import-nsf-forecasts.js' },
  { id: 'dol', name: 'DOL', url: 'GSA Acquisition Gateway', type: 'csv', status: 'active', recordCount: 47, importScript: 'import-gsa-forecasts.js' },

  // Phase 2 - Pending (need Puppeteer scrapers)
  { id: 'hhs', name: 'HHS', url: 'procurementforecast.hhs.gov', type: 'scraper', status: 'pending', notes: 'Needs Puppeteer scraper, ~$12B coverage' },
  { id: 'treasury', name: 'Treasury', url: 'osdbu.forecast.treasury.gov', type: 'scraper', status: 'pending', notes: 'Needs scraper, ~$2B coverage' },
  { id: 'epa', name: 'EPA', url: 'ordspub.epa.gov', type: 'scraper', status: 'pending', notes: 'Needs scraper, ~$1.5B coverage' },
  { id: 'usda', name: 'USDA', url: 'forecast.edc.usda.gov', type: 'scraper', status: 'pending', notes: 'Needs scraper, ~$4B coverage' },

  // Phase 3 - Complex (DOD has multiple sources)
  { id: 'dod', name: 'DOD', url: 'Various', type: 'manual', status: 'pending', notes: 'Multiple sources: Army, Navy, Air Force, DISA. ~$40B coverage' },
];

// ============================================================
// EVENT SOURCES (80% coverage)
// ============================================================
export const EVENT_SOURCES: DataSource[] = [
  // Active
  { id: 'sam-events', name: 'SAM.gov Events', url: 'sam.gov', type: 'api', status: 'active', notes: 'Industry days, outreach events' },
  { id: 'apex', name: 'APEX Accelerators', url: 'apexaccelerators.us', type: 'scraper', status: 'active', notes: '50+ local events' },
  { id: 'sba-events', name: 'SBA Events', url: 'sba.gov/events', type: 'scraper', status: 'active' },
  { id: 'gsa-events', name: 'GSA Events', url: 'gsa.gov/events', type: 'scraper', status: 'active' },

  // Pending
  { id: 'agency-osdbud', name: 'Agency OSDBU Events', url: 'Various', type: 'manual', status: 'pending', notes: 'Each agency OSDBU has events calendar' },
  { id: 'industry-days', name: 'FedBizOpps Industry Days', url: 'sam.gov', type: 'api', status: 'pending' },
  { id: 'govcon-conferences', name: 'GovCon Conferences', url: 'Various', type: 'manual', status: 'pending', notes: 'AFCEA, AUSA, Sea Air Space, etc.' },
];

// ============================================================
// RECOMPETE SOURCES (70% coverage)
// ============================================================
export const RECOMPETE_SOURCES: DataSource[] = [
  { id: 'usaspending', name: 'USASpending Awards', url: 'usaspending.gov', type: 'api', status: 'active', notes: 'Contracts >$25K with end dates' },
  { id: 'fpds-archive', name: 'FPDS Archive (pre-2026)', url: 'fpds.gov (retired)', type: 'manual', status: 'retired', notes: 'Historical data, no longer updated' },

  // Gaps
  { id: 'idv-orders', name: 'IDV Task Orders', url: 'usaspending.gov', type: 'api', status: 'pending', notes: 'Individual orders under IDVs - complex to track' },
  { id: 'micro-purchases', name: 'Micro-Purchases', url: 'N/A', type: 'manual', status: 'pending', notes: '<$25K not in USASpending' },
];

// ============================================================
// AGENCY INTEL SOURCES (90% coverage)
// ============================================================
export const AGENCY_SOURCES: DataSource[] = [
  { id: 'pain-points', name: 'Agency Pain Points DB', url: 'internal', type: 'manual', status: 'active', recordCount: 2765, notes: '250 agencies, curated from strategic plans' },
  { id: 'sam-hierarchy', name: 'SAM.gov Federal Hierarchy', url: 'sam.gov', type: 'api', status: 'active', notes: 'Official org structure' },
  { id: 'usaspending-spending', name: 'USASpending Spending', url: 'usaspending.gov', type: 'api', status: 'active', notes: 'Budget data by agency' },
  { id: 'agency-aliases', name: 'Agency Aliases', url: 'internal', type: 'manual', status: 'active', recordCount: 450, notes: 'Abbreviation mappings' },

  // Gaps
  { id: 'sub-agencies', name: 'Sub-Agency Details', url: 'Various', type: 'manual', status: 'pending', notes: 'Detailed sub-agency pain points' },
];

// ============================================================
// CONTRACTOR DATABASE (95% coverage)
// ============================================================
export const CONTRACTOR_SOURCES: DataSource[] = [
  { id: 'sba-prime', name: 'SBA Prime Directory FY24', url: 'sba.gov', type: 'csv', status: 'active', recordCount: 3500, notes: 'Primary source' },
  { id: 'dsbs', name: 'Dynamic Small Business Search', url: 'dsbs.sba.gov', type: 'api', status: 'pending', notes: 'Could add real-time search' },
  { id: 'sam-entities', name: 'SAM.gov Entity API', url: 'sam.gov', type: 'api', status: 'active', notes: 'For UEI/CAGE lookups' },
];

// ============================================================
// MASTER REGISTRY
// ============================================================
export const DATA_REGISTRY: DataCategory[] = [
  {
    name: 'Forecasts',
    api: '/api/forecasts',
    coveragePercent: 60,
    sources: FORECAST_SOURCES,
    missingGaps: ['DOD (~$40B)', 'HHS (~$12B)', 'USDA (~$4B)', 'Treasury (~$2B)', 'EPA (~$1.5B)'],
    howToExtend: 'Add scraper to src/lib/forecasts/scrapers/, create import script in scripts/, run import'
  },
  {
    name: 'Events',
    api: '/api/federal-events',
    coveragePercent: 80,
    sources: EVENT_SOURCES,
    missingGaps: ['Individual OSDBU calendars', 'Industry conferences'],
    howToExtend: 'Add source to src/lib/events/sources.ts, implement fetch function'
  },
  {
    name: 'Recompetes',
    api: '/api/recompete',
    coveragePercent: 70,
    sources: RECOMPETE_SOURCES,
    missingGaps: ['IDV task orders', 'Micro-purchases <$25K'],
    howToExtend: 'USASpending API handles most - extend filters in src/lib/recompete/'
  },
  {
    name: 'Agency Intel',
    api: '/api/agency-sources',
    coveragePercent: 90,
    sources: AGENCY_SOURCES,
    missingGaps: ['Sub-agency details'],
    howToExtend: 'Add to src/data/agency-pain-points.json, run /api/admin/build-pain-points'
  },
  {
    name: 'Contractors',
    api: '/api/contractors',
    coveragePercent: 95,
    sources: CONTRACTOR_SOURCES,
    missingGaps: ['Real-time DSBS integration'],
    howToExtend: 'Add to src/data/contractors.json or integrate SAM Entity API'
  },
  {
    name: 'Market Scan',
    api: '/api/market-scan',
    coveragePercent: 85,
    sources: [
      { id: 'usaspending', name: 'USASpending', url: 'usaspending.gov', type: 'api', status: 'active' },
      { id: 'sam-opps', name: 'SAM.gov Opportunities', url: 'sam.gov', type: 'api', status: 'active' },
    ],
    missingGaps: ['Micro-purchases', 'Some classified spending'],
    howToExtend: 'APIs are live - coverage is inherent to federal reporting'
  }
];

// Helper: Get registry summary
export function getRegistrySummary() {
  return DATA_REGISTRY.map(cat => ({
    name: cat.name,
    api: cat.api,
    coverage: `${cat.coveragePercent}%`,
    activeSources: cat.sources.filter(s => s.status === 'active').length,
    pendingSources: cat.sources.filter(s => s.status === 'pending').length,
    totalRecords: cat.sources.reduce((sum, s) => sum + (s.recordCount || 0), 0),
    gaps: cat.missingGaps
  }));
}

// Helper: Find source by ID
export function findSource(id: string): DataSource | undefined {
  for (const cat of DATA_REGISTRY) {
    const source = cat.sources.find(s => s.id === id);
    if (source) return source;
  }
  return undefined;
}
