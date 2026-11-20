/**
 * /api/sbir agency routing.
 *
 * Default `source` is `nih`. NIH RePORTER answers `agencies: ["NSF"]` with
 * HTTP 200 and total 0 (measured 2026-11-20). That is an empty NIH search,
 * not an NSF result. NSF's own feed, api.www.sbir.gov, returns HTTP 403 and
 * is not collected. Reporting that as count 0 and `_degraded: false` is a
 * reachable-looking zero for a source that was never asked.
 *
 * NIH institutes come from the agency roster (`KNOWN_SUB_AGENCIES`), not a
 * short allowlist. A code the roster does not list still goes to RePORTER.
 * Only a roster entry whose parent is not NIH is treated as a non-NIH source.
 */
import { KNOWN_SUB_AGENCIES } from '@/lib/utils/agency-list-builder';

const NIH_PARENT = 'National Institutes of Health';

export function nihInstituteCodes(): Set<string> {
  const codes = new Set<string>(['NIH']);
  for (const row of KNOWN_SUB_AGENCIES) {
    if (row.abbreviation === 'NIH' || row.parentAgency === NIH_PARENT) {
      codes.add(row.abbreviation.toUpperCase());
    }
  }
  return codes;
}

export type SbirResultState = 'matched' | 'empty' | 'unavailable';

export type SbirAgencyPlan =
  | { kind: 'search'; source: 'nih' | 'multisite' | 'all' }
  | { kind: 'unavailable'; source: string; reason: string };

function norm(agency: string): string {
  return agency.trim().toUpperCase().replace(/\./g, '');
}

export function isNihAgency(agency: string): boolean {
  const a = norm(agency);
  return a.length > 0 && nihInstituteCodes().has(a);
}

function rosterParent(code: string): string | null {
  const row = KNOWN_SUB_AGENCIES.find((entry) => entry.abbreviation.toUpperCase() === code);
  return row ? row.parentAgency : null;
}

/**
 * NSF is unavailable on every source this route can run. A roster agency
 * whose parent is not NIH is a non-NIH source. Every other code, including
 * NIH institutes the roster lists and codes it does not, is sent to RePORTER.
 */
export function planSbirAgency(input: { agency?: string; source?: string }): SbirAgencyPlan {
  const agency = (input.agency || '').trim();
  const source = ((input.source || 'nih').trim().toLowerCase() || 'nih') as 'nih' | 'multisite' | 'all' | string;
  const code = norm(agency);
  const searchSource = source === 'multisite' || source === 'all' ? source : 'nih';

  if (code === 'NSF' || code === 'NATIONAL SCIENCE FOUNDATION') {
    return {
      kind: 'unavailable',
      source: 'nsf',
      reason: 'NSF SBIR is unavailable. api.www.sbir.gov returns HTTP 403, so this feed is not collected. That is not a count of zero NSF opportunities.',
    };
  }

  if (!agency || isNihAgency(agency)) return { kind: 'search', source: searchSource };

  const parent = rosterParent(code);
  if (parent !== null && parent !== NIH_PARENT && source === 'nih') {
    return {
      kind: 'unavailable',
      source: code.toLowerCase(),
      reason: `${code} is not an NIH institute, and this request uses the NIH RePORTER path. That source was not queried. An empty NIH response is not a count of zero ${code} opportunities.`,
    };
  }

  return { kind: 'search', source: searchSource };
}

/** What the briefings panel should show. An empty opportunities array is not, by itself, an empty market. */
export function sbirPanelFromResponse(data: {
  opportunities?: unknown[] | null;
  result_state?: string;
  unavailable_reason?: string;
  _degraded?: boolean;
  count?: number | null;
  error?: string;
}): { opportunities: unknown[]; unavailableReason: string | null; error: string | null } {
  if (data.error) return { opportunities: [], unavailableReason: null, error: data.error };
  if (data.result_state === 'unavailable' || (data._degraded === true && data.count == null)) {
    return {
      opportunities: [],
      unavailableReason: data.unavailable_reason
        || 'This SBIR source is unavailable. That is not a count of zero opportunities.',
      error: null,
    };
  }
  return { opportunities: Array.isArray(data.opportunities) ? data.opportunities : [], unavailableReason: null, error: null };
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
