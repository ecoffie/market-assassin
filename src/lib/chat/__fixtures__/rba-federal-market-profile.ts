/**
 * RBA Engineering International — Federal Market Profile acceptance package.
 *
 * Source: Claude + Mindy MCP chain that produced the benchmark HTML
 * (`RBA Engineering International_ Federal Market Profile.html`).
 * Ask Mindy must reach this quality bar. Frozen 2026-11-19.
 *
 * Critical trap: award codes establish primary NAICS 237310 (bridges/roads).
 * Framing as generic "8(a) construction" → 236220 fails the test.
 */

/** Cold-start prompt (full self-report). Run once as written. */
export const RBA_FEDERAL_MARKET_PROFILE_PROMPT = [
  'Build a federal market profile for RBA Engineering International PLLC',
  '(RBA Construction & Engineering, Springfield VA), an 8(a) firm in DC,',
  'Maryland and Virginia. Self-reported: $20M single / $45M aggregate bonding,',
  '40+ owned equipment assets, self-performs heavy civil, structural concrete,',
  'marine and bridge work; President is a PE and CCM. First establish what they',
  'actually win from their award history. Frame it as pathways in priority order:',
  'vehicles, sources sought and direct 8(a) routes, no single open bids. Include',
  'market size by buyer, who holds the vehicles, forecasts, buyer pain points,',
  'how PAE affects their defense buyers, 8(a) timing for this firm, named contacts',
  'with the question to ask each, and a readiness checklist including DSBS keywords.',
].join(' ');

/** Name-only second run — how much Mindy finds without self-report. */
export const RBA_NAME_ONLY_PROMPT =
  'Build a federal market profile for RBA Engineering International PLLC.';

/** Legal identity the chain must resolve (not VRBA / Nebraska). */
export const RBA_IDENTITY = {
  legalName: 'RBA Engineering International PLLC',
  uei: 'C9K6EE9JVDK7',
  tradeAlias: 'RBA Construction & Engineering',
  wrongHitOnAliasSearch: 'VRBA (Nebraska)',
} as const;

/**
 * Tool chain that produced the benchmark (ordered). Ask should follow the same
 * evidence order — awards before market-size NAICS.
 */
export const RBA_CHAIN_STEPS = [
  {
    step: 1,
    title: 'Find the company and what it really does',
    tools: [
      'search_contractors',
      'lookup_sam_entity',
      'get_contractor_profile',
      'get_contractor_award_history',
      'get_recipient_annual_obligations',
    ],
    note:
      'Award codes → 237310 bridges/roads, not 236220 buildings. Searching “RBA Construction” alone can hit the wrong firm.',
  },
  {
    step: 2,
    title: 'Add self-reported facts (not in federal data)',
    tools: [],
    note:
      'Bonding, equipment, PE/CCM, JV come from the prompt. Ask cannot invent them on the name-only run. Pedro/JV only if typed.',
  },
  {
    step: 3,
    title: 'Find the pathways',
    tools: [
      'find_opportunities',
      'search_sam_opportunities',
      'lookup_solicitation',
      'get_solicitation_documents',
      'get_agency_forecasts',
    ],
    note: 'Civil keywords; state VA, MD, DC. Vehicles / sources sought / forecasts — not single open bids as the frame.',
  },
  {
    step: 4,
    title: 'Find the vehicles',
    tools: ['search_past_contracts', 'search_idv_contracts', 'get_award_detail'],
    note:
      'Prefixes 693C7326D, 693C7320D, HQ003422D002. WOSB set-aside on Pentagon IDIQ only surfaces via get_award_detail.',
  },
  {
    step: 5,
    title: 'Size the market',
    tools: ['generate_market_report'],
    note:
      'Three runs: NAICS 237310 for VA, MD, DC AFTER awards establish that code. Top-buyer lists summed by hand for FHWA+NPS $470M.',
  },
  {
    step: 6,
    title: 'Contacts and policy',
    tools: ['lookup_federal_osbp', 'search_federal_contacts', 'get_legislation_status'],
    note:
      'Notice POCs first (Helson Roman, David Bogner, Terry Agena). lookup_federal_osbp → WHS SB office; search_federal_contacts for the rest. get_legislation_status → FY27 NDAA status.',
  },
  {
    step: 7,
    title: 'Outside Mindy (web)',
    tools: ['search_web'],
    note:
      'search_web for NPS deferred maintenance (CRS), Legacy Restoration Fund bills, Dec 11 highway extension, GAO reports, PAE sources, 8(a) rule changes. If available=false / empty — known gap, not a failure.',
  },
  {
    step: 8,
    title: 'Write-up rules',
    tools: [],
    note:
      'Pathways first. Vehicles / sources sought / direct awards only. PAE section. Buyer pain. Who-to-talk-to table. DSBS in checklist. No em dashes. No grading. Mid plan price was in the Claude draft — accidental; Ask must omit it.',
  },
] as const;

/** Pathway search expectations (step 3) — geography + civil framing + named pull-throughs. */
export const RBA_PATHWAY_SEARCH = {
  states: ['DC', 'MD', 'VA'] as const,
  civilQueryMustIncludeOneOf: ['bridge', 'highway', 'heavy civil', 'marine'] as const,
  mustNotQueryAlone: 'construction',
  namedLookups: [
    'Inspection MATOC',
    'Northeast MATOC',
    'JBAB',
    'NIH',
    'Capitol Perimeter',
  ] as const,
  forecastNames: ['Clara Barton', 'Rock Creek', 'Mahone Gate'] as const,
} as const;

/** Market size (step 5) — three per-state reports on award NAICS; ranks + FHWA/NPS sum by hand. */
export const RBA_MARKET_SIZE = {
  naics: '237310',
  notNaics: '236220',
  states: ['VA', 'MD', 'DC'] as const,
  calls: 3,
  noSetAside: true,
  fhwaNpsTotalHandSum: '$470M',
  ranks: { DC: 4, MD: 5, VA: 9 } as const,
  trap: 'set_aside on generate_market_report rewrites agency dollar figures',
} as const;

/** Contacts + policy (step 6) — notice POCs first; WHS OSBP; FY27 NDAA status (not bill text). */
export const RBA_CONTACTS_POLICY = {
  tools: ['lookup_federal_osbp', 'search_federal_contacts', 'get_legislation_status'] as const,
  noticePocsFirst: true,
  /** Named POCs from pathway solicitations in the Claude+MCP chain (not invented). */
  noticePocs: ['Helson Roman', 'David Bogner', 'Terry Agena'] as const,
  osbpAgency: 'WHS',
  osbpResult: 'WHS small business office',
  buyerAgencies: ['FHWA', 'NPS', 'WHS'] as const,
  neverAgencyStateCode: 'VA',
  legislationQuery: 'FY2027 NDAA',
  legislationIsStatusOnly: true,
  eachContactNeedsQuestion: true,
} as const;

/** Outside-Mindy web (step 7) — Ask `search_web` (Serper); gap ≠ failure when unavailable. */
export const RBA_OUTSIDE_WEB = {
  tool: 'search_web',
  topics: [
    'NPS deferred maintenance (CRS)',
    'Legacy Restoration Fund bills',
    'Dec 11 highway extension',
    'GAO reports',
    'PAE sources',
    '8(a) rule changes',
  ] as const,
  /** Ask without Serper / empty hits must disclose the gap — never invent CRS/bill/GAO/PAE content. */
  notAFailureWithoutWeb: true,
  discloseGap: true,
  doNotFabricate: true,
} as const;

/**
 * Write-up rules (step 8) — gold-master shell + bans.
 * Synonym / ban lists are the SINGLE source for `fmp-writeup-validate.ts` and its unit tests.
 */
export const RBA_WRITEUP = {
  pathwaysFirst: true,
  /** Frame = vehicles → sources sought → direct awards only (no single open-bid list). */
  pathwayFrameOnly: ['vehicles', 'sources sought', 'direct awards'] as const,
  noSingleOpenBidList: true,
  paeSectionRequired: true,
  buyerPainRequired: true,
  whoToTalkToTable: true,
  dsbsInChecklist: true,
  noEmDashes: true,
  noGradingCompany: true,
  /**
   * Claude draft included a Mid plan / $5–10K CTA. Accidental — not an Ask acceptance
   * requirement. Ask must omit pricing CTAs from the profile write-up.
   */
  midPlanPriceInBenchmarkOnly: true,
  omitMidPlanPrice: true,
  sectionOrder: [
    'pathways in priority order',
    'PAE / defense oversight',
    'buyer pain points',
    'who to talk to and what to say',
    'readiness checklist with DSBS keywords',
  ] as const,
  /** Headings ignored when deciding pathways-first (cover / about / exec). */
  skipHeadingsForPathwaysFirst: [
    /\bthe read\b/i,
    /\bexecutive summary\b/i,
    /\babout (the )?(company|firm|document)\b/i,
    /\bhow to read\b/i,
    /\bsources and method\b/i,
    /\bmethod(ology)?\b/i,
  ] as readonly RegExp[],
  /** First substantive section must match one of these (pathway frame). */
  pathwayHeadingSynonyms: [
    /\bpathways?\b/i,
    /\bvehicles?\b/i,
    /\bMATOC\b/i,
    /\bsources sought\b/i,
    /\bdirect (8\(a\)|award)/i,
    /\bin priority order\b/i,
  ] as readonly RegExp[],
  whoToTalkHeadingSynonyms: [
    /\bwho to talk to\b/i,
    /\bwhat to say\b/i,
    /\bnamed contacts?\b/i,
    /\bcontacts? (and|&) questions?\b/i,
  ] as readonly RegExp[],
  /** Table column labels that count as the who-to-talk-to table. */
  whoToTalkTableColumnHints: [
    /\bcontact\b/i,
    /\bname\b/i,
    /\bwho\b/i,
    /\bquestion\b/i,
    /\bwhat to (ask|say)\b/i,
    /\bsay\b/i,
  ] as readonly RegExp[],
  buyerPainHeadingSynonyms: [
    /\bpain\b/i,
    /\bunder pressure\b/i,
    /\bbuyers? (are|under)\b/i,
    /\bwhat (these )?buyers\b/i,
    /\bpressure to fix\b/i,
  ] as readonly RegExp[],
  checklistHeadingSynonyms: [
    /\breadiness\b/i,
    /\bchecklist\b/i,
    /\bwhat (these )?buyers will ask\b/i,
    /\bask to see\b/i,
  ] as readonly RegExp[],
  paeHeadingSynonyms: [
    /\bPAE\b/i,
    /\bdefense (construction )?oversight\b/i,
    /\bNavy construction\b/i,
    /\bwho owns defense\b/i,
  ] as readonly RegExp[],
  /** Triggers conditional PAE hard-require (customer text or tool digest). */
  defenseBuyerSignals: [
    /\bPAE\b/i,
    /\bdefense\b/i,
    /\bPentagon\b/i,
    /\bWHS\b/i,
    /\bNDAA\b/i,
    /\bNavy construction\b/i,
    /\bDoD\b/i,
    /\bDepartment of Defense\b/i,
  ] as readonly RegExp[],
  /** Company-rating phrasing only — not GS/wage grade or "small business". */
  gradingBanPhrases: [
    /\bwe grade\b/i,
    /\boverall grade\b/i,
    /\bscore of\b/i,
    /\bgrading (the )?(company|firm)\b/i,
    /\b(company|firm) grade\b/i,
    /\brated (an? )?[A-F][+-]?\b/i,
    /\bgrade:\s*[A-F][+-]?\b/i,
  ] as readonly RegExp[],
  /**
   * Pricing CTA bans. Must NOT match market dollars ($470M) or "acquisition plan" / QASP.
   */
  midCtaBanPhrases: [
    /\bMid plan\b/i,
    /\bmid-tier plan\b/i,
    /\$\s*5\s*[–—-]\s*\$?\s*10\s*K\b/i,
    /\$\s*5K\s*[–—-]\s*\$?\s*10K\b/i,
    /\bupgrade to\b/i,
    /\bbook a\b/i,
  ] as readonly RegExp[],
  openBidSoftWarn: [
    /\bopen (opportunit|bids?|RFPs?)\b/i,
    /\bcurrent (open )?RFPs?\b/i,
    /\bsingle open bids?\b/i,
  ] as readonly RegExp[],
} as const;

/** Vehicle follow-through (step 4) — prefixes from the Claude+MCP chain; WOSB only via award detail. */
export const RBA_VEHICLE_SEARCH = {
  piidPrefixes: ['693C7326D', '693C7320D', 'HQ003422D002'] as const,
  idvSearchType: 'task' as const,
  tools: ['search_past_contracts', 'search_idv_contracts', 'get_award_detail'] as const,
  pentagonIdiq: {
    prefix: 'HQ003422D002',
    setAside: 'women-owned small business',
    setAsideOnlyOn: 'get_award_detail',
    ends: 'Sept 26, 2027',
  },
} as const;

/** Expected structured self-report from the cold prompt (Pedro/JV only if typed — they are not). */
export const RBA_COLD_SELF_REPORT = {
  bonding: '$20M single / $45M aggregate bonding',
  equipment: '40+ owned equipment assets',
  credentialsIncludes: ['PE', 'CCM'],
  selfPerformsIncludes: ['heavy civil', 'structural concrete', 'marine', 'bridge'],
  jointVenture: null as string | null,
} as const;

/** Grading checklist — answers to compare against. */
export const RBA_GRADING = {
  primaryNaics: '237310',
  notPrimaryNaics: '236220',
  totalObligated: '$42.5M',
  awardCount: 7,
  homeBuyers: ['FHWA Eastern Federal Lands', 'NPS'],
  eightACodedAwards: 'none',
  eightAExit: 'December 22, 2031',
  eightATransitional: 'about December 22, 2026',
  topPathway: {
    name: 'Inspection MATOC',
    solicitation: '693C73-27-R-000006',
    capacity: '$60M',
    smallBusinessSeats: '2 of 4',
  },
  jbabMacc: {
    id: 'FA706027RXXX2',
    due: 'Nov 30',
    naics: '236210',
    note: 'needs a coverage check',
  },
  pentagonIdiq: {
    setAside: 'women-owned small business',
    ends: 'Sept 26, 2027',
  },
  matocOrderRangeVsRba: {
    matoc: '$50K to $3M',
    rbaAwards: '$3.3M to $7.2M',
  },
  ranks: { DC: 4, MD: 5, VA: 9 },
  noticePocs: ['Helson Roman', 'David Bogner', 'Terry Agena'],
  osbp: 'WHS small business office',
  legislation: 'FY2027 NDAA status',
  outsideWebTopics: [
    'NPS deferred maintenance (CRS)',
    'Legacy Restoration Fund bills',
    'Dec 11 highway extension',
    'GAO reports',
    'PAE sources',
    '8(a) rule changes',
  ],
  outsideWebWithoutAccess: 'known gap, not a failure',
  inspectionConflict: 'flagged as a question for the buyer',
  writeRules: {
    pathwaysFirst: true,
    pathwayFrameOnly: ['vehicles', 'sources sought', 'direct awards'],
    noSingleOpenBidList: true,
    paeSectionRequired: true,
    buyerPainRequired: true,
    whoToTalkToTable: true,
    dsbsInChecklist: true,
    noEmDashes: true,
    noGradingCompany: true,
    /** CTA Mid plan was accidental in the benchmark HTML — Ask must omit it. */
    midPlanPriceAccidental: true,
    omitMidPlanPrice: true,
  },
} as const;

/** Known traps — hitting these is a signal for the dev team, not silent pass. */
export const RBA_KNOWN_TRAPS = [
  'match_company_to_pathways errored on RBA',
  'generate_market_report set_aside filter changes agency dollar figures (documented as forecast-only)',
  'place-of-performance “VA” filter mixes in Veterans Affairs projects from other states',
  'Capitol Perimeter attachments could not be read',
] as const;

/** Benchmark document section order (gold master shell). */
export const RBA_BENCHMARK_SECTIONS = [
  'The read',
  'Six pathways, in priority order',
  'What RBA has already proven',
  'Where the money sits',
  'Where the money is moving',
  'Who owns defense construction now: the PAE shift',
  'What buyers are under pressure to fix',
  '8(a) timing and rules for RBA',
  'Who else is in this market',
  'Who to talk to and what to say',
  'What these buyers will ask to see',
  'Keep this market current with Mindy',
  'Sources and method',
] as const;
