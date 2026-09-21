/**
 * FROZEN EVIDENCE for a FUTURE body-relevance feature. Nothing imports this
 * yet — it is the acceptance bar a replacement must clear before it ships.
 *
 * Context: a "detail-evidence" fallback was built on 2026-09-21 and REMOVED
 * the same day (PR #1610, option B). When the title gate found nothing it read
 * the notice's `description`/`sow_text`, matched the user's activity term, and
 * rendered the passage under "Your words are in this listing's details:".
 * Measured end-to-end against the live cache: **26 hits across 10 inputs,
 * ~19 of them (73%) did not describe the user's work.** The card asserted the
 * notice's own text as evidence, so a wrong hit was an affirmative false claim
 * with the proof attached — the failure class the rest of that PR removed,
 * relocated from the direct group into Related.
 *
 * The idea is sound: for "we mow lawns" the corpus really does connect the
 * user's words to NAICS 561730 through the description. What was missing was
 * everything that makes a body match mean something. Any replacement must
 * handle ALL of the classes below, and must be measured, not reasoned about.
 *
 * ⚠️ Do NOT revive the removed implementation. In particular
 * `DETAIL_PHRASE_SPAN = 40` was order-free proximity while its own comment
 * claimed to be a phrase check — it matched
 * "the staffing plan shall address medical surveillance requirements"
 * for the term "medical staffing".
 *
 * Every record below is verbatim from the live cache on 2026-09-21.
 */

export interface BodyRelevanceCase {
  /** Why a body match here is wrong (or right). */
  klass:
    | 'submission_boilerplate'
    | 'site_access_boilerplate'
    | 'table_of_contents'
    | 'far_clause'
    | 'scope_exclusion'
    | 'negation'
    | 'wrong_word_sense'
    | 'product_attribute'
    | 'buyer_letterhead'
    | 'proximity_not_phrase'
    | 'genuine_rescue';
  input: string;
  term: string;
  title: string;
  naics: string | null;
  /** The passage the removed feature quoted as proof. */
  passage: string;
  /** true = a replacement MUST admit it; false = MUST reject it. */
  admit: boolean;
}

export const BODY_RELEVANCE_CASES: BodyRelevanceCase[] = [
  // ── B1: the term is in the text, the notice is not the work ────────────
  {
    klass: 'submission_boilerplate',
    input: 'we do detailing and janitorial',
    term: 'detailing',
    title: '182d Airlift Wing - Scissor Lift Maintenance',
    naics: '811310',
    passage:
      'The Contractor shall deliver a written condition report detailing the failure, recommended corrective action, necessary parts, and labor estimates to the COR',
    admit: false,
  },
  {
    klass: 'submission_boilerplate',
    input: 'we do detailing and janitorial',
    term: 'detailing',
    title: 'Generator Preventative Maintenance Services',
    naics: '811310',
    passage: 'Offerors shall submit a brief plan (not to exceed 2 pages) detailing their capability and methodology',
    admit: false,
  },
  {
    klass: 'table_of_contents',
    input: 'we do escort and janitorial',
    term: 'escort',
    title: 'TSA-MCI Janitorial & Related Services',
    naics: '561720',
    passage: '...........26 5.4 Escort Requirements...........',
    admit: false,
  },
  {
    klass: 'site_access_boilerplate',
    input: 'we do escort and janitorial',
    term: 'escort',
    title: 'HDPE Bird Netting',
    naics: '326199',
    passage: 'Contractors must be escorted at all times while on site.',
    admit: false,
  },
  {
    klass: 'far_clause',
    input: 'we do tailoring and janitorial',
    term: 'tailoring',
    title: 'USCG Air Station Port Angeles Main Gate Replacement',
    naics: '238990',
    passage: 'tailored in accordance with FAR 12.302 ... This tailoring includes but is not limited to',
    admit: false,
  },
  {
    klass: 'scope_exclusion',
    input: 'we do caulking and janitorial',
    term: 'caulking',
    title: 'Ceiling Lift Systems Installation and Removal of Existing Systems',
    naics: '339113',
    passage:
      'including but not limited to ceilings, walls, tile, patching, painting, acoustic caulking, asbestos abatement, ... and door header modification is outside the scope of work for Guldmann install',
    admit: false,
  },
  {
    klass: 'negation',
    input: 'we pressure wash buildings',
    term: 'pressure wash',
    title: 'AMENDMENT 0004 - FY 26 Barnes Center Interior Cleaning Service',
    naics: '561720',
    passage: '2) No pressure washing lead-based painted surfaces. 3) No pressure washing historic buildings.',
    admit: false,
  },
  {
    klass: 'negation',
    input: 'we do pest control',
    term: 'pest control',
    title: 'RRS/DFAS Grounds MXS',
    naics: '561730',
    passage: '1.1.8. PEST CONTROL (RESERVED)',
    admit: false,
  },
  {
    klass: 'wrong_word_sense',
    input: 'we do interpreting and janitorial',
    term: 'interpreting',
    title: 'USACE History Office (CEHO) Historical Support Services BPA',
    naics: '541720',
    passage:
      'responsible for collecting, preserving, interpreting, and disseminating the history of USACE',
    admit: false,
  },
  {
    klass: 'product_attribute',
    input: 'we do upholstery and janitorial',
    term: 'upholstery',
    title: '2310--Transit Bus',
    naics: '336211',
    passage: 'Passenger upholstery: high-durability vinyl (black)',
    admit: false,
  },
  {
    klass: 'buyer_letterhead',
    input: 'physical security guard services',
    term: 'security guard',
    title: 'CGC Kathleen Moore 100ton Crane Services',
    naics: '238990',
    passage: 'DEPARTMENT OF HOMELAND SECURITY UNITED STATES COAST GUARD',
    admit: false,
  },
  {
    klass: 'proximity_not_phrase',
    input: 'we pressure wash buildings',
    term: 'pressure wash',
    title: 'USCG ANT SAGINAW RIVER',
    naics: '336611',
    passage: 'low pressure fresh water wash down (maximum 5,000 psi)',
    admit: false,
  },

  // ── Genuine rescues — the reason the idea is worth revisiting ──────────
  {
    klass: 'genuine_rescue',
    input: 'we mow lawns',
    term: 'lawn mowing',
    title: 'PSW Landscaping Hilo, Hawaii',
    naics: '561730',
    passage:
      'The purpose of this contract is to have frequent mowing, weeding, and general lawn maintenance year-round at the Institute of Pacific Islands Forestry',
    admit: true,
  },
  {
    klass: 'genuine_rescue',
    input: 'we mow lawns',
    term: 'mowing',
    title: 'Grounds Maintenance Services, Ft Sill National Cemetery',
    naics: '561730',
    passage: 'Mowing, trimming, edging on improved and unimproved turf areas in a large scale (120+ acres)',
    admit: true,
  },
  {
    klass: 'genuine_rescue',
    input: 'medical staffing agency',
    term: 'medical staffing',
    title: 'Q502--Long Term Perfusionist Services (STX)',
    naics: '621399',
    passage:
      'Perfusionist staffing contracts Cardiovascular surgery support VA or DoD medical staffing contracts',
    admit: true,
  },
];

/**
 * B2/B3 — accounting defects the removed wiring had, independent of matching.
 * A replacement must not repeat them.
 */
export const BODY_RELEVANCE_ACCOUNTING_RULES = [
  'The candidate pool must EXCLUDE the title-matched population. The removed version passed `[...direct.items, ...expandedTitleFiltered]` into a fallback whose premise is "the title did not name this", so for "we do interpreting and janitorial" it claimed 6 listings "do not name this work in the title" while 4 of the 6 had "Janitorial Services" in the title.',
  'Any count in the reveal must equal what the cards can show, or say "showing N of M". The same case claimed 6 and rendered 2.',
  'Deduplicate BEFORE counting. Duplicate cache rows (distinct notice_id, same notice) were counted twice — "Base Seattle Fire Alarm Confidence Testing" appeared twice in one result.',
  'A hit cap needs a RANKING. DETAIL_EVIDENCE_MAX_HITS broke on unordered PostgREST `.in()` arrival, so redundant title-matches crowded out the real rescue.',
  'The live oracle must actually exercise the path: `toItem()` in scripts/verify-beginner-try.mjs omitted `notice_id`, so every candidate was skipped and 13/13 passed with the feature effectively disabled.',
] as const;
