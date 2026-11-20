/**
 * /api/sbir agency routing.
 *
 * Default `source` is `nih`. NIH RePORTER answers `agencies: ["NSF"]` with
 * HTTP 200 and total 0 (measured 2026-11-20). That is an empty NIH search,
 * not an NSF result. NSF's own feed, api.www.sbir.gov, returns HTTP 403 and
 * is not collected. Reporting that as count 0 and `_degraded: false` is a
 * reachable-looking zero for a source that was never asked.
 */

export const NIH_INSTITUTE_CODES = [
  'NIH',
  'NCI',
  'NIAID',
  'NHLBI',
  'NINDS',
  'NIMH',
  'NIGMS',
  'NIDDK',
  'NIEHS',
  'NIA',
  'NICHD',
] as const;

const NIH_AGENCIES = new Set<string>(NIH_INSTITUTE_CODES);

export type SbirResultState = 'matched' | 'empty' | 'unavailable';

export type SbirAgencyPlan =
  | { kind: 'search'; source: 'nih' | 'multisite' | 'all' }
  | { kind: 'unavailable'; source: string; reason: string };

function norm(agency: string): string {
  return agency.trim().toUpperCase().replace(/\./g, '');
}

export function isNihAgency(agency: string): boolean {
  const a = norm(agency);
  return a.length > 0 && NIH_AGENCIES.has(a);
}

/**
 * NSF is unavailable on every source this route can run. Any other non-NIH
 * agency on the default NIH path is the same shape: RePORTER's empty 200 is
 * not that agency's count.
 */
export function planSbirAgency(input: { agency?: string; source?: string }): SbirAgencyPlan {
  const agency = (input.agency || '').trim();
  const source = ((input.source || 'nih').trim().toLowerCase() || 'nih') as 'nih' | 'multisite' | 'all' | string;
  const code = norm(agency);

  if (code === 'NSF' || code === 'NATIONAL SCIENCE FOUNDATION') {
    return {
      kind: 'unavailable',
      source: 'nsf',
      reason: 'NSF SBIR is unavailable. api.www.sbir.gov returns HTTP 403, so this feed is not collected. That is not a count of zero NSF opportunities.',
    };
  }

  if (!agency) return { kind: 'search', source: source === 'multisite' || source === 'all' ? source : 'nih' };

  if (isNihAgency(agency)) {
    return { kind: 'search', source: source === 'multisite' || source === 'all' ? source : 'nih' };
  }

  if (source === 'nih') {
    return {
      kind: 'unavailable',
      source: code.toLowerCase(),
      reason: `${code} is not an NIH institute, and this request uses the NIH RePORTER path. That source was not queried. An empty NIH response is not a count of zero ${code} opportunities.`,
    };
  }

  return { kind: 'search', source: source === 'all' ? 'all' : 'multisite' };
}

export function unavailableSbirBody(input: {
  keyword: string;
  agency: string;
  phase: string;
  limit: number;
  source: string;
  reason: string;
}): Record<string, unknown> {
  return {
    success: true,
    count: null,
    opportunities: [],
    result_state: 'unavailable' satisfies SbirResultState,
    unavailable_reason: input.reason,
    source: input.source,
    searchCriteria: {
      keyword: input.keyword,
      agency: input.agency,
      phase: input.phase,
      source: input.source,
      limit: input.limit,
    },
    _fresh: false,
    _degraded: true,
    _servedAt: null,
  };
}

export function finishedSbirBody(input: {
  keyword: string;
  agency: string;
  phase: string;
  requestedSource: string;
  answeredSource: string;
  opportunities: unknown[];
  limit: number;
}): Record<string, unknown> {
  const count = input.opportunities.length;
  return {
    success: true,
    count,
    opportunities: input.opportunities.slice(0, input.limit),
    result_state: (count === 0 ? 'empty' : 'matched') satisfies SbirResultState,
    ...(count === 0
      ? { empty_reason: 'The queried source returned no rows. That is an empty result, not an unavailable source.' }
      : {}),
    source: input.answeredSource,
    searchCriteria: {
      keyword: input.keyword,
      agency: input.agency,
      phase: input.phase,
      source: input.requestedSource,
      limit: input.limit,
    },
  };
}
