/**
 * Agency identity for an oversight.gov office, using only the name that page
 * states plus an explicit alias when that same page names a canonical agency.
 *
 * Applied to NEW oversight inserts only. It is not used by the GAO RSS matcher,
 * and it does not update a row that is already stored.
 */
import { resolveAgency, type AgencyResolution } from '@/lib/strategic-intel/agency-resolver';

export interface OigStatedAlias {
  /** Name left after stripping a trailing "OIG", as oversight.gov prints the office. */
  stated: string;
  /** A name in src/data/agency-toptier-codes.json. Never a guessed parent. */
  canonical: string;
  citation: string;
}

/**
 * The 14 page-0 recommendations that did not resolve on 2026-11-18 were four
 * offices. Only one of them is a canonical agency under the longer name the
 * same oversight.gov page uses.
 */
export const OIG_STATED_ALIASES: readonly OigStatedAlias[] = [
  {
    stated: 'International Trade Commission',
    canonical: 'U.S. International Trade Commission',
    citation:
      'https://www.oversight.gov/inspectors-general/international-trade-commission-oig (read 2026-11-18) titles the office "International Trade Commission OIG" and says its hotline covers "U.S. International Trade Commission programs and operations" and "USITC employees".',
  },
];

/**
 * Offices on that same page that are their own agency and are not one of the
 * canonical toptier names. A sentence on the EAC page that names the
 * Department of Justice is where to report election crime, not the EAC OIG's
 * parent. A DOT mention on the CPSC page is a referral for vehicle complaints.
 */
export const OIG_STATED_NOT_CANONICAL: readonly { stated: string; citation: string }[] = [
  {
    stated: 'Consumer Product Safety Commission',
    citation:
      'https://www.oversight.gov/inspectors-general/consumer-product-safety-commission-oig (read 2026-11-18) lists Agencies: Consumer Product Safety Commission and https://oig.cpsc.gov/. It is not a component of a canonical department.',
  },
  {
    stated: 'Appalachian Regional Commission',
    citation:
      'https://www.oversight.gov/inspectors-general/appalachian-regional-commission-oig (read 2026-11-18) lists Agencies: Appalachian Regional Commission and https://www.arc.gov/office-of-inspector-general/. It is not a component of a canonical department.',
  },
  {
    stated: 'Election Assistance Commission',
    citation:
      'https://www.oversight.gov/inspectors-general/election-assistance-commission-oig (read 2026-11-18) lists Agencies: Election Assistance Commission and https://oig.eac.gov/. The Department of Justice mention on that page is where to report election crime, not this office\'s parent.',
  },
];

function norm(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function oigStatedAlias(stated: string): OigStatedAlias | null {
  const key = norm(stated);
  return OIG_STATED_ALIASES.find((row) => norm(row.stated) === key) ?? null;
}

/**
 * Resolve the agency name oversight.gov printed. An explicit alias is used
 * only when its target is itself a canonical agency. Otherwise the result
 * stays unresolved.
 */
export function resolveOversightStatedAgency(stated: string): AgencyResolution {
  const direct = resolveAgency({ agencyName: stated });
  if (direct.resolved) return direct;
  const alias = oigStatedAlias(stated);
  if (!alias) return direct;
  const via = resolveAgency({ agencyName: alias.canonical });
  if (!via.resolved || via.canonicalAgency !== alias.canonical) return direct;
  return {
    ...via,
    method: 'alias',
    input: stated,
    note: alias.citation,
  };
}
