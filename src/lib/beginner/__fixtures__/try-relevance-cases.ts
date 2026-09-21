/**
 * FROZEN /try relevance regression set — captured 2026-09-21, BEFORE the fix.
 *
 * Every record below is a REAL row measured in the live `sam_opportunities`
 * cache on 2026-09-21 (title / naics_code / notice_type / set_aside_description
 * verbatim). Nothing here is illustrative: a synthetic corpus can only prove the
 * matcher agrees with itself.
 *
 * Human record + reasoning: docs/engineering/try-relevance-regression.md
 *
 * Contract for each case:
 *   include  — MUST appear in the DIRECT group. These are the guard against a
 *              "fix" that passes by returning nothing.
 *   exclude  — MUST NOT appear in the DIRECT group. `group:'broader'` means it
 *              may appear in the explicitly-broader group; `group:'none'` means
 *              it must not be shown at all.
 *
 * Deliberately NOT asserted: that two unrelated markets can never co-occur. A
 * genuinely multi-service business spans markets — see `multi-service`, which
 * REQUIRES a cleaning hit and a construction hit in the same direct group.
 */

export type ExpectedGroup = 'direct' | 'broader' | 'none';

export interface CaseRecord {
  title: string;
  naics: string | null;
  type: string;
  setAside: string | null;
  why: string;
}

export interface RelevanceCase {
  id: string;
  input: string;
  followUp?: string;
  /** Why this case is in the set. */
  rationale: string;
  /** Expected activity extraction — the thing we search on. */
  expectHead: string | null;
  expectConfidence: 'high' | 'low' | 'none';
  /** Expected /try outcome when the corpus below is the whole world. */
  expectOutcome: 'results' | 'need_followup' | 'empty';
  include: CaseRecord[];
  exclude: Array<CaseRecord & { group: Exclude<ExpectedGroup, 'direct'> }>;
}

/** The three screenshot false positives — reused as cross-domain negatives. */
const SCREENSHOT_FALSE_POSITIVES: Array<CaseRecord & { group: 'none' }> = [
  {
    title: 'RFI - DCSA Personnel Security Alert Management (PSAM) Platform',
    naics: null,
    type: 'Sources Sought',
    setAside: null,
    why: '"person" is a substring of "Personnel", and "person" came from "2 person" — company context, not a market.',
    group: 'none',
  },
  {
    title: 'FY26 NPTU Personal Alert Safety System (PASS)',
    naics: '334290',
    type: 'Solicitation',
    setAside: 'Small Business Set Aside - Total',
    why: '"person" is a substring of "Personal". A wearable safety-alert device is not waste hauling.',
    group: 'none',
  },
  {
    title: 'IT MANAGER - PERSONAL SERVICES CONTRACTORS',
    naics: '541519',
    type: 'Presolicitation',
    setAside: null,
    why: '"person" ⊂ "Personal"; "services"/"contractors" are generic. IT staffing is not waste hauling.',
    group: 'none',
  },
];

export const TRY_RELEVANCE_CASES: RelevanceCase[] = [
  {
    id: 'garbage-2-person',
    input: 'can a 2 person garbage company do government contracts',
    rationale:
      'THE SCREENSHOT INPUT. The activity is garbage collection; "2 person", "company", "government" and "contracts" are company/meta context. Before the fix the searched keyword was literally "person".',
    expectHead: 'garbage',
    expectConfidence: 'high',
    expectOutcome: 'results',
    include: [
      {
        title: 'Trash and Garbage Removal Services',
        naics: '562998',
        type: 'Solicitation',
        setAside: null,
        why: 'Real waste-hauling solicitation — the only true match in the live cache for this business.',
      },
    ],
    exclude: [
      ...SCREENSHOT_FALSE_POSITIVES,
      {
        title: 'BPA setup - Office Supplies  FY26',
        naics: '424120',
        type: 'Combined Synopsis/Solicitation',
        setAside: null,
        why: 'Body-text-only hit on "garbage"; the title names no waste work, so relevance cannot be established.',
        group: 'none',
      },
      {
        title:
          'UPDATED: 9/8/2026 - 30888PR260000012 - USCG STATION SAN DIEGO - KITCHEN RENOVATION - CONSTRUCTION',
        naics: '236118',
        type: 'Combined Synopsis/Solicitation',
        setAside: null,
        why: 'Body-text-only hit on "garbage" (a kitchen spec mentions garbage disposal). Not a waste contract.',
        group: 'none',
      },
    ],
  },
  {
    id: 'cleaning',
    input: 'I clean office buildings',
    rationale:
      'Activity leads the sentence (the case the old position-based picker handled). Must keep working. "office"/"buildings" are the venue, not the market.',
    expectHead: 'clean',
    expectConfidence: 'high',
    expectOutcome: 'results',
    include: [
      {
        title: 'AMENDMENT 0004 - FY 26 Barnes Center Interior Cleaning Service',
        naics: '561720',
        type: 'Solicitation',
        setAside: null,
        why: 'Janitorial NAICS + "Cleaning" in the title. Stemming must let "clean" match "Cleaning".',
      },
      {
        title: 'Remediation and Specialty Cleaning Services',
        naics: '562910',
        type: 'Solicitation',
        setAside: null,
        why: 'Different NAICS family (562910 remediation) but unambiguous activity evidence in the title — a missing/"wrong" code must not delete a real match.',
      },
    ],
    exclude: [
      {
        title: 'Dale Carnegie Building a Stronger Team',
        naics: '611430',
        type: 'Combined Synopsis/Solicitation',
        setAside: null,
        why: 'The original token-collision regression: "building" as a gerund in a training title.',
        group: 'none',
      },
      {
        title: 'Building 215 Clean Room HEPA Filter Replacement',
        naics: '236210',
        type: 'Special Notice',
        setAside: null,
        why: 'HOMOGRAPH: "Clean Room" is a facility class, not janitorial work (NAICS 236210). The word IS in the title, so it is not fabricated evidence — it is demoted out of the described-match group by sector disagreement among "clean" matches, and shown as adjacent.',
        group: 'broader',
      },
    ],
  },
  {
    id: 'it-support',
    input: 'we do IT support for small offices',
    rationale:
      'No single activity word survives ("IT" is 2 chars, "support" is a federal wildcard, "small"/"offices" are context). The activity only exists as the phrase "IT support".',
    expectHead: 'it support',
    expectConfidence: 'high',
    expectOutcome: 'results',
    include: [
      {
        title: 'IT Support Services Contract (ITSSC) Recompete',
        naics: '541519',
        type: 'Combined Synopsis/Solicitation',
        setAside: null,
        why: 'Exact phrase in the title.',
      },
    ],
    exclude: [
      {
        title: 'STRAIGHT END FITTING',
        naics: '332996',
        type: 'Solicitation',
        setAside: null,
        why: 'Body-only FTS hit. A pipe fitting is not IT support.',
        group: 'none',
      },
      {
        title: 'Digital Anatomy Printer',
        naics: '33324',
        type: 'Combined Synopsis/Solicitation',
        setAside: null,
        why: 'Body-only FTS hit on "support".',
        group: 'none',
      },
    ],
  },
  {
    id: 'staffing',
    input: 'staffing agency',
    rationale:
      'HONEST-EMPTY guard. "agency" is an org word; "staffing" is on the platform generic list but IS the activity. Measured 2026-09-21: zero open notices carry "staffing" in the title, so the correct answer is a thin/empty result — never a confident unrelated list.',
    expectHead: 'staffing',
    expectConfidence: 'low',
    expectOutcome: 'empty',
    include: [],
    exclude: [
      {
        title: 'The Data COUNTS™ (Collect Data Once, Use Numerous Times)',
        naics: '54151',
        type: 'Sources Sought',
        setAside: 'No Set aside used',
        why: 'Body-only hit. Ranked #1 for "staffing" before the fix.',
        group: 'none',
      },
      {
        title: 'Lifeguard Services Indoor Pool',
        naics: '713940',
        type: 'Combined Synopsis/Solicitation',
        setAside: null,
        why: 'Body-only hit.',
        group: 'none',
      },
      {
        title: 'ZFW Cafeteria and Vending Services',
        naics: '722320',
        type: 'Combined Synopsis/Solicitation',
        setAside: null,
        why: 'Body-only hit.',
        group: 'none',
      },
    ],
  },
  {
    id: 'construction',
    input: 'I run a small construction company',
    rationale:
      '"small" and "company" are context; "run" is a verb. The activity is a word the platform generic-list demotes, which must still be searchable when it is all the user gave us.',
    expectHead: 'construction',
    expectConfidence: 'low',
    expectOutcome: 'results',
    include: [
      {
        title: 'Cooling Tower, Roofing, and Structural Construction',
        naics: '236220',
        type: 'Solicitation',
        setAside: null,
        why: 'Activity word in the title.',
      },
      {
        title: 'SOLICITATION NOTICE- Rochester, NY Courthouse Construction',
        naics: '236220',
        type: 'Solicitation',
        setAside: null,
        why: 'Activity word in the title.',
      },
    ],
    exclude: [
      {
        title: 'IT MANAGER - PERSONAL SERVICES CONTRACTORS',
        naics: '541519',
        type: 'Presolicitation',
        setAside: null,
        why: 'Cross-domain negative.',
        group: 'none',
      },
    ],
  },
  {
    id: 'landscaping',
    input: 'I own a landscaping business',
    rationale: 'Clean single-activity case. "own"/"business" are context.',
    expectHead: 'landscaping',
    expectConfidence: 'high',
    expectOutcome: 'results',
    include: [
      {
        title: 'MDG Landscaping/ Grounds Maintenance',
        naics: '561730',
        type: 'Combined Synopsis/Solicitation',
        setAside: null,
        why: 'Activity in the title.',
      },
      {
        title: 'PSW Landscaping Hilo, Hawaii',
        naics: '561730',
        type: 'Combined Synopsis/Solicitation',
        setAside: null,
        why: 'Activity in the title.',
      },
    ],
    exclude: [
      {
        title: '3750--VR&E Landscaping Equipment',
        naics: '333112',
        type: 'Solicitation',
        setAside: null,
        why: 'MISSING-vs-WRONG-code check: the activity word IS in the title, so this is admitted to DIRECT. Recorded here to make the decision explicit — buying mowers is adjacent to mowing, and we do not have evidence to call it irrelevant.',
        group: 'broader',
      },
    ],
  },
  {
    id: 'security-guard',
    input: 'physical security guard services',
    rationale:
      '"physical" is an attributive modifier that the old picker chose as the search keyword (it is not on any generic list). "security" and "services" are federal wildcards. The activity is "guard" / "security guard".',
    expectHead: 'guard',
    expectConfidence: 'high',
    expectOutcome: 'results',
    include: [
      {
        title: 'WJHTC Armed Security Guard Services',
        naics: '561612',
        type: 'Solicitation',
        setAside: null,
        why: 'Exact activity in the title.',
      },
      {
        title: 'Fairbanks Alaska CBOC Security Guard',
        naics: '561612',
        type: 'Presolicitation',
        setAside: null,
        why: 'Exact activity in the title.',
      },
    ],
    exclude: [
      {
        title: 'US COAST GUARD TRACEN PETALUMA PROPANE DELIVERY',
        naics: '221210',
        type: 'Solicitation',
        setAside: null,
        why: 'HOMOGRAPH: "Guard" here is the Coast Guard, the BUYER, not the work. Propane delivery, NAICS 221210.',
        group: 'none',
      },
      {
        title: 'Texas Army National Guard - Medical Waste Disposal Management Services',
        naics: '562112',
        type: 'Solicitation',
        setAside: null,
        why: 'HOMOGRAPH: National Guard is the buyer.',
        group: 'none',
      },
      {
        title: '25--Front Mounted Bus Grill Guards',
        naics: '336390',
        type: 'Combined Synopsis/Solicitation',
        setAside: null,
        why: 'HOMOGRAPH: a vehicle grill guard is a part (NAICS 336390), not a service. "Guards" is genuinely in the title, so it is demoted by sector disagreement among "guard" matches, not deleted.',
        group: 'broader',
      },
      {
        title: 'STEM,FLUID VALVE',
        naics: '332919',
        type: 'Solicitation',
        setAside: null,
        why: 'Body-only FTS hit on the phrase "security guard".',
        group: 'none',
      },
    ],
  },
  {
    id: 'catering',
    input: 'we cater events',
    rationale: 'Stemming case: the user writes the verb "cater"; the government writes "Catering"/"Catered".',
    expectHead: 'cater',
    expectConfidence: 'high',
    expectOutcome: 'results',
    include: [
      {
        title: '19N15026Q0004 - SOLICITATION FOR CATERING SERVICES',
        naics: '722320',
        type: 'Solicitation',
        setAside: null,
        why: '"cater" must stem-match "CATERING".',
      },
      {
        title: 'Texas Army National Guard-Dinner Catered Meals, Gatesville, Tx',
        naics: '722320',
        type: 'Presolicitation',
        setAside: null,
        why: '"cater" must stem-match "Catered".',
      },
    ],
    exclude: [
      {
        title: 'ZFW Cafeteria and Vending Services',
        naics: '722320',
        type: 'Combined Synopsis/Solicitation',
        setAside: null,
        why: 'BROAD-CODE FALSE POSITIVE: same NAICS 722320 as the real catering hits, but the title names cafeteria/vending, not catering. Code overlap alone must not admit it to DIRECT.',
        group: 'broader',
      },
    ],
  },
  {
    id: 'trucking',
    input: 'trucking company',
    rationale: '"company" is context. Guards against a trailing org word becoming the search key.',
    expectHead: 'trucking',
    expectConfidence: 'high',
    // Nothing matches the user's words directly; one record carries a
    // shortened form ("truck"), so the page shows an adjacent group rather
    // than claiming a match or claiming nothing exists.
    expectOutcome: 'results',
    include: [],
    exclude: [
      {
        title: 'Purchase of 2 Sewer Cleaning and Sludge Disposal Pump Trucks',
        naics: '336120',
        type: 'Solicitation',
        setAside: null,
        why: 'Buying trucks is not hiring a trucking company — must never be a DESCRIBED match.',
        group: 'broader',
      },
      {
        title: 'FA466126Q0098 - Bucket truck Lease',
        naics: '532412',
        type: 'Combined Synopsis/Solicitation',
        setAside: null,
        why: 'Equipment lease, not freight hauling — adjacent at best, never a described match.',
        group: 'broader',
      },
      {
        title: 'Warehousing Support for CRSP',
        naics: '493110',
        type: 'Combined Synopsis/Solicitation',
        setAside: null,
        why: 'Body-only FTS hit.',
        group: 'none',
      },
    ],
  },
  {
    id: 'roofing-verb-led',
    input: 'we install commercial roofing',
    rationale:
      'VERB-LED. The old picker searched "install". "commercial" is a documented federal wildcard. The activity is roofing.',
    expectHead: 'roofing',
    expectConfidence: 'high',
    expectOutcome: 'results',
    include: [
      {
        title: 'USDA-ARS Tifton Roofing Remodel',
        naics: '238160',
        type: 'Combined Synopsis/Solicitation',
        setAside: null,
        why: 'Activity in the title.',
      },
    ],
    exclude: [
      {
        title: 'Z--REPLACE ROOF SURFACES ON DEWA LOCATIONS',
        naics: '238160',
        type: 'Combined Synopsis/Solicitation',
        setAside: null,
        why: 'SHORTENED FORM: the government writes "ROOF", the user wrote "roofing". Expanding a word keeps its meaning; shortening it drops meaning (see "trucking" → "Trucks"), so the same rule that stops a trucking company being shown pump trucks puts this one tier down. It is still SHOWN — a residual limitation recorded in the PR packet, not a silent loss.',
        group: 'broader',
      },
      {
        title: 'NEC Rail Waterproofing Membrane Repair',
        naics: '238190',
        type: 'Solicitation',
        setAside: null,
        why: 'Body-only FTS hit on "roofing"; the title names waterproofing on rail, not roofing.',
        group: 'none',
      },
    ],
  },
  {
    id: 'multi-service',
    input: 'I do commercial cleaning and small construction jobs',
    rationale:
      'MULTI-MARKET. Explicitly guards against a blanket "unrelated results can never co-occur" rule: this business really does span janitorial and construction, so BOTH must survive in the direct group.',
    expectHead: 'cleaning',
    expectConfidence: 'high',
    expectOutcome: 'results',
    include: [
      {
        title: 'AMENDMENT 0004 - FY 26 Barnes Center Interior Cleaning Service',
        naics: '561720',
        type: 'Solicitation',
        setAside: null,
        why: 'Cleaning market.',
      },
      {
        title: 'SOLICITATION NOTICE- Rochester, NY Courthouse Construction',
        naics: '236220',
        type: 'Solicitation',
        setAside: null,
        why: 'Construction market — a DIFFERENT sector from 561720, and that is correct here.',
      },
    ],
    exclude: [
      {
        title: 'FY26 NPTU Personal Alert Safety System (PASS)',
        naics: '334290',
        type: 'Solicitation',
        setAside: 'Small Business Set Aside - Total',
        why: 'Spanning two real markets does not license a third unrelated one.',
        group: 'none',
      },
    ],
  },
  {
    id: 'vague',
    input: 'I help businesses',
    rationale:
      'VAGUE INPUT. Every content word is company/meta context. Must ask a clarifying question — never a confident list.',
    expectHead: null,
    expectConfidence: 'none',
    expectOutcome: 'need_followup',
    include: [],
    exclude: SCREENSHOT_FALSE_POSITIVES,
  },
];

/**
 * Eligibility + notice-stage records. Measured 2026-09-21: 4,261 of 9,030 active
 * open notices (47.2%) carry NO set_aside_description AND no set_aside_code, and
 * every one of them was rendered "Who it's for: Any business that can do the work".
 */
export const ELIGIBILITY_CASES = [
  {
    id: 'missing-set-aside-on-rfi',
    record: SCREENSHOT_FALSE_POSITIVES[0],
    expectAudienceContains: 'Not listed',
    expectAudienceExcludes: 'Any business that can do the work',
    expectStage: 'market_research' as const,
    why: 'Set-aside is absent from the record. Absent ≠ unrestricted.',
  },
  {
    id: 'explicit-unrestricted',
    record: {
      title: 'Solid Waste Disposal (Landfill) Services - FCC Pollock',
      naics: '562212',
      type: 'Sources Sought',
      setAside: 'No Set aside used',
      why: 'SAM states unrestricted explicitly.',
    },
    expectAudienceContains: 'Any business that can do the work',
    expectAudienceExcludes: 'Not listed',
    expectStage: 'market_research' as const,
    why: 'Explicit "No Set aside used" IS an unrestricted read — and it is recorded on a Sources Sought, which must be preserved, not blanked.',
  },
  {
    id: 'real-set-aside-preserved-on-solicitation',
    record: SCREENSHOT_FALSE_POSITIVES[1],
    expectAudienceContains: 'Small businesses',
    expectAudienceExcludes: 'Not listed',
    expectStage: 'open_bid' as const,
    why: 'A real recorded set-aside must survive verbatim.',
  },
  {
    id: 'set-aside-preserved-on-sources-sought',
    record: {
      title: 'Non-hazardous Solid Waste Pick-up',
      naics: '562111',
      type: 'Combined Synopsis/Solicitation',
      setAside: 'Indian Small Business Economic Enterprise',
      why: 'A recorded set-aside on a non-standard program.',
    },
    expectAudienceContains: 'See the listing',
    expectAudienceExcludes: 'Any business that can do the work',
    expectStage: 'open_bid' as const,
    why: 'ISBEE is a real reservation we do not have beginner copy for — say "see the listing", never "any business".',
  },
  {
    id: 'upcoming-presolicitation',
    record: SCREENSHOT_FALSE_POSITIVES[2],
    expectAudienceContains: 'Not listed',
    expectAudienceExcludes: 'Any business that can do the work',
    expectStage: 'upcoming' as const,
    why: 'Presolicitation is neither an open bid nor market research.',
  },
];
