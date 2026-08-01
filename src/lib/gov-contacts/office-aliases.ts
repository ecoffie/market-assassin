/**
 * Office-name alias layer — makes FPDS/SAM office abbreviations findable by the
 * words a contractor actually types.
 *
 * THE PROBLEM (measured against dodaac_directory, 2026-07-31):
 * office_name holds the government's internal abbreviations, not English.
 * The 46 USACE districts are all stored as "ENDIST <city>", and the phrase
 * "Corps of Engineers" appears in ZERO rows of the table — so a search for it
 * can never match, no matter how good the matching is. Same for USPFO (148
 * rows), NAVOPSPTCEN (103), AFLCMC (121), DCMA (94), MICC (44).
 *
 * It is not fixable by renaming rows: FPDS and SAM both use these
 * abbreviations, so a rename would drift from both upstream sources. The fix
 * is a synonym layer applied at QUERY time.
 *
 * WHY sub_agency ISN'T ENOUGH: dodaacCodesForAgency() matches on sub_agency
 * only, and all 238 USACE/MICC/USPFO offices carry the same sub_agency value
 * ("Department of the Army"). So "USACE" resolves to either nothing or the
 * entire Army — never the 46 districts. Callers must search office_name too.
 */

/**
 * abbreviation → the phrases a human would search for it by.
 *
 * Ordering matters for display: the FIRST expansion is the canonical plain-
 * English name. The rest are additional search handles.
 *
 * Counts in comments are rows in dodaac_directory carrying that token
 * (measured 2026-07-31) — they justify each entry's inclusion. Anything with
 * a low count is here because it is a well-known search term, not because it
 * is frequent.
 */
export const OFFICE_ABBREVIATIONS: Record<string, string[]> = {
  // --- Army ---
  // 46 rows. The single biggest offender: "ENDIST LOUISVILLE" etc.
  ENDIST: ['Engineer District', 'Corps of Engineers', 'USACE', 'Army Corps of Engineers'],
  ENDIV: ['Engineer Division', 'Corps of Engineers', 'USACE'],
  // A handful of Corps offices spell out USACE in office_name rather than using
  // the ENDIST prefix (e.g. W91WMC = "USACE EIT SVCS"). Without this entry they
  // are only reachable by the literal token, so they vanish the moment the
  // agency alias expands "USACE" to its full name.
  USACE: ['Corps of Engineers', 'Army Corps of Engineers', 'Engineer District'],
  // 44 rows. Mission and Installation Contracting Command.
  MICC: ['Mission and Installation Contracting Command', 'Army installation contracting'],
  // 148 rows — by volume the most common opaque token in the whole table.
  USPFO: ['United States Property and Fiscal Office', 'National Guard property office'],
  ARNG: ['Army National Guard'],
  ANG: ['Air National Guard'],
  ACC: ['Army Contracting Command'],
  AMC: ['Army Materiel Command'],
  TACOM: ['Tank-automotive and Armaments Command', 'Army ground vehicles'],
  CECOM: ['Communications-Electronics Command'],
  AMCOM: ['Aviation and Missile Command'],

  // --- Navy / Marine Corps ---
  // 103 rows.
  NAVOPSPTCEN: ['Navy Operational Support Center'],
  NAVSUP: ['Naval Supply Systems Command'],
  NAVFAC: ['Naval Facilities Engineering Systems Command', 'Navy facilities', 'Navy construction'],
  NAVSEA: ['Naval Sea Systems Command'],
  NAVAIR: ['Naval Air Systems Command'],
  NAVWAR: ['Naval Information Warfare Systems Command', 'SPAWAR'],
  NSWC: ['Naval Surface Warfare Center'],
  NAWC: ['Naval Air Warfare Center'],
  NUWC: ['Naval Undersea Warfare Center'],
  FLC: ['Fleet Logistics Center'],
  WSS: ['Weapon Systems Support'],
  MSC: ['Military Sealift Command'],
  MCSC: ['Marine Corps Systems Command'],

  // --- Air Force / Space Force ---
  // 121 rows.
  AFLCMC: ['Air Force Life Cycle Management Center'],
  AFICC: ['Air Force Installation Contracting Center'],
  AFRL: ['Air Force Research Laboratory'],
  AFSC: ['Air Force Sustainment Center'],
  // 64 rows. "CONS" = Contracting Squadron ("10 CONS LGC").
  CONS: ['Contracting Squadron'],
  ALC: ['Air Logistics Complex'],
  SSC: ['Space Systems Command'],

  // --- Defense agencies ---
  DLA: ['Defense Logistics Agency'],
  // 94 rows.
  DCMA: ['Defense Contract Management Agency'],
  DCAA: ['Defense Contract Audit Agency'],
  DISA: ['Defense Information Systems Agency'],
  DTRA: ['Defense Threat Reduction Agency'],
  DHA: ['Defense Health Agency'],
  MDA: ['Missile Defense Agency'],
  DARPA: ['Defense Advanced Research Projects Agency'],
  NGA: ['National Geospatial-Intelligence Agency'],
  DFAS: ['Defense Finance and Accounting Service'],
  DECA: ['Defense Commissary Agency'],

  // --- Coast Guard (DHS, but DoDAAC-anchored under 70Z0xx) ---
  SFLC: ['Surface Forces Logistics Center', 'Coast Guard logistics'],
  USCG: ['United States Coast Guard'],

  // --- VA ---
  // "NCO 22", "VISN 8" — how VA regions are actually written.
  NCO: ['Network Contracting Office', 'VA regional contracting'],
  VISN: ['Veterans Integrated Service Network', 'VA region'],
};

/**
 * Reverse index: a searchable phrase (lowercased) → the abbreviations that
 * expand to it. Lets a query for "corps of engineers" find ENDIST rows.
 * Built once at module load.
 */
const PHRASE_TO_ABBREV: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [abbrev, phrases] of Object.entries(OFFICE_ABBREVIATIONS)) {
    for (const p of phrases) {
      const key = p.toLowerCase();
      const list = m.get(key) || [];
      if (!list.includes(abbrev)) list.push(abbrev);
      m.set(key, list);
    }
  }
  return m;
})();

/**
 * Given a user's search term, return the office_name tokens worth searching
 * for — the term itself plus any abbreviation it expands to (and vice versa).
 *
 * "corps of engineers" → ['corps of engineers', 'ENDIST', 'ENDIV']
 * "ENDIST"             → ['ENDIST', 'Engineer District', 'Corps of Engineers', ...]
 * "widgets"            → ['widgets']  (unknown terms pass through unchanged)
 */
export function expandOfficeSearchTerms(term: string): string[] {
  const raw = (term || '').trim();
  if (!raw) return [];
  const out = [raw];
  const upper = raw.toUpperCase();
  const lower = raw.toLowerCase();

  // Forward: the term IS an abbreviation → add its plain-English phrases.
  for (const p of OFFICE_ABBREVIATIONS[upper] || []) {
    if (!out.some(o => o.toLowerCase() === p.toLowerCase())) out.push(p);
  }

  // Reverse: the term is a phrase → add the abbreviations that mean it.
  //
  // Matching is deliberately asymmetric:
  //  - lower.includes(phrase): the user typed MORE than the alias
  //    ("army corps of engineers district" contains "corps of engineers").
  //    Always safe — the full alias is present.
  //  - phrase.includes(lower): the user typed LESS (a prefix of the alias).
  //    Dangerous, because a 2-3 char query matches mid-word in dozens of
  //    phrases ("AC" hits "Contr[ac]ting", "Sp[ac]e", "Fin[ac]e" → CONS, SSC,
  //    DCMA, DCAA, DFAS...). Gated on length AND a word boundary so a partial
  //    only matches at the start of a word.
  const MIN_PARTIAL = 4;
  for (const [phrase, abbrevs] of PHRASE_TO_ABBREV) {
    const full = lower === phrase || lower.includes(phrase);
    const partial =
      !full &&
      lower.length >= MIN_PARTIAL &&
      new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(phrase);
    if (!full && !partial) continue;
    for (const a of abbrevs) {
      if (!out.some(o => o.toUpperCase() === a)) out.push(a);
      // Close the loop: also add that abbreviation's OTHER phrasings. An office
      // may spell out a sibling phrase rather than use the abbreviation —
      // W912EF is "US ARMY ENGINEER DISTRICT WALLA WAL", which contains
      // "Engineer District" but neither "ENDIST" nor "Corps of Engineers".
      // Without this, searching "Corps of Engineers" silently missed it while
      // searching "USACE" found it.
      for (const sib of OFFICE_ABBREVIATIONS[a] || []) {
        if (!out.some(o => o.toLowerCase() === sib.toLowerCase())) out.push(sib);
      }
    }
  }
  return out;
}

/**
 * Make a stored office_name human-readable by appending the expansion of any
 * abbreviation it leads with: "ENDIST LOUISVILLE" → "ENDIST LOUISVILLE (Corps
 * of Engineers — Engineer District)".
 *
 * Deliberately APPENDS rather than replaces: the raw token is what appears in
 * SAM and FPDS, so a contractor cross-referencing either source still sees the
 * string they know. Returns the input unchanged when nothing matches.
 */
export function annotateOfficeName(officeName: string): string {
  const name = (officeName || '').trim();
  if (!name) return name;
  // Match the leading token, allowing a trailing hyphen ("MICC-FT DRUM").
  const lead = /^([A-Z]{3,12})[\s-]/.exec(name.toUpperCase());
  const token = lead?.[1];
  if (!token) return name;
  const phrases = OFFICE_ABBREVIATIONS[token];
  if (!phrases?.length) return name;
  // Canonical name first; add the recognisable parent when it differs.
  const label = phrases.length > 1 ? `${phrases[1]} — ${phrases[0]}` : phrases[0];
  return `${name} (${label})`;
}
