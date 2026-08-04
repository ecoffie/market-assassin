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
/**
 * NOTE ON `recordCount`: these are a LAST-RESORT fallback, not the truth.
 *
 * They are hand-written snapshots and they drift the moment a scraper runs.
 * As of 2026-08-04 they had drifted so far that getRegistrySummary() reported
 * 7,731 forecasts against a live table holding 33,097 — and four agencies were
 * still labelled `pending` months after their scrapers shipped.
 *
 * Callers should pass live counts into getRegistrySummary({ liveCounts }) and
 * let these be ignored. Counts here are refreshed only when someone happens to
 * look. See `agency_forecasts.source_agency` for ground truth:
 *   SELECT source_agency, count(*) FROM agency_forecasts GROUP BY 1 ORDER BY 2 DESC;
 */
export const FORECAST_SOURCES: DataSource[] = [
  // Counts below verified against agency_forecasts 2026-08-04.
  { id: 'navy', name: 'Navy (LRAE)', url: 'navy.mil', type: 'excel', status: 'active', recordCount: 8821, importScript: 'import-navy-lrae.ts', notes: 'Long Range Acquisition Estimate workbook — the single largest feed' },
  { id: 'doi', name: 'Department of Interior', url: 'GSA Acquisition Gateway + DOI API', type: 'api', status: 'active', recordCount: 6164, importScript: 'import-gsa-forecasts.js' },
  { id: 'usda', name: 'USDA', url: 'forecast.edc.usda.gov', type: 'api', status: 'active', recordCount: 5028, importScript: 'import-usda-forecasts.ts' },
  { id: 'hhs', name: 'HHS', url: 'procurementforecast.hhs.gov (SBCX API)', type: 'api', status: 'active', recordCount: 3643, importScript: 'import-hhs-forecasts.ts' },
  { id: 'usace', name: 'USACE', url: 'usace.army.mil (district workbooks)', type: 'excel', status: 'active', recordCount: 2908, importScript: 'import-usace-forecasts.ts', notes: 'Enterprise DA format + per-district workbooks + DA PDFs' },
  { id: 'va', name: 'VA', url: 'GSA Acquisition Gateway + VA API', type: 'api', status: 'active', recordCount: 1390, importScript: 'import-gsa-forecasts.js' },
  { id: 'doe', name: 'Department of Energy', url: 'energy.gov (OSDBU)', type: 'excel', status: 'active', recordCount: 1301, importScript: 'import-forecasts.js --source=DOE' },
  { id: 'dhs', name: 'DHS', url: 'dhs.gov/procurement-forecast', type: 'api', status: 'active', recordCount: 1015, importScript: 'run-dhs-scraper.js' },
  { id: 'dot', name: 'DOT', url: 'GSA Acquisition Gateway + DOT API', type: 'api', status: 'active', recordCount: 897, importScript: 'import-gsa-forecasts.js' },
  { id: 'gsa', name: 'GSA', url: 'GSA Acquisition Gateway', type: 'api', status: 'active', recordCount: 514, importScript: 'import-gsa-forecasts.js' },
  { id: 'doj', name: 'Department of Justice', url: 'justice.gov', type: 'excel', status: 'active', recordCount: 500, importScript: 'import-forecasts.js --source=DOJ' },
  { id: 'nasa', name: 'NASA', url: 'nasa.gov (NAF grid + Excel)', type: 'excel', status: 'active', recordCount: 225, importScript: 'import-forecasts.js --source=NASA' },
  { id: 'treasury', name: 'Treasury', url: 'osdbu.forecast.treasury.gov', type: 'api', status: 'active', recordCount: 200, importScript: 'import-treasury-forecasts.ts', notes: 'OSDBU Salesforce feed' },
  { id: 'dol', name: 'DOL', url: 'GSA Acquisition Gateway + DOL API', type: 'api', status: 'active', recordCount: 166, importScript: 'import-gsa-forecasts.js' },
  { id: 'nrc', name: 'NRC', url: 'GSA Acquisition Gateway', type: 'api', status: 'active', recordCount: 89, importScript: 'import-gsa-forecasts.js' },
  { id: 'ssa', name: 'SSA', url: 'ssa.gov', type: 'excel', status: 'active', recordCount: 60, importScript: 'import-ssa-forecasts.js' },
  { id: 'epa', name: 'EPA', url: 'ordspub.epa.gov (APEX)', type: 'api', status: 'active', recordCount: 50, importScript: 'import-epa-forecasts.ts' },
  { id: 'onr', name: 'Office of Naval Research', url: 'onr.navy.mil', type: 'excel', status: 'active', recordCount: 48 },
  { id: 'nsf', name: 'NSF', url: 'nsf.gov', type: 'api', status: 'active', recordCount: 33, importScript: 'import-nsf-forecasts.js' },
  { id: 'nrl', name: 'Naval Research Laboratory', url: 'nrl.navy.mil', type: 'excel', status: 'active', recordCount: 12 },

  // Still missing — the real remaining gap is the rest of DoD.
  { id: 'army', name: 'Army (non-USACE)', url: 'Various', type: 'manual', status: 'pending', notes: 'Army commands outside USACE' },
  { id: 'usaf', name: 'Air Force', url: 'Various', type: 'manual', status: 'pending', notes: 'No unified AF forecast feed' },
  { id: 'disa', name: 'DISA', url: 'disa.mil', type: 'manual', status: 'pending', notes: 'Forecast published irregularly' },
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
// PRICING & REGULATORY DEMAND — Mindy MCP live-API sources (2026-07-12)
// These are LIVE PASSTHROUGH sources (no mirrored row count): the MCP tools
// fetch on demand with a short-TTL response cache (mcp_external_cache), not a
// persisted dataset. coveragePercent is N/A for passthrough — the number is the
// upstream's, not ours. (PRD §5a — EDGAR + Federal Register net-new; CALC promoted.)
// ============================================================
export const REGULATORY_SOURCES: DataSource[] = [
  {
    id: 'gsa-calc',
    name: 'GSA CALC+ Labor Rates',
    url: 'api.gsa.gov/acquisition/calc/v3',
    type: 'api',
    status: 'active',
    recordCount: 240000,
    notes: 'MCP tool get_pricing_intel. ~240K awarded labor categories, daily refresh, keyless. Price-to-win p25/p50/p75. Cache 12h.',
  },
  {
    id: 'sec-edgar',
    name: 'SEC EDGAR Financials',
    url: 'sec.gov / data.sec.gov',
    type: 'api',
    status: 'active',
    notes: 'MCP tool get_incumbent_financials. Public filers only (private contractors → grounded=false). company_tickers → companyfacts. Cache 24h/6h. Requires User-Agent.',
  },
  {
    id: 'federal-register',
    name: 'Federal Register',
    url: 'federalregister.gov/api/v1',
    type: 'api',
    status: 'active',
    notes: 'MCP tool get_regulatory_demand. "Demand before SAM" leading indicator. No NAICS tagging (inference only). Cache 1h. Keyless.',
  },
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
  },
  {
    name: 'Pricing & Regulatory',
    api: 'MCP: get_pricing_intel, get_incumbent_financials, get_regulatory_demand',
    coveragePercent: 0,
    sources: REGULATORY_SOURCES,
    missingGaps: ['Live passthrough — no mirrored count (coverage is the upstream API\'s, not ours)', 'Congress.gov appropriations + GAO protests (PRD §5a, deferred)'],
    howToExtend: 'Add a tool in src/mcp/tools/ + client in src/lib/<source>/ + register in src/lib/mcp/tool-registry.ts and src/mcp/server.ts'
  }
];

/**
 * Live record counts, keyed by category name, that OVERRIDE the hand-written
 * `recordCount` snapshots. Callers that already query the DB (e.g.
 * /api/admin/data-inventory) should pass what they measured.
 *
 * Example: { Forecasts: 33097 }
 */
export type LiveCounts = Record<string, number | null | undefined>;

/**
 * Summarize the registry for admin surfaces.
 *
 * `totalRecords` prefers a live count when one is supplied for that category and
 * falls back to summing the hardcoded snapshots. That fallback is why this
 * reported 7,731 forecasts while the table actually held 33,097 (2026-08-04) —
 * the snapshots had gone months without a refresh. `recordsAreLive` tells the
 * caller which number it got, so a stale figure can be labelled rather than
 * silently published.
 */
export function getRegistrySummary(liveCounts: LiveCounts = {}) {
  return DATA_REGISTRY.map(cat => {
    const live = liveCounts[cat.name];
    const hasLive = typeof live === 'number' && Number.isFinite(live);
    return {
      name: cat.name,
      api: cat.api,
      coverage: `${cat.coveragePercent}%`,
      activeSources: cat.sources.filter(s => s.status === 'active').length,
      pendingSources: cat.sources.filter(s => s.status === 'pending').length,
      totalRecords: hasLive
        ? (live as number)
        : cat.sources.reduce((sum, s) => sum + (s.recordCount || 0), 0),
      recordsAreLive: hasLive,
      gaps: cat.missingGaps,
    };
  });
}

// Helper: Find source by ID
export function findSource(id: string): DataSource | undefined {
  for (const cat of DATA_REGISTRY) {
    const source = cat.sources.find(s => s.id === id);
    if (source) return source;
  }
  return undefined;
}
