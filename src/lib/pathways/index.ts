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
  input: MatchCompanyToPathwaysInput & { actor?: string },
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
  result._meta.identity_resolution = loaded.identity.resolution;
  result._meta.identity_note = loaded.identity.note;
  result._meta.identity_candidates = loaded.identity.candidates;

  if (!loaded.company.uei) {
    result._meta.grounded = false;
    result.summary.no_proven_door = true;
    if (loaded.identity.resolution === 'ambiguous') {
      result.summary.headline =
        loaded.identity.note ||
        'Several award-warehouse recipients match that name. I will not pick one — pass the legal entity or its UEI.';
    } else if (loaded.identity.resolution === 'none_in_award_corpus') {
      result.summary.headline =
        loaded.identity.note ||
        'That name is not in the award-warehouse index. That is not proof the company has no federal awards.';
    } else if (loaded.identity.resolution === 'degraded') {
      result.summary.headline =
        'Company name lookup was unavailable — not a measured miss. Pass a UEI or retry.';
    } else if (loaded.identity.resolution === 'malformed') {
      result.summary.headline = loaded.identity.note || 'UEI must be exactly 12 alphanumeric characters.';
    } else {
      result.summary.headline =
        'I need a valid UEI or a unique company name to match stranger-verifiable public evidence to these acquisition doors.';
    }
  }
  return result;
}
