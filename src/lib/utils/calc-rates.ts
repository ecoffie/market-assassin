/**
 * GSA CALC+ API Client
 *
 * Fetches labor rate ceiling data from GSA Multiple Award Schedule contracts.
 * API: https://api.gsa.gov/acquisition/calc/v3/api/ceilingrates/
 * No auth required. ~240K records, refreshed daily.
 */

import naicsData from '@/data/naics-codes.json';

const CALC_API = 'https://api.gsa.gov/acquisition/calc/v3/api/ceilingrates/';

// NAICS code → official title (1,741 codes). Used to derive per-code CALC search
// keywords when there's no curated mapping — so each NAICS returns DISTINCT,
// relevant labor categories instead of a shared generic fallback.
const NAICS_TITLES = (naicsData as { codes: Record<string, { title: string }> }).codes;
const TITLE_STOPWORDS = new Set([
  'other', 'services', 'service', 'and', 'for', 'all', 'except', 'related', 'activities',
  'general', 'miscellaneous', 'establishments', 'including', 'their', 'manufacturing',
]);

/** Significant keywords from a NAICS title (walks up to the parent code if needed). */
function keywordsFromNaicsTitle(code: string): string[] {
  const title =
    NAICS_TITLES[code]?.title ||
    NAICS_TITLES[code.slice(0, 5)]?.title ||
    NAICS_TITLES[code.slice(0, 4)]?.title ||
    NAICS_TITLES[code.slice(0, 3)]?.title ||
    NAICS_TITLES[code.slice(0, 2)]?.title;
  if (!title) return [];
  const words = title.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 4 && !TITLE_STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 3);
}

export interface CalcRateRecord {
  labor_category: string;
  current_price: number;
  next_year_price: number | null;
  second_year_price: number | null;
  vendor_name: string;
  education_level: string;
  min_years_experience: number;
  business_size: string; // 'S' or 'O'
  worksite: string;
  security_clearance: string | boolean;
  schedule: string;
  sin: string;
  idv_piid: string;
  contract_start: string;
  contract_end: string;
}

interface CalcApiResponse {
  hits: {
    total: { value: number; relation: string };
    hits: Array<{ _source: CalcRateRecord }>;
  };
  aggregations?: {
    wage_stats?: {
      count: number;
      min: number;
      max: number;
      avg: number;
      std_deviation: number;
    };
    median_price?: { values: { '50.0': number } };
    histogram_percentiles?: {
      values: Record<string, number>;
    };
    wage_histogram?: {
      buckets: Array<{ key: number; doc_count: number }>;
    };
    labor_category?: {
      buckets: Array<{ key: string; doc_count: number }>;
    };
    education_level?: {
      buckets: Array<{ key: string; doc_count: number }>;
    };
    min_years_experience?: {
      buckets: Array<{ key: number; doc_count: number }>;
    };
  };
}

// Map common NAICS codes to relevant labor category search terms
const naicsSearchTerms: Record<string, string[]> = {
  // IT & Telecom
  '541511': ['programmer', 'developer', 'software'],
  '541512': ['software engineer', 'systems engineer', 'developer', 'architect', 'cybersecurity analyst'],
  '541513': ['network', 'systems administrator', 'infrastructure'],
  '541519': ['IT', 'computer', 'technology', 'help desk'],
  '518210': ['data center', 'hosting', 'cloud'],
  // Engineering
  '541330': ['engineer', 'civil engineer', 'mechanical engineer', 'structural'],
  '541340': ['drafting', 'CAD', 'design'],
  // Consulting
  '541611': ['management consultant', 'program manager', 'analyst', 'business analyst'],
  '541612': ['human resources', 'organizational'],
  '541614': ['process improvement', 'logistics'],
  '541690': ['scientific consulting', 'technical advisor'],
  // R&D
  '541711': ['research scientist', 'biologist', 'chemist'],
  '541712': ['research', 'scientist', 'laboratory'],
  '541713': ['research', 'physicist', 'mathematician'],
  '541715': ['engineer', 'research engineer', 'scientist'],
  '541720': ['testing', 'laboratory', 'quality'],
  // Admin & Support
  '561210': ['security guard', 'security officer', 'protective'],
  '561320': ['staffing', 'temporary'],
  '561330': ['recruiter', 'human resources'],
  '561612': ['security systems', 'alarm'],
  '561720': ['janitorial', 'custodial', 'cleaning'],
  '561730': ['landscaping', 'grounds maintenance'],
  // Healthcare
  '621111': ['physician', 'doctor', 'medical officer'],
  '621210': ['dentist', 'dental'],
  '621310': ['chiropractor'],
  '621399': ['nurse', 'nursing', 'medical'],
  '621410': ['clinic', 'outpatient'],
  '621511': ['medical laboratory', 'lab technician'],
  // Construction
  '236220': ['construction manager', 'superintendent', 'foreman'],
  '237110': ['water', 'sewer', 'utility construction'],
  '237310': ['highway', 'road', 'bridge'],
  // Education
  '611430': ['instructor', 'trainer', 'curriculum'],
  '611710': ['training', 'education specialist'],
};

// Fallback: map 3-digit NAICS prefixes to broader terms
const naicsPrefixTerms: Record<string, string[]> = {
  '541': ['consultant', 'analyst', 'engineer', 'specialist'],
  '518': ['IT', 'data', 'cloud', 'systems'],
  '561': ['administrative', 'support', 'specialist'],
  '621': ['nurse', 'medical', 'healthcare', 'clinical'],
  '622': ['hospital', 'nursing', 'medical'],
  '236': ['construction', 'project manager', 'superintendent'],
  '237': ['construction', 'civil', 'engineer'],
  '238': ['electrician', 'plumber', 'HVAC', 'trades'],
  '611': ['instructor', 'trainer', 'teacher'],
  '334': ['electronics', 'technician', 'engineer'],
  '336': ['aerospace', 'manufacturing', 'mechanic'],
  '325': ['chemist', 'pharmacist', 'laboratory'],
  '562': ['environmental', 'waste', 'hazardous'],
};

function getSearchTermsForNAICS(naicsCode: string): string[] {
  const code = naicsCode.trim();
  // Try exact match first
  if (naicsSearchTerms[code]) return naicsSearchTerms[code];
  // Try 5-digit
  if (naicsSearchTerms[code.slice(0, 5)]) return naicsSearchTerms[code.slice(0, 5)];
  // Try 3-digit prefix
  if (naicsPrefixTerms[code.slice(0, 3)]) return naicsPrefixTerms[code.slice(0, 3)];
  // Derive keywords from the NAICS title — DISTINCT per code, so two different
  // unmapped NAICS no longer return the identical generic result set (the bug:
  // 541219 "Other Accounting Services" was returning engineers via the fallback).
  const titleTerms = keywordsFromNaicsTitle(code);
  if (titleTerms.length > 0) return titleTerms;
  // Last resort only when the code has no title at all (very rare).
  return ['analyst', 'specialist', 'manager', 'engineer'];
}

async function queryCalcAPI(params: {
  keyword?: string;
  businessSize?: 'S' | 'O';
  pageSize?: number;
  page?: number;
}): Promise<CalcApiResponse> {
  const url = new URL(CALC_API);
  if (params.keyword) url.searchParams.set('keyword', params.keyword);
  if (params.businessSize) url.searchParams.set('filter', `business_size:${params.businessSize}`);
  // NOTE: GSA CALC ceilingrates hard-caps at 20 records/response (page_size is
  // ignored for the cap), BUT `page=N` ONLY paginates when page_size is ALSO
  // present. So we always set page_size to enable ?page= walking.
  url.searchParams.set('page_size', String(params.pageSize || 20));
  if (params.page) url.searchParams.set('page', String(params.page));
  url.searchParams.set('ordering', 'current_price');
  url.searchParams.set('sort', 'asc');

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`CALC+ API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Pull ALL records for a keyword by walking pages (the API returns max 20/page).
 * Used for the complete labor-category table. Bounded by MAX_PAGES so a huge
 * keyword can't run away on API calls. Returns the merged records + the server
 * total + the first page's aggregations (server-computed stats over ALL records).
 */
const MAX_PAGES = 60; // 60 × 20 = up to 1,200 records; plenty for any role
async function queryCalcAPIAllPages(params: {
  keyword: string;
  businessSize?: 'S' | 'O';
  maxPages?: number;
}): Promise<{ records: CalcRateRecord[]; total: number; aggregations: CalcApiResponse['aggregations'] }> {
  const first = await queryCalcAPI({ ...params, page: 1, pageSize: 20 });
  const total = first.hits.total.value;
  const records: CalcRateRecord[] = first.hits.hits.map((h) => h._source);
  const aggregations = first.aggregations;

  const pagesNeeded = Math.min(params.maxPages ?? MAX_PAGES, Math.ceil(total / 20));
  for (let page = 2; page <= pagesNeeded; page++) {
    try {
      const j = await queryCalcAPI({ ...params, page, pageSize: 20 });
      const hits = j.hits.hits.map((h) => h._source);
      if (!hits.length) break;
      records.push(...hits);
    } catch {
      break; // partial data is fine — stop on the first failing page
    }
  }
  return { records, total, aggregations };
}

export interface LaborCategorySummary {
  category: string;
  recordCount: number;
  median: number;
  percentile25: number;
  percentile75: number;
  min: number;
  max: number;
  avg: number;
  nextYearMedian: number | null;
}

export interface PricingIntelData {
  laborCategories: LaborCategorySummary[];
  businessSizeComparison: {
    smallBusiness: { median: number; count: number; avg: number };
    largeBusiness: { median: number; count: number; avg: number };
    gapPercent: number;
  };
  rateDistribution: Array<{ range: string; count: number }>;
  priceToWinGuidance: {
    aggressiveRate: number;
    competitiveRate: number;
    premiumRate: number;
  };
  topVendors: Array<{
    name: string;
    avgRate: number;
    recordCount: number;
    businessSize: string;
  }>;
  naicsCode: string;
  naicsDescription: string;
  searchTermsUsed: string[];
  totalRecordsAnalyzed: number;
  queryDate: string;
}

function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  // Linear interpolation between ranks (numpy/Excel PERCENTILE.INC method). The old
  // nearest-rank (Math.ceil) collapsed p25 and p50 to the same value for small
  // samples — e.g. a 2-record category showed identical 25th %ile and median.
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Fetch pricing intelligence for a given NAICS code.
 * Makes 2-3 CALC+ API calls and returns aggregated analysis.
 */
export async function fetchPricingIntel(naicsCode: string): Promise<PricingIntelData | null> {
  const searchTerms = getSearchTermsForNAICS(naicsCode);
  const label = NAICS_TITLES[naicsCode]?.title || `NAICS ${naicsCode}`;
  return runPricingIntel(searchTerms, naicsCode, label);
}

/**
 * Fetch pricing intelligence by labor-category keyword(s) — the NATIVE CALC way
 * (CALC has no NAICS; you search by the role you staff). Accepts comma-separated
 * roles, e.g. "Software Engineer, Project Manager". More accurate than NAICS→keyword
 * translation because it queries the exact labor categories the user is pricing.
 */
export async function fetchPricingIntelByKeywords(rawKeywords: string): Promise<PricingIntelData | null> {
  const terms = rawKeywords.split(',').map((s) => s.trim()).filter((s) => s.length >= 2).slice(0, 4);
  if (terms.length === 0) return null;
  return runPricingIntel(terms, '', terms.join(', '));
}

async function runPricingIntel(searchTerms: string[], naicsCode: string, naicsDescription: string): Promise<PricingIntelData | null> {
  console.log(`[CALC+] Pricing intel — terms: ${searchTerms.join(', ')}${naicsCode ? ` (NAICS ${naicsCode})` : ''}`);

  // Fetch the FULL record set for each term by paginating (the API caps at 20/
  // page). This is what makes the labor-category table complete — we walk all
  // pages, not just the first 20. Primary term gets full pagination; the small/
  // large-biz splits also paginate (for the business-size comparison). Aggregations
  // come from page 1 (server-computed over ALL records — still correct).
  const termQueries = searchTerms.slice(0, 3).map(term =>
    queryCalcAPIAllPages({ keyword: term })
      .then(out => ({ term, out, error: null as string | null }))
      .catch(err => ({ term, out: null as { records: CalcRateRecord[]; total: number; aggregations: CalcApiResponse['aggregations'] } | null, error: String(err) }))
  );

  // Biz-size splits only need a representative median, not the full table —
  // cap at 10 pages (200 records) to save API calls.
  const sbQuery = queryCalcAPIAllPages({ keyword: searchTerms[0], businessSize: 'S', maxPages: 10 })
    .then(r => ({ results: r.records, error: null as string | null }))
    .catch(err => ({ results: [] as CalcRateRecord[], error: String(err) }));

  const lgQuery = queryCalcAPIAllPages({ keyword: searchTerms[0], businessSize: 'O', maxPages: 10 })
    .then(r => ({ results: r.records, error: null as string | null }))
    .catch(err => ({ results: [] as CalcRateRecord[], error: String(err) }));

  const [termResults, sbResult, lgResult] = await Promise.all([
    Promise.all(termQueries),
    sbQuery,
    lgQuery,
  ]);

  // Combine search term results (full paginated record sets)
  const allRecords: CalcRateRecord[] = [];
  const seenIds = new Set<string>();

  for (const { term, out, error } of termResults) {
    if (error || !out) {
      console.error(`[CALC+] Error querying "${term}": ${error}`);
      continue;
    }
    console.log(`[CALC+] "${term}": ${out.total} total, ${out.records.length} fetched (all pages)`);
    for (const rec of out.records) {
      const key = `${rec.vendor_name}:${rec.labor_category}:${rec.current_price}`;
      if (!seenIds.has(key)) {
        seenIds.add(key);
        allRecords.push(rec);
      }
    }
  }

  console.log(`[CALC+] Total unique records: ${allRecords.length}`);
  if (allRecords.length === 0) return null;

  const smallBizRecords = sbResult.results;
  const largeBizRecords = lgResult.results;

  // Aggregate by labor category
  const categoryMap = new Map<string, number[]>();
  const categoryNextYear = new Map<string, number[]>();

  for (const rec of allRecords) {
    const cat = rec.labor_category.trim();
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, []);
      categoryNextYear.set(cat, []);
    }
    if (rec.current_price > 0) categoryMap.get(cat)!.push(rec.current_price);
    if (rec.next_year_price && rec.next_year_price > 0) categoryNextYear.get(cat)!.push(rec.next_year_price);
  }

  // Build sorted category summaries
  const laborCategories: LaborCategorySummary[] = [];
  for (const [cat, prices] of categoryMap.entries()) {
    if (prices.length < 2) continue; // need ≥2 points for a meaningful per-category
    // spread (now that we paginate the FULL record set, real categories like
    // "Senior Accountant" have 30+ records — no longer nuked to a single survivor).
    const sorted = [...prices].sort((a, b) => a - b);
    const nextPrices = categoryNextYear.get(cat) || [];
    const nextSorted = [...nextPrices].sort((a, b) => a - b);

    laborCategories.push({
      category: cat,
      recordCount: prices.length,
      median: computePercentile(sorted, 50),
      percentile25: computePercentile(sorted, 25),
      percentile75: computePercentile(sorted, 75),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: prices.reduce((s, p) => s + p, 0) / prices.length,
      nextYearMedian: nextSorted.length > 0 ? computePercentile(nextSorted, 50) : null,
    });
  }

  // Sort by record count (most data = most relevant)
  laborCategories.sort((a, b) => b.recordCount - a.recordCount);

  // Overall rate distribution
  const allPrices = allRecords.map(r => r.current_price).filter(p => p > 0).sort((a, b) => a - b);
  const bucketSize = 25;
  const maxBucket = Math.ceil((allPrices[allPrices.length - 1] || 300) / bucketSize) * bucketSize;
  const rateDistribution: Array<{ range: string; count: number }> = [];
  for (let start = 0; start < Math.min(maxBucket, 500); start += bucketSize) {
    const end = start + bucketSize;
    const count = allPrices.filter(p => p >= start && p < end).length;
    if (count > 0) {
      rateDistribution.push({ range: `$${start}-${end}`, count });
    }
  }

  // Business size comparison
  const sbPrices = smallBizRecords.map(r => r.current_price).filter(p => p > 0).sort((a, b) => a - b);
  const lgPrices = largeBizRecords.map(r => r.current_price).filter(p => p > 0).sort((a, b) => a - b);
  const sbMedian = sbPrices.length > 0 ? computePercentile(sbPrices, 50) : 0;
  const lgMedian = lgPrices.length > 0 ? computePercentile(lgPrices, 50) : 0;
  const sbAvg = sbPrices.length > 0 ? sbPrices.reduce((s, p) => s + p, 0) / sbPrices.length : 0;
  const lgAvg = lgPrices.length > 0 ? lgPrices.reduce((s, p) => s + p, 0) / lgPrices.length : 0;

  // Top vendors by average rate
  const vendorMap = new Map<string, { rates: number[]; size: string }>();
  for (const rec of allRecords) {
    if (!vendorMap.has(rec.vendor_name)) {
      vendorMap.set(rec.vendor_name, { rates: [], size: rec.business_size });
    }
    if (rec.current_price > 0) vendorMap.get(rec.vendor_name)!.rates.push(rec.current_price);
  }

  const topVendors = Array.from(vendorMap.entries())
    .filter(([, v]) => v.rates.length >= 2)
    .map(([name, v]) => ({
      name,
      avgRate: v.rates.reduce((s, r) => s + r, 0) / v.rates.length,
      recordCount: v.rates.length,
      businessSize: v.size === 'S' ? 'Small' : 'Other',
    }))
    .sort((a, b) => b.recordCount - a.recordCount)
    .slice(0, 15);

  // Price-to-win guidance. PREFER the SERVER-COMPUTED aggregations from the
  // CALC API (computed over ALL matching records — e.g. 683 for "accountant"),
  // NOT computePercentile over allPrices. allPrices is only the ~20 hits the API
  // returns per page (it ignores page_size + doesn't paginate), and they cluster
  // at the cheap end — which produced a $40 "median" for accountants whose REAL
  // median is $102. The aggregations.histogram_percentiles / median_price are the
  // true distribution. Fall back to the local computation only if absent.
  const agg = termResults.find((t) => t.out?.aggregations)?.out?.aggregations;
  const aggPct = agg?.histogram_percentiles?.values;
  const aggMedian = agg?.median_price?.values?.['50.0'];
  const aggCount = agg?.wage_stats?.count;
  const p25 = aggPct?.['25.0'] ?? computePercentile(allPrices, 25);
  const p50 = aggMedian ?? aggPct?.['50.0'] ?? computePercentile(allPrices, 50);
  const p75 = aggPct?.['75.0'] ?? computePercentile(allPrices, 75);
  // Real total record count for the headline (server count, not the page slice).
  const realRecordCount = aggCount ?? allRecords.length;

  return {
    laborCategories: laborCategories.slice(0, 25),
    businessSizeComparison: {
      smallBusiness: { median: sbMedian, count: sbPrices.length, avg: sbAvg },
      largeBusiness: { median: lgMedian, count: lgPrices.length, avg: lgAvg },
      gapPercent: lgMedian > 0 ? ((lgMedian - sbMedian) / lgMedian) * 100 : 0,
    },
    rateDistribution,
    priceToWinGuidance: {
      aggressiveRate: p25,
      competitiveRate: p50,
      premiumRate: p75,
    },
    topVendors,
    naicsCode,
    naicsDescription,
    searchTermsUsed: searchTerms.slice(0, 4),
    totalRecordsAnalyzed: realRecordCount,
    queryDate: new Date().toISOString(),
  };
}
