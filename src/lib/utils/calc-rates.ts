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
}): Promise<CalcApiResponse> {
  const url = new URL(CALC_API);
  if (params.keyword) url.searchParams.set('keyword', params.keyword);
  if (params.businessSize) url.searchParams.set('filter', `business_size:${params.businessSize}`);
  url.searchParams.set('page_size', String(params.pageSize || 100));
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

  // Run ALL queries in parallel for speed (avoid sequential timeout issues)
  const termQueries = searchTerms.slice(0, 3).map(term =>
    queryCalcAPI({ keyword: term, pageSize: 100 })
      .then(result => ({ term, result, error: null as string | null }))
      .catch(err => ({ term, result: null as CalcApiResponse | null, error: String(err) }))
  );

  const sbQuery = queryCalcAPI({ keyword: searchTerms[0], businessSize: 'S', pageSize: 100 })
    .then(r => ({ results: r.hits.hits.map(h => h._source), error: null as string | null }))
    .catch(err => ({ results: [] as CalcRateRecord[], error: String(err) }));

  const lgQuery = queryCalcAPI({ keyword: searchTerms[0], businessSize: 'O', pageSize: 100 })
    .then(r => ({ results: r.hits.hits.map(h => h._source), error: null as string | null }))
    .catch(err => ({ results: [] as CalcRateRecord[], error: String(err) }));

  const [termResults, sbResult, lgResult] = await Promise.all([
    Promise.all(termQueries),
    sbQuery,
    lgQuery,
  ]);

  // Combine search term results
  const allRecords: CalcRateRecord[] = [];
  const seenIds = new Set<string>();

  for (const { term, result, error } of termResults) {
    if (error || !result) {
      console.error(`[CALC+] Error querying "${term}": ${error}`);
      continue;
    }
    const hits = result.hits.hits;
    console.log(`[CALC+] "${term}": ${result.hits.total.value} total, ${hits.length} returned`);
    for (const hit of hits) {
      const rec = hit._source;
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
    if (prices.length < 2) continue; // Need at least 2 data points
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

  // Price-to-win guidance from overall percentiles
  const p25 = computePercentile(allPrices, 25);
  const p50 = computePercentile(allPrices, 50);
  const p75 = computePercentile(allPrices, 75);

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
    totalRecordsAnalyzed: allRecords.length,
    queryDate: new Date().toISOString(),
  };
}
