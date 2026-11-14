/**
 * Resolve the office part of an agency phrase ("USACE Memphis District", "NAVSUP FLC Norfolk") to
 * USASpending awarding-office codes, so a search is scoped to that office instead of silently
 * widening to the whole agency.
 *
 * Why (Ask Mindy R3, 2026-11-14): the planner passed agency "USACE Memphis District"; the agency
 * resolver kept "Department of the Army" and dropped "Memphis District", so Army-wide awards were
 * presented as Memphis District awards. For DoD, the awarding office code (DoDAAC, e.g. W912EQ) is
 * the contract-number prefix, which the search can filter on server-side.
 */
import cityCoordsData from '@/data/us-city-coords.json';

type Fetcher = typeof fetch;

/** Words that name the agency itself or are generic office nouns (not a place). */
const AGENCY_WORDS = new Set([
  'usace', 'us', 'u.s.', 'the', 'of', 'and', 'department', 'dept', 'army', 'navy', 'air', 'force', 'space', 'corps', 'engineers', 'engineer',
  'district', 'office', 'center', 'command', 'division', 'region', 'regional', 'contracting', 'activity', 'agency', 'va', 'veterans', 'affairs',
  'navsup', 'navfac', 'flc', 'fleet', 'logistics', 'dla', 'gsa', 'medical', 'healthcare', 'system', 'network', 'nco', 'vamc', 'marine', 'usmc',
  'defense', 'national', 'federal', 'administration', 'service', 'services', 'bureau', 'headquarters', 'hq', 'base', 'station', 'naval', 'af', 'afb',
]);

/** Place/office words left after removing agency words; null when nothing office-specific remains. */
export function officeRemainder(agencyText: string): string | null {
  const words = String(agencyText || '')
    .replace(/[(),.;:/]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const rest = words.filter((w) => !AGENCY_WORDS.has(w.toLowerCase()) && /[a-z]/i.test(w) && w.length >= 3);
  return rest.length ? rest.join(' ') : null;
}

export interface ResolvedOffice { code: string; name: string; subtier: string | null }

/**
 * Candidate awarding offices for the remainder, restricted to the resolved sub-tier agency when
 * known. For engineer districts, names carrying the district marker (ENDIST) are preferred.
 */
export async function resolveAwardingOffices(
  agencyText: string,
  subtierName: string | null,
  fetcher: Fetcher = fetch,
): Promise<{ remainder: string | null; offices: ResolvedOffice[]; error?: string }> {
  const remainder = officeRemainder(agencyText);
  if (!remainder) return { remainder: null, offices: [] };
  try {
    const res = await fetcher('https://api.usaspending.gov/api/v2/autocomplete/awarding_agency_office/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search_text: remainder, limit: 50 }),
    });
    if (!res.ok) return { remainder, offices: [], error: `office lookup HTTP ${res.status}` };
    const data = (await res.json()) as { results?: { office?: Array<{ code?: string; name?: string; subtier_agency?: { name?: string } }> } };
    const up = remainder.toUpperCase();
    let offices = (data.results?.office ?? [])
      .filter((o) => o.code && o.name && o.name.toUpperCase().includes(up))
      .filter((o) => !subtierName || (o.subtier_agency?.name ?? '').toLowerCase() === subtierName.toLowerCase())
      .map((o) => ({ code: String(o.code), name: String(o.name), subtier: o.subtier_agency?.name ?? null }));
    if (/\b(usace|corps of engineers|engineer|district)\b/i.test(agencyText)) {
      const districts = offices.filter((o) => /\bEN ?DIST\b|ENGINEER DIST/i.test(o.name));
      if (districts.length) offices = districts;
    }
    return { remainder, offices: offices.slice(0, 4) };
  } catch (err) {
    return { remainder, offices: [], error: String((err as Error)?.message || err).slice(0, 120) };
  }
}


let CITY_NAMES: Set<string> | null = null;
function cityNames(): Set<string> {
  if (!CITY_NAMES) {
    CITY_NAMES = new Set(Object.keys(cityCoordsData as Record<string, unknown>).map((k) => k.split('|')[0]).filter((c) => c.length >= 4));
  }
  return CITY_NAMES;
}

const OFFICE_MARKER = /\b(district|office|center|command|flc|vamc|medical center|base|station|afb|installation|squadron|wing|depot|arsenal)\b/i;

/**
 * Only treat the leftover words as an office when the phrase reads like an office: it has an office
 * marker, or the leftover names a US city. "Department of Homeland Security" leaves "Homeland
 * Security", which is neither, so the agency filter alone applies (no lookup, nothing reported).
 */
export function looksLikeOffice(agencyText: string, remainder: string | null): boolean {
  if (!remainder) return false;
  if (OFFICE_MARKER.test(agencyText)) return true;
  // A formal agency name ("Department of Homeland Security", "Small Business Administration") is
  // the agency itself; town names like Homeland must not turn it into an office lookup.
  if (/^(the\s+)?(u\.?s\.?\s+)?(department|dept|agency|bureau|office|administration)\s+of\b|\b(administration|agency|bureau|department|commission|service|institute|corporation)$/i.test(agencyText.trim())) return false;
  const words = remainder.toUpperCase().split(/\s+/);
  const names = cityNames();
  for (let i = 0; i < words.length; i++) {
    for (let n = Math.min(3, words.length - i); n >= 1; n--) if (names.has(words.slice(i, i + n).join(' '))) return true;
  }
  return false;
}
