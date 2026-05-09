import { createClient } from '@supabase/supabase-js';
import {
  getContractorByName,
  searchContractors,
  type Contractor,
} from '@/lib/contractor-database';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

const COMPANY_SUFFIX_RE = /\b(incorporated|inc|llc|l\.l\.c|corp|corporation|co|company|ltd|limited|lp|llp|pllc|pc)\b/gi;

export interface ContractorAwardHistoryRow {
  award_id: string;
  recipient_name: string;
  award_amount: number | string | null;
  awarding_agency: string | null;
  awarding_sub_agency: string | null;
  contract_type: string | null;
  naics_code: string | null;
  naics_description: string | null;
  pop_state: string | null;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  usaspending_id: string | null;
  synced_at: string | null;
}

export interface ContractorSalesHistoryOptions {
  company: string;
  publicView?: boolean;
  awardLimit?: number;
}

export interface ContractorSalesHistory {
  success: boolean;
  source: 'usaspending_cache' | 'contractor_database' | 'unavailable';
  coverage: 'cached' | 'limited' | 'none' | 'unavailable';
  lastUpdated: string | null;
  contractor: {
    company: string;
    slug: string;
    naics: string[];
    agencies: string[];
    totalContractValue: number;
    contractCount: number;
    hasContact: boolean;
    hasEmail: boolean;
    hasPhone: boolean;
  };
  match: {
    method: 'recipient_name' | 'contractor_database';
    confidence: 'high' | 'medium' | 'low' | 'none';
    name: string;
  };
  summary: {
    totalObligations: number;
    awardCount: number;
    latestFiscalYear: number | null;
    topAgency: string | null;
    averageAwardSize: number;
  };
  series: Array<{
    fiscalYear: number;
    totalObligations: number;
    awardCount: number;
    agencyBreakdown: Array<{ agency: string; amount: number; count: number }>;
  }>;
  topAgencies: Array<{ agency: string; amount: number; count: number }>;
  topNaics: Array<{ naics: string; description: string | null; amount: number; count: number }>;
  recentAwards: Array<{
    id: string;
    title: string;
    agency: string;
    subAgency: string | null;
    naics: string | null;
    naicsDescription: string | null;
    amount: number;
    startDate: string | null;
    endDate: string | null;
    state: string | null;
    url: string | null;
  }>;
  gated: {
    fullHistory: boolean;
    contacts: boolean;
    workflowActions: boolean;
    exports: boolean;
  };
  message?: string;
}

export function slugifyContractorName(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export function getContractorSlug(contractor: Pick<Contractor, 'company'>) {
  return slugifyContractorName(contractor.company);
}

export function normalizeCompanyName(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(COMPANY_SUFFIX_RE, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findContractorBySlug(slug: string) {
  const normalizedSlug = slug.toLowerCase().trim();
  const exact = searchContractors({ limit: 5000 }).contractors.find((contractor) => (
    getContractorSlug(contractor) === normalizedSlug
  ));
  return exact || null;
}

function parseList(value: string | undefined | null) {
  if (!value || value === 'N/A') return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseContractCount(value: string | undefined | null) {
  if (!value) return 0;
  const parsed = Number.parseInt(value.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function amountToNumber(value: number | string | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatCompactCurrency(value: number) {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

function getFiscalYear(dateValue: string | null) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  const month = date.getUTCMonth() + 1;
  return month >= 10 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
}

function toContractorSummary(contractor: Contractor) {
  return {
    company: contractor.company,
    slug: getContractorSlug(contractor),
    naics: parseList(contractor.naics),
    agencies: parseList(contractor.agencies),
    totalContractValue: contractor.contract_value_num || 0,
    contractCount: parseContractCount(contractor.contract_count),
    hasContact: contractor.has_contact,
    hasEmail: contractor.has_email,
    hasPhone: contractor.has_phone,
  };
}

function getQueryCandidates(company: string) {
  const trimmed = company.trim();
  const normalized = normalizeCompanyName(trimmed);
  const candidates = [trimmed];

  if (normalized && normalized !== trimmed.toLowerCase()) {
    candidates.push(normalized);
  }

  const words = normalized.split(' ').filter((word) => word.length > 2);
  if (words.length >= 2) candidates.push(words.slice(0, 2).join(' '));
  if (words.length >= 1) candidates.push(words[0]);

  return Array.from(new Set(candidates.filter(Boolean)));
}

async function fetchCachedAwards(company: string) {
  if (!supabase) {
    return { data: [] as ContractorAwardHistoryRow[], error: 'Database not configured' };
  }

  for (const candidate of getQueryCandidates(company)) {
    const { data, error } = await supabase
      .from('usaspending_awards')
      .select('award_id, recipient_name, award_amount, awarding_agency, awarding_sub_agency, contract_type, naics_code, naics_description, pop_state, start_date, end_date, description, usaspending_id, synced_at')
      .ilike('recipient_name', `%${candidate}%`)
      .order('start_date', { ascending: false })
      .limit(500);

    if (error) {
      return { data: [] as ContractorAwardHistoryRow[], error: error.message };
    }

    if (data?.length) {
      return { data: data as ContractorAwardHistoryRow[], error: null };
    }
  }

  return { data: [] as ContractorAwardHistoryRow[], error: null };
}

function getMatchConfidence(company: string, awards: ContractorAwardHistoryRow[]) {
  if (!awards.length) {
    return {
      method: 'contractor_database' as const,
      confidence: 'none' as const,
      name: company,
    };
  }

  const normalizedCompany = normalizeCompanyName(company);
  const recipientName = awards[0]?.recipient_name || company;
  const normalizedRecipient = normalizeCompanyName(recipientName);

  if (normalizedCompany && normalizedRecipient && normalizedCompany === normalizedRecipient) {
    return { method: 'recipient_name' as const, confidence: 'high' as const, name: recipientName };
  }

  if (
    normalizedCompany
    && normalizedRecipient
    && (normalizedCompany.includes(normalizedRecipient) || normalizedRecipient.includes(normalizedCompany))
  ) {
    return { method: 'recipient_name' as const, confidence: 'medium' as const, name: recipientName };
  }

  return { method: 'recipient_name' as const, confidence: 'low' as const, name: recipientName };
}

function buildHistory(
  contractor: Contractor,
  awards: ContractorAwardHistoryRow[],
  options: ContractorSalesHistoryOptions,
  databaseError?: string | null
): ContractorSalesHistory {
  const contractorSummary = toContractorSummary(contractor);
  const publicView = !!options.publicView;
  const awardLimit = options.awardLimit ?? (publicView ? 5 : 20);
  const sortedAwards = [...awards].sort((a, b) => (
    (b.start_date || '').localeCompare(a.start_date || '')
  ));

  const totalObligations = sortedAwards.reduce((sum, award) => sum + amountToNumber(award.award_amount), 0);
  const syncedDates = sortedAwards
    .map((award) => award.synced_at)
    .filter(Boolean)
    .sort();
  const lastUpdated = syncedDates.length ? syncedDates[syncedDates.length - 1] : null;

  const yearAgency = new Map<number, Map<string, { amount: number; count: number }>>();
  const agencyTotals = new Map<string, { amount: number; count: number }>();
  const naicsTotals = new Map<string, { description: string | null; amount: number; count: number }>();

  for (const award of sortedAwards) {
    const amount = amountToNumber(award.award_amount);
    const fiscalYear = getFiscalYear(award.start_date);
    const agency = award.awarding_agency || 'Unknown agency';

    if (fiscalYear) {
      if (!yearAgency.has(fiscalYear)) yearAgency.set(fiscalYear, new Map());
      const agencyMap = yearAgency.get(fiscalYear)!;
      const current = agencyMap.get(agency) || { amount: 0, count: 0 };
      agencyMap.set(agency, { amount: current.amount + amount, count: current.count + 1 });
    }

    const agencyCurrent = agencyTotals.get(agency) || { amount: 0, count: 0 };
    agencyTotals.set(agency, { amount: agencyCurrent.amount + amount, count: agencyCurrent.count + 1 });

    const naics = award.naics_code || 'Unknown';
    const naicsCurrent = naicsTotals.get(naics) || {
      description: award.naics_description,
      amount: 0,
      count: 0,
    };
    naicsTotals.set(naics, {
      description: naicsCurrent.description || award.naics_description,
      amount: naicsCurrent.amount + amount,
      count: naicsCurrent.count + 1,
    });
  }

  const series = Array.from(yearAgency.entries())
    .map(([fiscalYear, agencyMap]) => {
      const agencyBreakdown = Array.from(agencyMap.entries())
        .map(([agency, data]) => ({ agency, amount: data.amount, count: data.count }))
        .sort((a, b) => b.amount - a.amount);
      return {
        fiscalYear,
        totalObligations: agencyBreakdown.reduce((sum, item) => sum + item.amount, 0),
        awardCount: agencyBreakdown.reduce((sum, item) => sum + item.count, 0),
        agencyBreakdown: agencyBreakdown.slice(0, publicView ? 3 : 5),
      };
    })
    .sort((a, b) => a.fiscalYear - b.fiscalYear)
    .slice(publicView ? -5 : -10);

  const topAgencies = Array.from(agencyTotals.entries())
    .map(([agency, data]) => ({ agency, amount: data.amount, count: data.count }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, publicView ? 3 : 10);

  const topNaics = Array.from(naicsTotals.entries())
    .map(([naics, data]) => ({
      naics,
      description: data.description,
      amount: data.amount,
      count: data.count,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, publicView ? 3 : 10);

  const recentAwards = sortedAwards.slice(0, awardLimit).map((award) => ({
    id: award.award_id,
    title: award.description || award.contract_type || 'Federal award',
    agency: award.awarding_agency || 'Unknown agency',
    subAgency: award.awarding_sub_agency,
    naics: award.naics_code,
    naicsDescription: award.naics_description,
    amount: amountToNumber(award.award_amount),
    startDate: award.start_date,
    endDate: award.end_date,
    state: award.pop_state,
    url: award.usaspending_id ? `https://www.usaspending.gov/award/${award.usaspending_id}` : null,
  }));

  const topAgency = topAgencies[0]?.agency || null;
  const latestSeries = series.length ? series[series.length - 1] : null;
  const latestFiscalYear = latestSeries?.fiscalYear || null;
  const coverage: ContractorSalesHistory['coverage'] = databaseError
    ? 'unavailable'
    : sortedAwards.length > 0
      ? (sortedAwards.length < Math.max(3, contractorSummary.contractCount * 0.05) ? 'limited' : 'cached')
      : 'none';
  const source: ContractorSalesHistory['source'] = databaseError
    ? 'unavailable'
    : sortedAwards.length
      ? 'usaspending_cache'
      : 'contractor_database';

  return {
    success: !databaseError,
    source,
    coverage,
    lastUpdated,
    contractor: contractorSummary,
    match: getMatchConfidence(contractor.company, sortedAwards),
    summary: {
      totalObligations,
      awardCount: sortedAwards.length,
      latestFiscalYear,
      topAgency,
      averageAwardSize: sortedAwards.length ? Math.round(totalObligations / sortedAwards.length) : 0,
    },
    series,
    topAgencies,
    topNaics,
    recentAwards,
    gated: {
      fullHistory: publicView,
      contacts: publicView,
      workflowActions: publicView,
      exports: publicView,
    },
    message: databaseError
      ? databaseError
      : coverage === 'none'
        ? 'No cached federal award history found for this contractor yet.'
        : coverage === 'limited'
          ? 'Cached coverage is limited. Results may not include all federal awards.'
          : undefined,
  };
}

export async function getContractorSalesHistory(options: ContractorSalesHistoryOptions) {
  const contractor = getContractorByName(options.company)
    || searchContractors({ search: options.company, limit: 1 }).contractors[0];

  if (!contractor) {
    return null;
  }

  const { data, error } = await fetchCachedAwards(contractor.company);
  return buildHistory(contractor, data, options, error);
}
