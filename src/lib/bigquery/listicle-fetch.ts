/**
 * fetchTopForListicle — dispatch a ListicleSpec to the right rollup query.
 *
 * Shared by the /top/[slug] page and the snapshot-leaderboards cron so both rank
 * from the exact same source (the topContractorsByDimension rollup, a few MB, KV-
 * cached). Extracted so the cron's snapshot can never drift from what the page shows.
 */
import type { ListicleSpec } from '@/data/top-listicles';
import {
  getTopContractors,
  getTopContractorsByAgency,
  getTopContractorsBySubAgency,
  getTopContractorsByNaics,
  getTopContractorsBySetAside,
  getTopContractorsByState,
  type TopContractorRow,
} from './top-listicles';

export async function fetchTopForListicle(listicle: ListicleSpec, limit = 50): Promise<TopContractorRow[]> {
  switch (listicle.kind) {
    case 'all':
      return getTopContractors(limit);
    case 'agency':
      return getTopContractorsByAgency(listicle.filter || '', limit);
    case 'sub-agency':
      return getTopContractorsBySubAgency(listicle.filterPatterns || [], limit);
    case 'naics':
      return getTopContractorsByNaics(listicle.filter || '', limit);
    case 'set-aside':
      return getTopContractorsBySetAside(listicle.filterPatterns || [], limit);
    case 'state':
      return getTopContractorsByState(listicle.filter || '', limit);
    default:
      return [];
  }
}
