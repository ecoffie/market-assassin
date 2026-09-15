/**
 * PATHWAY FIT v0 — orchestrate pure matcher + live company load.
 */
import {
  caiContextRequiredResult,
  matchCompanyToPathwaysPure,
} from './pathway-fit-match';
import { loadCompanyPublicRecord } from './pathway-fit-load';
import type {
  CaiPackageSlim,
  MatchCompanyToPathwaysInput,
  MatchCompanyToPathwaysResult,
} from './pathway-fit-types';

export type { MatchCompanyToPathwaysInput, MatchCompanyToPathwaysResult, CaiPackageSlim };

function coerceCai(raw: unknown): CaiPackageSlim | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  // Already slim
  const slimScope = o.scope as Record<string, unknown> | undefined;
  const pathways = o.pathways as Record<string, unknown> | undefined;
  if (
    slimScope &&
    pathways &&
    Array.isArray(pathways.observed) &&
    Array.isArray(pathways.potential_not_established) &&
    typeof slimScope.agency === 'string' &&
    typeof slimScope.capability === 'string'
  ) {
    return raw as CaiPackageSlim;
  }

  // Full CAI tool result
  if (pathways && Array.isArray(pathways.observed) && Array.isArray(pathways.potential_not_established)) {
    const sc = (o.scope as Record<string, unknown>) || {};
    const agency = String(sc.agency || o.agency || '');
    const capability = String(sc.capability_label || sc.capability || o.capability || '');
    if (!agency && !capability) return null;
    return {
      scope: {
        agency: agency || 'unknown',
        office: (sc.office as string) || null,
        capability: capability || 'this capability',
        naics: Array.isArray(sc.naics) ? (sc.naics as string[]) : undefined,
        psc: Array.isArray(sc.psc) ? (sc.psc as string[]) : undefined,
        keywords: Array.isArray(sc.keywords) ? (sc.keywords as string[]) : undefined,
      },
      pathways: pathways as CaiPackageSlim['pathways'],
      as_of: typeof o.as_of === 'string' ? o.as_of : null,
    };
  }

  return null;
}

export async function matchCompanyToPathways(
  input: MatchCompanyToPathwaysInput & { cai?: unknown; actor?: string },
): Promise<MatchCompanyToPathwaysResult> {
  const cai = coerceCai(input.cai);
  if (!cai) return caiContextRequiredResult();

  const loaded = await loadCompanyPublicRecord({
    uei: input.uei,
    company_name: input.company_name,
    actor: input.actor,
  });

  const result = matchCompanyToPathwaysPure(cai, loaded.company, {
    include_owner_asserted: Boolean(input.include_owner_asserted),
  });

  result._meta.sources_queried = [...new Set([...result._meta.sources_queried, ...loaded.sources_queried])];
  result._meta.sources_failed = [...loaded.sources_failed];
  result._meta.degraded = loaded.degraded;
  if (!loaded.company.uei) {
    result._meta.grounded = false;
    result.summary.no_proven_door = true;
    result.summary.headline =
      'I need a valid UEI to match stranger-verifiable public evidence to these acquisition doors.';
  }
  return result;
}
