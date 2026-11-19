/**
 * Two clocks for /agencies/[slug].
 *
 * Next lowers a route's revalidate to the shortest unstable_cache inside it.
 * The intelligence read is therefore 1 day, and the BigQuery award read stays
 * in its own 7-day cache so a daily page regeneration does not rescan awards.
 * The check time is recorded inside the intelligence callback, which is the
 * fetch time a later render displays.
 */
import { unstable_cache } from 'next/cache';
import {
  getAgencyProfile,
  getSubAgenciesForAgency,
  getTopNaicsForAgency,
  getTopRecipientsForAgency,
  type AgencyProfile,
  type SubAgencyRow,
  type TopNaicsForAgency,
  type TopRecipientForAgency,
} from '@/lib/bigquery/agencies';
import { getAgencySourcedIntelligence } from '@/lib/strategic-intel/sourced-pain-points';
import { selectPublicSourced, type PublicSourcedClaim } from '@/lib/seo/public-agency-pages';

export const AGENCY_INTEL_REVALIDATE_SECONDS = 86_400;
export const AGENCY_AWARD_REVALIDATE_SECONDS = 604_800;

export function agencyIntelCacheConfig(agencyName: string) {
  return {
    key: ['public-agency-sourced-intel', agencyName] as const,
    revalidate: AGENCY_INTEL_REVALIDATE_SECONDS,
    tags: [`agency-intel:${agencyName}`],
  };
}

export function agencyAwardCacheConfig(bqAgencyName: string) {
  return {
    key: ['agency-page-bq-awards', bqAgencyName] as const,
    revalidate: AGENCY_AWARD_REVALIDATE_SECONDS,
    tags: [`agency-bq:${bqAgencyName}`],
  };
}

export interface CachedAgencyIntel {
  ok: boolean;
  sourced: PublicSourcedClaim[];
  /** ISO time the reader ran. Stored with the cached payload. */
  checkedAt: string;
}

async function readPublicAgencyIntel(agencyName: string): Promise<CachedAgencyIntel> {
  const checkedAt = new Date().toISOString();
  try {
    const bundle = await getAgencySourcedIntelligence(agencyName);
    if (bundle.meta.sourcedReadFailed) return { ok: false, sourced: [], checkedAt };
    return { ok: true, sourced: selectPublicSourced(bundle.sourced), checkedAt };
  } catch {
    return { ok: false, sourced: [], checkedAt };
  }
}

export function cachedPublicAgencyIntel(agencyName: string): Promise<CachedAgencyIntel> {
  const config = agencyIntelCacheConfig(agencyName);
  return unstable_cache(
    () => readPublicAgencyIntel(agencyName),
    [...config.key],
    { revalidate: config.revalidate, tags: [...config.tags] },
  )();
}

export interface CachedAgencyAwards {
  profile: AgencyProfile | null;
  recipients: TopRecipientForAgency[];
  naics: TopNaicsForAgency[];
  subAgencies: SubAgencyRow[];
}

export function cachedAgencyAwards(bqAgencyName: string): Promise<CachedAgencyAwards> {
  const config = agencyAwardCacheConfig(bqAgencyName);
  return unstable_cache(
    async () => {
      const [profile, recipients, naics, subAgencies] = await Promise.all([
        getAgencyProfile(bqAgencyName).catch(() => null),
        getTopRecipientsForAgency(bqAgencyName, 25).catch(() => [] as TopRecipientForAgency[]),
        getTopNaicsForAgency(bqAgencyName, 15).catch(() => [] as TopNaicsForAgency[]),
        getSubAgenciesForAgency(bqAgencyName, 8).catch(() => [] as SubAgencyRow[]),
      ]);
      return { profile, recipients, naics, subAgencies };
    },
    [...config.key],
    { revalidate: config.revalidate, tags: [...config.tags] },
  )();
}
