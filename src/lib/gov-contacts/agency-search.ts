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
 * Acronyms whose alias does NOT resolve to the text in department_ind_agency.
 * Measured 2026-07-17: NASA's entry in agency-aliases.json is literally "NASA"
 * (self-referential), so agencyKeyword() returns "NASA" and we search
 * `ILIKE %NASA%` — which finds **0** rows, because the column actually says
 * "NATIONAL AERONAUTICS AND SPACE ADMINISTRATION" (977 contacts). Searching
 * "nasa" in the app returned ONE person — the only one whose job TITLE happened
 * to contain the word.
 *
 * agency-aliases.json is shared by 9 other files, so this overrides here rather
 * than editing that data underneath them.
 */
const DEPT_KEYWORD_OVERRIDE: Record<string, string> = {
  NASA: 'Aeronautics',
};

/**
 * Acronyms whose contacts live under **sub_tier**, not a department keyword.
 *
 * Measured 2026-07-17: DLA's alias is "Department of Defense", so it collapsed to
 * the keyword "Defense" and matched ALL **56,521** DoD contacts. Searching "dla"
 * returned the entire DoD firehose — Air Force, Navy and Army rows — when the
 * 7,890 actual DLA people are identified by sub_tier "DEFENSE LOGISTICS AGENCY".
 * A parent alias is right for a parent lookup and catastrophic for a search.
 *
 * These return sub_tier ONLY, never the parent dept — re-admitting "Defense"
 * would put the firehose straight back and defeat the point.
 *
 * Only DoD sub-tiers with real volume are listed; measured contact counts:
 *   DLA 7,890 · DHA 410 · DISA 254.
 * Deliberately omitted as too thin to be worth an alias: DCMA 5, MDA 20,
 * DARPA 42, NGA 49, DTRA 20, DIA 63 — they already work via the sub_tier ILIKE
 * on the spelled-out name.
 */
const ACRONYM_TO_SUBTIER: Record<string, string> = {
  // DoD
  DLA: 'Defense Logistics',
  DHA: 'Defense Health',
  DISA: 'Information Systems',
  // Civilian. The parent-preference above was built on the belief that civilian
  // POCs are keyed ONLY by parent department — that is not true for the big
  // bureaus. Measured 2026-07-17: sub_tier "FOREST SERVICE" holds 800 contacts,
  // yet "USFS" resolved to the parent keyword "Agriculture" and returned all
  // 2,987 USDA contacts — you ask for the Forest Service, you get every USDA
  // person. Same shape as the DLA firehose, milder (3.7x vs 7x). Found by the
  // agreement gate, not by a customer.
  USFS: 'Forest Service',
  // ARS (Agricultural Research Service, 254 in sub_tier) deliberately NOT aliased.
  // Measured: searching "ARS" already returns 1,413 rows because the route's raw
  // `contact_fullname.ilike.%ars%` matches mARSha / cARSon / pARSons. The alias
  // would add 254 real contacts to a result already dominated by name noise —
  // it does not fix the term, and a 3-letter acronym is the wrong tool. Same
  // hazard as `%EPA%` matching "dEPArtment" (28,733 rows). Fix the substring
  // matching first, then revisit short acronyms.
};

/**
 * Where a search term should be matched: department keyword(s) and/or a sub_tier
 * keyword. A sub_tier hit is EXCLUSIVE — see ACRONYM_TO_SUBTIER.
 */
export function agencySearchTargets(term: string): { dept: string[]; subTier: string[] } {
  const up = (term || '').trim().toUpperCase();
  const sub = ACRONYM_TO_SUBTIER[up];
  if (sub) return { dept: [], subTier: [sub] };
  return { dept: agencySearchKeywords(term), subTier: [] };
}

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
  const override = DEPT_KEYWORD_OVERRIDE[up];
  if (override) {
    out.add(override);
  } else {
    const mapped = PARENTS[up] || ALIASES[up];
    if (mapped) {
      const kw = agencyKeyword(mapped);
      if (kw.length >= 3) out.add(kw);
    }
  }
  // 2. Spelled-out sub-agency phrase (forest service, land management…).
  for (const p of PHRASE_TO_DEPT) if (p.re.test(t)) out.add(p.kw);
  return [...out];
}
