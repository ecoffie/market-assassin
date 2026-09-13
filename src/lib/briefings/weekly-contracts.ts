/**
 * Weekly Deep Dive contract fetch + score.
 *
 * Extracted from precompute-weekly-briefings so regenerate/reconstruct
 * use the same pipeline as the cron. Stage 1 still casts a wide net
 * (expanded NAICS + PSC + keywords). Stage 2 ranks, then the saved-NAICS
 * market boundary keeps only in-market awards. Keyword cannot authorize
 * an outside-industry result.
 */

import { filterMarketToSavedIndustry, naicsInSavedMarket } from '@/lib/alerts/open-contract-d';
import { parseVerifiedDateIso } from './calendar-sanitize';

export type WeeklyContract = {
  contractNumber: string;
  contractName: string;
  agency: string;
  incumbent: string;
  value: number;
  naicsCode: string;
  expirationDate: string;
  daysUntilExpiration: number;
  setAside: string;
  description: string;
  numberOfBids?: number;
  competitionLevel?: string;
  relevanceScore?: number;
  matchFactors?: string[];
};

export type WeeklyContractFetchArgs = {
  savedNaics: string[];
  expandedNaics: string[];
  pscCodes: string[];
  keywords: string[];
  agencies: string[];
};

function daysUntilIso(endDate: string, now = Date.now()): number | null {
  if (!endDate) return null;
  const end = Date.parse(endDate);
  if (!Number.isFinite(end)) return null;
  return Math.ceil((end - now) / 86_400_000);
}

export function scoreWeeklyContract(
  contract: WeeklyContract,
  args: { savedNaics: string[]; pscCodes: string[]; keywords: string[]; agencies: string[] },
): WeeklyContract {
  let score = 0;
  const matchFactors: string[] = [];

  if (naicsInSavedMarket(contract.naicsCode, args.savedNaics)) {
    score += 25;
    matchFactors.push('NAICS');
  }

  const descLower = (contract.description || '').toLowerCase();
  if (args.pscCodes.some((psc) => psc && descLower.includes(psc.toLowerCase()))) {
    score += 15;
    matchFactors.push('PSC');
  }

  const titleLower = (contract.contractName || '').toLowerCase();
  for (const kw of args.keywords) {
    const kwLower = kw.toLowerCase();
    if (!kwLower) continue;
    if (titleLower.includes(kwLower)) {
      score += 20;
      matchFactors.push(`Keyword:${kw}`);
      break;
    }
    if (descLower.includes(kwLower)) {
      score += 10;
      matchFactors.push(`KeywordDesc:${kw}`);
      break;
    }
  }

  const agencyLower = (contract.agency || '').toLowerCase();
  if (args.agencies.some((a) => {
    const needle = a.toLowerCase();
    return needle && (agencyLower.includes(needle) || needle.includes(agencyLower));
  })) {
    score += 15;
    matchFactors.push('Agency');
  }

  if (typeof contract.daysUntilExpiration === 'number' && contract.daysUntilExpiration < 180) {
    score += 10;
    matchFactors.push('Expiring<6mo');
  } else if (typeof contract.daysUntilExpiration === 'number' && contract.daysUntilExpiration < 365) {
    score += 5;
    matchFactors.push('Expiring<1yr');
  }

  if (contract.numberOfBids && contract.numberOfBids <= 2) {
    score += 15;
    matchFactors.push('LowBids');
  }

  if (contract.value >= 10_000_000) {
    score += 10;
    matchFactors.push('Value$10M+');
  } else if (contract.value >= 1_000_000) {
    score += 5;
    matchFactors.push('Value$1M+');
  }

  return {
    ...contract,
    relevanceScore: score,
    matchFactors,
  };
}

export function rankWeeklyContracts(
  raw: WeeklyContract[],
  args: { savedNaics: string[]; pscCodes: string[]; keywords: string[]; agencies: string[] },
  limit = 15,
  now = new Date(),
): WeeklyContract[] {
  const today = now.toISOString().slice(0, 10);
  const current = raw.filter((contract) => {
    const date = parseVerifiedDateIso(contract.expirationDate);
    return Boolean(date && date >= today);
  });
  const scored = current.map((contract) => scoreWeeklyContract(contract, args));
  const inMarket = filterMarketToSavedIndustry(scored, args.savedNaics, (row) => row.naicsCode);
  inMarket.rows.sort((a, b) => {
    if ((b.relevanceScore || 0) !== (a.relevanceScore || 0)) {
      return (b.relevanceScore || 0) - (a.relevanceScore || 0);
    }
    return b.value - a.value;
  });
  return inMarket.rows.slice(0, limit);
}

/**
 * Two-stage fetch + score used by precompute and the regenerate runner.
 */
export async function fetchContractsForProfile(args: WeeklyContractFetchArgs): Promise<WeeklyContract[]> {
  const rawContracts: WeeklyContract[] = [];
  const seenIds = new Set<string>();

  const pushUnique = (contracts: WeeklyContract[]) => {
    for (const c of contracts) {
      if (!c.contractNumber || seenIds.has(c.contractNumber)) continue;
      seenIds.add(c.contractNumber);
      rawContracts.push(c);
    }
  };

  for (const naics of args.expandedNaics.slice(0, 5)) {
    try {
      pushUnique(await fetchUSASpendingContracts({ naics_code: naics }));
    } catch {
      // Continue on error
    }
  }

  for (const psc of args.pscCodes.slice(0, 3)) {
    try {
      pushUnique(await fetchUSASpendingContracts({ psc_code: psc }));
    } catch {
      // Continue on error
    }
  }

  for (const keyword of args.keywords.slice(0, 5)) {
    if (keyword.length < 3) continue;
    try {
      pushUnique(await fetchUSASpendingContracts({ keyword }));
    } catch {
      // Continue on error
    }
  }

  return rankWeeklyContracts(rawContracts, {
    savedNaics: args.savedNaics,
    pscCodes: args.pscCodes,
    keywords: args.keywords,
    agencies: args.agencies,
  });
}

async function fetchUSASpendingContracts(params: {
  naics_code?: string;
  psc_code?: string;
  keyword?: string;
}): Promise<WeeklyContract[]> {
  const contracts: WeeklyContract[] = [];

  const filters: Record<string, unknown> = {
    time_period: [{ start_date: '2022-01-01', end_date: '2027-12-31' }],
    award_type_codes: ['A', 'B', 'C', 'D'],
  };

  if (params.naics_code) {
    filters.naics_codes = { require: [params.naics_code] };
  }
  if (params.psc_code) {
    // FLAT array — { require: [...] } 422s on spending_by_award (FM-05 bug class, 2026-07-28); this
    // silently broke PSC matching in weekly-briefing opportunity fetches.
    filters.psc_codes = [params.psc_code];
  }
  if (params.keyword) {
    filters.keywords = [params.keyword];
  }

  try {
    const response = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filters,
        fields: ['Award ID', 'Recipient Name', 'Start Date', 'End Date', 'Award Amount', 'Awarding Agency', 'generated_internal_id'],
        page: 1,
        limit: 8,
        sort: 'Award Amount',
        order: 'desc',
      }),
    });

    if (!response.ok) return contracts;

    const data = await response.json();
    const awards = data.results || [];

    for (const award of awards.slice(0, 4)) {
      const awardId = award.generated_internal_id || award['Award ID'];
      try {
        const detailRes = await fetch(`https://api.usaspending.gov/api/v2/awards/${awardId}/`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          const contractData = detail.latest_transaction_contract_data || {};
          const periodPerf = detail.period_of_performance || {};
          const endDate = periodPerf.end_date || award['End Date'] || '';
          const daysUntil = daysUntilIso(endDate);
          const numberOfBids = parseInt(contractData.number_of_offers_received || '0', 10) || 0;

          contracts.push({
            contractNumber: detail.piid || award['Award ID'],
            contractName: detail.description || '',
            agency: detail.awarding_agency?.toptier_agency?.name || award['Awarding Agency'] || '',
            incumbent: detail.recipient?.recipient_name || award['Recipient Name'] || '',
            value: detail.total_obligation || Number(award['Award Amount']) || 0,
            naicsCode: detail.latest_transaction_contract_data?.naics || params.naics_code || '',
            expirationDate: endDate || '',
            daysUntilExpiration: daysUntil ?? Number.POSITIVE_INFINITY,
            setAside: contractData.extent_competed_description || 'Full & Open',
            description: detail.description || '',
            numberOfBids,
            competitionLevel: numberOfBids <= 2 ? 'low' : numberOfBids <= 5 ? 'medium' : 'high',
          });
        }
      } catch {
        // Skip individual award errors
      }
    }
  } catch {
    // Skip fetch errors
  }

  return contracts;
}
