/**
 * Does a saved profile agency ("VA", "NIST", "Navy") name the buyer on a SAM notice?
 *
 * ⚠️ WHY THIS EXISTS. Alert scoring used `\`${department} ${subTier}\`.toLowerCase().includes(a)`.
 * Measured on a real customer's Sep 24 2026 alert:
 *   - "NIST" matched FDA and the Federal Highway Administration — "admi-NIST-ration".
 *   - "VA" never matched "VETERANS AFFAIRS, DEPARTMENT OF" (no alias resolution), while
 *     substring "va" does match "NAVAL …".
 *   - "State" matches "UNITED STATES …".
 * Each false hit was worth +30 of ranking, so the wrong notices led the email.
 *
 * Contract (same as src/lib/strategic-intel/agency-resolver.ts):
 *   1. Matching is ANCHORED — whole normalized organisation names, never `includes`.
 *   2. Department identity goes through the canonical resolver (aliases + "X, DEPARTMENT OF").
 *   3. Sub-agencies (NIST, FAA, Navy…) match the notice's sub-tier by their curated
 *      full name from agency-aliases.json.
 *   4. Unresolved stays unmatched — no fuzzy fallback.
 */
import AGENCY_ALIASES from '@/data/agency-aliases.json';
import { resolveAgency } from '@/lib/strategic-intel/agency-resolver';

const ALIASES = (AGENCY_ALIASES as { aliases: Record<string, string> }).aliases;

/** Uppercase, drop parentheticals/punctuation and the "Department of (the)" wrapper. */
export function normalizeOrgName(raw: string | null | undefined): string {
  let s = String(raw || '').toUpperCase();
  s = s.replace(/\([^)]*\)/g, ' ').replace(/&/g, ' AND ');
  s = s.replace(/[.,;:'"]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\bDEPARTMENT OF$/, '').trim();                      // "COMMERCE, DEPARTMENT OF"
  s = s.replace(/^(?:THE )?(?:DEPARTMENT|DEPT) OF (?:THE )?/, '');     // "DEPT OF THE NAVY"
  s = s.replace(/^U S /, '').replace(/^US /, '');                      // "U.S. PATENT AND …"
  return s.replace(/\s+/g, ' ').trim();
}

function aliasFor(term: string): string | null {
  const t = term.trim();
  return ALIASES[t] ?? ALIASES[t.toUpperCase()] ?? null;
}

function toptierOf(name: string | null | undefined): string | null {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const direct = resolveAgency({ agencyName: raw });
  if (direct.canonicalAgency) return direct.canonicalAgency;
  // SAM writes some departments as "DEPT OF DEFENSE" rather than "DEFENSE, DEPARTMENT OF".
  const m = raw.toUpperCase().match(/^(?:DEPT|DEPARTMENT) OF (?:THE )?(.+)$/);
  if (m) return resolveAgency({ agencyName: `${m[1]}, DEPARTMENT OF` }).canonicalAgency;
  return null;
}

interface ProfileAgencyIdentity {
  term: string;
  toptier: string | null;
  orgNames: Set<string>;
}

const identityCache = new Map<string, ProfileAgencyIdentity>();

export function profileAgencyIdentity(term: string): ProfileAgencyIdentity {
  const key = term.trim();
  const hit = identityCache.get(key);
  if (hit) return hit;
  const alias = aliasFor(key);
  const orgNames = new Set<string>();
  if (alias) orgNames.add(normalizeOrgName(alias));
  // A spelled-out name the user typed ("Commerce", "Federal Aviation Administration")
  // is its own org name. A bare 2–4 letter abbreviation is NOT — "VA" as an org name
  // would be the same substring trap this module exists to remove.
  if (key.length > 4 || /\s/.test(key)) orgNames.add(normalizeOrgName(key));
  orgNames.delete('');
  const id: ProfileAgencyIdentity = { term: key, toptier: resolveAgency({ agencyName: key }).canonicalAgency, orgNames };
  identityCache.set(key, id);
  return id;
}

/** The profile agencies that name this notice's buyer, each by an anchored rule. */
export function matchProfileAgencies(
  profileAgencies: string[] | null | undefined,
  department: string | null | undefined,
  subTier: string | null | undefined,
): string[] {
  const list = (profileAgencies || []).map((a) => String(a || '').trim()).filter(Boolean);
  if (list.length === 0) return [];
  const deptTop = toptierOf(department);
  const deptName = normalizeOrgName(department);
  const subName = normalizeOrgName(subTier);
  const out: string[] = [];
  for (const term of list) {
    const id = profileAgencyIdentity(term);
    const byDepartment = !!id.toptier && !!deptTop && id.toptier === deptTop;
    const byOrg = (!!subName && id.orgNames.has(subName)) || (!!deptName && id.orgNames.has(deptName));
    if (byDepartment || byOrg) out.push(term);
  }
  return out;
}
