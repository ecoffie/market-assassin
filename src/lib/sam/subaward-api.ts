/**
 * SAM.gov Subaward Reporting API
 *
 * Provides prime→sub contractor relationships for teaming intelligence:
 * - Which subs does a prime use?
 * - Which primes use a particular sub?
 * - Teaming networks in specific markets
 */

import {
  SAM_API_CONFIGS,
  makeSAMRequest
} from './utils';

// Types
export interface Subaward {
  subawardId: string;
  primeAwardPiid: string;
  primeAwardeeName: string;
  primeAwardeeUei: string;
  subAwardeeName: string;
  subAwardeeUei: string;
  subAwardAmount: number;
  subAwardDate: string;
  naicsCode: string;
  naicsDescription?: string;
  placeOfPerformanceCity?: string;
  placeOfPerformanceState?: string;
  awarding_agency_name?: string;
}

export interface SubawardSearchParams {
  primeAwardPiid?: string;
  primeAwardeeUei?: string;
  subAwardeeUei?: string;
  naicsCode?: string;
  state?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  size?: number;
}

export interface SubawardSearchResult {
  subawards: Subaward[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  fromCache: boolean;
}

export interface TeamingRelationship {
  primeUei: string;
  primeName: string;
  subUei: string;
  subName: string;
  totalSubawardValue: number;
  subawardCount: number;
  naicsCodes: string[];
  mostRecentDate: string;
}

export interface TeamingNetwork {
  naicsCode: string;
  state?: string;
  primes: Array<{
    uei: string;
    name: string;
    subsUsed: number;
    totalSubawarded: number;
  }>;
  subs: Array<{
    uei: string;
    name: string;
    primesWorkedWith: number;
    totalReceived: number;
  }>;
  relationships: TeamingRelationship[];
}

/**
 * Transform raw API response to our Subaward type
 */
function transformSubaward(raw: Record<string, unknown>): Subaward {
  return {
    subawardId: String(raw.subaward_id || raw.id || ''),
    primeAwardPiid: String(raw.prime_award_piid || ''),
    primeAwardeeName: String(raw.prime_awardee_name || ''),
    primeAwardeeUei: String(raw.prime_awardee_uei || ''),
    subAwardeeName: String(raw.sub_awardee_name || ''),
    subAwardeeUei: String(raw.sub_awardee_uei || ''),
    subAwardAmount: Number(raw.sub_award_amount) || 0,
    subAwardDate: String(raw.sub_award_date || ''),
    naicsCode: String(raw.naics_code || ''),
    naicsDescription: raw.naics_description ? String(raw.naics_description) : undefined,
    placeOfPerformanceCity: raw.place_of_performance_city ? String(raw.place_of_performance_city) : undefined,
    placeOfPerformanceState: raw.place_of_performance_state ? String(raw.place_of_performance_state) : undefined,
    awarding_agency_name: raw.awarding_agency_name ? String(raw.awarding_agency_name) : undefined
  };
}

/**
 * Search subawards
 */
export async function searchSubawards(
  params: SubawardSearchParams
): Promise<SubawardSearchResult> {
  const config = SAM_API_CONFIGS.subaward;

  // Build query parameters
  const queryParams: Record<string, string | number> = {
    page: params.page || 1,
    size: params.size || 50
  };

  if (params.primeAwardPiid) {
    queryParams.prime_award_piid = params.primeAwardPiid;
  }

  if (params.primeAwardeeUei) {
    queryParams.prime_awardee_uei = params.primeAwardeeUei;
  }

  if (params.subAwardeeUei) {
    queryParams.sub_awardee_uei = params.subAwardeeUei;
  }

  if (params.naicsCode) {
    queryParams.naics_code = params.naicsCode;
  }

  if (params.state) {
    queryParams.place_of_performance_state = params.state;
  }

  if (params.dateFrom) {
    queryParams.date_submitted_from = params.dateFrom;
  }

  if (params.dateTo) {
    queryParams.date_submitted_to = params.dateTo;
  }

  const result = await makeSAMRequest<{
    results: Record<string, unknown>[];
    page_metadata?: { total: number; page: number; size: number; hasNext: boolean };
  }>(config, '/subawards', queryParams);

  if (result.error) {
    console.error('[Subaward Search Error]', result.error);
    return {
      subawards: [],
      totalCount: 0,
      page: params.page || 1,
      pageSize: params.size || 50,
      hasMore: false,
      fromCache: false
    };
  }

  const data = result.data;
  const subawards = (data?.results || []).map(transformSubaward);

  return {
    subawards,
    totalCount: data?.page_metadata?.total || subawards.length,
    page: data?.page_metadata?.page || params.page || 1,
    pageSize: data?.page_metadata?.size || params.size || 50,
    hasMore: data?.page_metadata?.hasNext || false,
    fromCache: result.fromCache
  };
}

/**
 * Get all subs for a prime contractor
 */
export async function getSubsForPrime(primeUei: string): Promise<TeamingRelationship[]> {
  const result = await searchSubawards({
    primeAwardeeUei: primeUei,
    size: 100
  });

  // Aggregate by sub
  const subMap = new Map<string, TeamingRelationship>();

  for (const sub of result.subawards) {
    const key = sub.subAwardeeUei;
    const existing = subMap.get(key);

    if (existing) {
      existing.totalSubawardValue += sub.subAwardAmount;
      existing.subawardCount++;
      if (!existing.naicsCodes.includes(sub.naicsCode)) {
        existing.naicsCodes.push(sub.naicsCode);
      }
      if (sub.subAwardDate > existing.mostRecentDate) {
        existing.mostRecentDate = sub.subAwardDate;
      }
    } else {
      subMap.set(key, {
        primeUei: sub.primeAwardeeUei,
        primeName: sub.primeAwardeeName,
        subUei: sub.subAwardeeUei,
        subName: sub.subAwardeeName,
        totalSubawardValue: sub.subAwardAmount,
        subawardCount: 1,
        naicsCodes: [sub.naicsCode].filter(Boolean),
        mostRecentDate: sub.subAwardDate
      });
    }
  }

  return Array.from(subMap.values())
    .sort((a, b) => b.totalSubawardValue - a.totalSubawardValue);
}

/**
 * Get all primes that use a specific sub
 */
export async function getPrimesForSub(subUei: string): Promise<TeamingRelationship[]> {
  const result = await searchSubawards({
    subAwardeeUei: subUei,
    size: 100
  });

  // Aggregate by prime
  const primeMap = new Map<string, TeamingRelationship>();

  for (const sub of result.subawards) {
    const key = sub.primeAwardeeUei;
    const existing = primeMap.get(key);

    if (existing) {
      existing.totalSubawardValue += sub.subAwardAmount;
      existing.subawardCount++;
      if (!existing.naicsCodes.includes(sub.naicsCode)) {
        existing.naicsCodes.push(sub.naicsCode);
      }
      if (sub.subAwardDate > existing.mostRecentDate) {
        existing.mostRecentDate = sub.subAwardDate;
      }
    } else {
      primeMap.set(key, {
        primeUei: sub.primeAwardeeUei,
        primeName: sub.primeAwardeeName,
        subUei: sub.subAwardeeUei,
        subName: sub.subAwardeeName,
        totalSubawardValue: sub.subAwardAmount,
        subawardCount: 1,
        naicsCodes: [sub.naicsCode].filter(Boolean),
        mostRecentDate: sub.subAwardDate
      });
    }
  }

  return Array.from(primeMap.values())
    .sort((a, b) => b.totalSubawardValue - a.totalSubawardValue);
}

/**
 * Build teaming network for a NAICS/state
 */
export async function buildTeamingNetwork(
  naicsCode: string,
  state?: string
): Promise<TeamingNetwork> {
  const result = await searchSubawards({
    naicsCode,
    state,
    size: 100
  });

  const primeMap = new Map<string, {
    uei: string;
    name: string;
    subsUsed: Set<string>;
    totalSubawarded: number;
  }>();

  const subMap = new Map<string, {
    uei: string;
    name: string;
    primesWorkedWith: Set<string>;
    totalReceived: number;
  }>();

  const relationships: TeamingRelationship[] = [];
  const relationshipKey = (primeUei: string, subUei: string) => `${primeUei}:${subUei}`;
  const relationshipMap = new Map<string, TeamingRelationship>();

  for (const sub of result.subawards) {
    // Track primes
    const primeData = primeMap.get(sub.primeAwardeeUei) || {
      uei: sub.primeAwardeeUei,
      name: sub.primeAwardeeName,
      subsUsed: new Set<string>(),
      totalSubawarded: 0
    };
    primeData.subsUsed.add(sub.subAwardeeUei);
    primeData.totalSubawarded += sub.subAwardAmount;
    primeMap.set(sub.primeAwardeeUei, primeData);

    // Track subs
    const subData = subMap.get(sub.subAwardeeUei) || {
      uei: sub.subAwardeeUei,
      name: sub.subAwardeeName,
      primesWorkedWith: new Set<string>(),
      totalReceived: 0
    };
    subData.primesWorkedWith.add(sub.primeAwardeeUei);
    subData.totalReceived += sub.subAwardAmount;
    subMap.set(sub.subAwardeeUei, subData);

    // Track relationships
    const relKey = relationshipKey(sub.primeAwardeeUei, sub.subAwardeeUei);
    const rel = relationshipMap.get(relKey) || {
      primeUei: sub.primeAwardeeUei,
      primeName: sub.primeAwardeeName,
      subUei: sub.subAwardeeUei,
      subName: sub.subAwardeeName,
      totalSubawardValue: 0,
      subawardCount: 0,
      naicsCodes: [],
      mostRecentDate: ''
    };
    rel.totalSubawardValue += sub.subAwardAmount;
    rel.subawardCount++;
    if (!rel.naicsCodes.includes(sub.naicsCode)) {
      rel.naicsCodes.push(sub.naicsCode);
    }
    if (sub.subAwardDate > rel.mostRecentDate) {
      rel.mostRecentDate = sub.subAwardDate;
    }
    relationshipMap.set(relKey, rel);
  }

  return {
    naicsCode,
    state,
    primes: Array.from(primeMap.values())
      .map(p => ({
        uei: p.uei,
        name: p.name,
        subsUsed: p.subsUsed.size,
        totalSubawarded: p.totalSubawarded
      }))
      .sort((a, b) => b.totalSubawarded - a.totalSubawarded)
      .slice(0, 20),
    subs: Array.from(subMap.values())
      .map(s => ({
        uei: s.uei,
        name: s.name,
        primesWorkedWith: s.primesWorkedWith.size,
        totalReceived: s.totalReceived
      }))
      .sort((a, b) => b.totalReceived - a.totalReceived)
      .slice(0, 20),
    relationships: Array.from(relationshipMap.values())
      .sort((a, b) => b.totalSubawardValue - a.totalSubawardValue)
      .slice(0, 50)
  };
}

/**
 * Find potential teaming opportunities for a sub
 * Returns primes in the sub's NAICS that use a lot of subs
 */
export async function findTeamingOpportunities(
  subUei: string,
  naicsCode: string,
  state?: string
): Promise<Array<{
  primeUei: string;
  primeName: string;
  totalSubawardValue: number;
  subsUsed: number;
  alreadyWorksWith: boolean;
}>> {
  // Get network for this NAICS
  const network = await buildTeamingNetwork(naicsCode, state);

  // Get primes this sub already works with
  const existingPrimes = await getPrimesForSub(subUei);
  const existingPrimeUeis = new Set(existingPrimes.map(p => p.primeUei));

  return network.primes.map(prime => ({
    primeUei: prime.uei,
    primeName: prime.name,
    totalSubawardValue: prime.totalSubawarded,
    subsUsed: prime.subsUsed,
    alreadyWorksWith: existingPrimeUeis.has(prime.uei)
  }));
}
