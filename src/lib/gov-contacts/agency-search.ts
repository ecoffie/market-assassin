/**
 * Agency-aware free-text search for the Decision Makers directory.
 *
 * The Government Decision Makers panel searched ONLY contact_fullname +
 * contact_title, with no acronym/alias resolution (Eric QC: "i can't find usda
 * or forest"). federal_contacts stores civilian POCs under the PARENT department
 * ("AGRICULTURE, DEPARTMENT OF"), so a user typing the acronym "USDA" — or a
 * sub-agency like "Forest Service" — matched NOTHING (2,866 Agriculture contacts
 * were invisible; the lone "usda" hit was a junk record literally named
 * "USDA-FAS USDA-FAS").
 *
 * This maps a search term to the distinctive DEPARTMENT keyword(s) to ALSO match
 * on department_ind_agency, using the maintained agency-aliases.json (USDA →
 * Department of Agriculture; USFS → Department of Agriculture) plus a small
 * spelled-out sub-agency phrase map. Ordinary words (a person named "Forest")
 * resolve to [] and stay a pure name search.
 */
import agencyAliases from '@/data/agency-aliases.json';

const ALIASES: Record<string, string> =
  (agencyAliases as { aliases?: Record<string, string> }).aliases || {};
const PARENTS: Record<string, string> =
  (agencyAliases as { parentMappings?: Record<string, string> }).parentMappings || {};

/**
 * A full agency name → the single distinctive token to ILIKE against
 * department_ind_agency. federal_contacts stores e.g. "AGRICULTURE, DEPARTMENT
 * OF", so we want "Agriculture" (not "Department of Agriculture", which isn't a
 * substring). Connector words are stripped so multi-word names collapse to their
 * lead token: "Department of Housing and Urban Development" → "Housing" (matches
 * "HOUSING AND URBAN DEVELOPMENT").
 */
export function agencyKeyword(fullName: string): string {
  const cleaned = (fullName || '')
    .replace(/\([^)]*\)/g, ' ') // drop parenthetical abbrevs "(VHA)"
    .replace(
      /\b(u\.?s\.?|united states|department|dept|of|the|office|bureau|service|administration|agency|federal|national|for|and|&)\b/gi,
      ' ',
    )
    .replace(/[^a-z0-9 ]/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned.split(' ')[0] || '';
}

// Spelled-out sub-agency PHRASES → parent-department keyword. Acronyms come from
// agency-aliases.json; these catch the words a user actually types. Civilian
// only — DoD sub-agencies are anchored by DoDAAC elsewhere in the route.
const PHRASE_TO_DEPT: Array<{ re: RegExp; kw: string }> = [
  { re: /forest service|forestry|agricultural research|natural resources conservation|rural development|farm service|food safety|animal (and|&) plant|agricultur/i, kw: 'Agriculture' },
  { re: /land management|national park|fish (and|&) wildlife|geological survey|indian affairs|reclamation|ocean energy|surface mining/i, kw: 'Interior' },
  { re: /census|patent|trademark|oceanic|weather|standards|economic analysis|industry (and|&) security/i, kw: 'Commerce' },
];

/**
 * A free-text search term → distinctive DEPARTMENT keyword(s) to also match on
 * department_ind_agency when the term names or abbreviates a federal agency.
 *   "usda"          → ["Agriculture"]
 *   "USFS" / "forest service" → ["Agriculture"] (+ harmless "Forest")
 *   "hud"           → ["Housing"]
 *   "forest"        → []   (ordinary word → stays a name search)
 */
export function agencySearchKeywords(term: string): string[] {
  const t = (term || '').trim();
  if (t.length < 2) return [];
  const up = t.toUpperCase();
  const out = new Set<string>();
  // 1. Whole-term acronym/alias (USDA, USFS, HUD, EPA…) — prefer the PARENT dept
  //    so a sub-agency resolves to where its contacts actually live.
  const mapped = PARENTS[up] || ALIASES[up];
  if (mapped) {
    const kw = agencyKeyword(mapped);
    if (kw.length >= 3) out.add(kw);
  }
  // 2. Spelled-out sub-agency phrase (forest service, land management…).
  for (const p of PHRASE_TO_DEPT) if (p.re.test(t)) out.add(p.kw);
  return [...out];
}
