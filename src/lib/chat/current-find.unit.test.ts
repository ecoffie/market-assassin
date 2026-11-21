import { describe, it, expect } from 'vitest';
import {
  classifyFindIntent,
  isOpenOnlyRequest,
  isMarketResearchRequest,
  isFederalMarketProfileRequest,
  filterToolsForTurn,
  enforceFindArgs,
  enforceMarketReportArgs,
  enforceFederalMarketProfileIdentityArgs,
  enforceFederalMarketProfilePathwayArgs,
  enforceFederalMarketProfileVehicleArgs,
  enforceFederalMarketProfileMarketSizeArgs,
  enforceFederalMarketProfileContactsArgs,
  extractProfileCompanyIdentity,
  extractProfileStates,
  extractAwardGeographyStates,
  extractSelfReportedProfileFacts,
  extractVehiclePiidPrefixes,
  derivePathwaySearchQuery,
  buildFmpPathwayFindArgs,
  buildFmpPathwaySupplementalCalls,
  FMP_CIVIL_PATHWAY_SUPPLEMENT_KEYWORDS,
  federalMarketProfileSelfReportNote,
  federalMarketProfilePathwayNote,
  federalMarketProfileVehicleNote,
  federalMarketProfileMarketSizeNote,
  federalMarketProfileContactsNote,
  federalMarketProfileOutsideWebNote,
  federalMarketProfileWriteupNote,
  hasSelfReportedProfileFacts,
  isTradeAliasCompany,
  inheritFindIntent,
  FEDERAL_MARKET_PROFILE_CHAT_CONTRACT,
} from './tool-selection';
import {
  RBA_FEDERAL_MARKET_PROFILE_PROMPT,
  RBA_NAME_ONLY_PROMPT,
  RBA_GRADING,
  RBA_IDENTITY,
  RBA_COLD_SELF_REPORT,
  RBA_PATHWAY_SEARCH,
  RBA_VEHICLE_SEARCH,
  RBA_MARKET_SIZE,
  RBA_CONTACTS_POLICY,
  RBA_OUTSIDE_WEB,
  RBA_WRITEUP,
} from './__fixtures__/rba-federal-market-profile';
import { CURRENT_FIND_CHAT_CONTRACT, P2_FIRST_TURN_INSTRUCTIONS } from '@/lib/mcp/potato-journey';

const def = (name: string) => ({ type: 'function', function: { name } });
const CHAT_TOOLS = ['find_opportunities', 'search_sam_opportunities', 'get_expiring_contracts', 'lookup_solicitation', 'get_buying_offices'].map(def);
const names = (d: Array<{ function?: Record<string, unknown> }>) => d.map((x) => String(x.function?.name));

describe('classifyFindIntent (mirrors the MCP P2 classes)', () => {
  it.each([
    ['What open opportunities are there for janitorial services in Florida?', 'CURRENT_FIND'], // Eric's side-by-side Q
    ['What security guard opportunities are open right now?', 'CURRENT_FIND'],
    ["Where's the money for HVAC in Texas?", 'CURRENT_FIND'],
    ['I sell cybersecurity services and want to sell to the Navy', 'CURRENT_FIND'],
    ['Find opportunities for zzqx widget polishing', 'CURRENT_FIND'],
    ['Show me W912DY26R0001', 'KNOWN_ID'],
    ['Who is the incumbent on 70Z08726QKEYWEST?', 'KNOWN_ID'],
    ['What happened to the bid we submitted to Indian Head last month?', 'HISTORICAL'],
    ['Which security guard contracts are expiring in the next 12 months?', 'OTHER'],
    ['How do I write a capability statement?', 'OTHER'],
    ['Which Navy offices buy facilities support services?', 'OTHER'],
  ])('%s -> %s', (q, want) => expect(classifyFindIntent(q)).toBe(want));
});

describe('isOpenOnlyRequest: only an explicit restriction narrows to open solicitations', () => {
  it.each([
    ['What open opportunities are there for janitorial in Florida?', false],
    ['Show me only open solicitations for janitorial in FL', true],
    ['janitorial bids on SAM only', true],
    ['what can I bid on right now, no recompetes', true],
    ['what is biddable now for HVAC?', true],
  ])('%s -> %s', (q, want) => expect(isOpenOnlyRequest(q as string)).toBe(want));
});

describe('isMarketResearchRequest (packaged generate_market_report orchestration)', () => {
  it.each([
    ['Build a comprehensive federal market research report for my company.', true],
    ['Generate a market research report for RBA Construction in Hawaii', true],
    ['Write a full market report on janitorial services', true],
    ['Which agencies buy 541512?', false],
    ['What open opportunities are there for janitorial in Florida?', false],
  ])('%s -> %s', (q, want) => expect(isMarketResearchRequest(q as string)).toBe(want));
});

describe('isFederalMarketProfileRequest (RBA pathway profile — awards before NAICS)', () => {
  it('accepts the frozen RBA cold prompt and the name-only prompt', () => {
    expect(isFederalMarketProfileRequest(RBA_FEDERAL_MARKET_PROFILE_PROMPT)).toBe(true);
    expect(isFederalMarketProfileRequest(RBA_NAME_ONLY_PROMPT)).toBe(true);
  });
  it('does not treat a keyword market research report as a federal market profile', () => {
    expect(isFederalMarketProfileRequest('Generate a market research report for RBA Construction in Hawaii')).toBe(false);
    expect(isMarketResearchRequest(RBA_FEDERAL_MARKET_PROFILE_PROMPT)).toBe(false);
  });
  it('fixture grades primary NAICS as 237310 not 236220', () => {
    expect(RBA_GRADING.primaryNaics).toBe('237310');
    expect(RBA_GRADING.notPrimaryNaics).toBe('236220');
  });
  it('host contract requires awards before NAICS and forbids construction→236220 assumption', () => {
    expect(FEDERAL_MARKET_PROFILE_CHAT_CONTRACT).toMatch(/get_contractor_award_history/);
    expect(FEDERAL_MARKET_PROFILE_CHAT_CONTRACT).toMatch(/236220/);
    expect(FEDERAL_MARKET_PROFILE_CHAT_CONTRACT).toMatch(/pathways first/i);
    expect(FEDERAL_MARKET_PROFILE_CHAT_CONTRACT).toMatch(/No em dashes/);
  });
});

describe('Federal Market Profile identity gate (VRBA trap)', () => {
  it('extracts legal name + trade alias from the RBA cold prompt', () => {
    const id = extractProfileCompanyIdentity(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    expect(id.legalName).toBe(RBA_IDENTITY.legalName);
    expect(id.aliases.some((a) => /RBA Construction/i.test(a))).toBe(true);
    expect(isTradeAliasCompany('RBA Construction', id)).toBe(true);
    expect(isTradeAliasCompany('RBA Construction & Engineering', id)).toBe(true);
    expect(isTradeAliasCompany(RBA_IDENTITY.legalName, id)).toBe(false);
  });
  it('extracts legal name from the name-only prompt', () => {
    const id = extractProfileCompanyIdentity(RBA_NAME_ONLY_PROMPT);
    expect(id.legalName).toBe(RBA_IDENTITY.legalName);
  });
  it('rewrites award-history "RBA Construction" to the legal PLLC name', () => {
    const r = enforceFederalMarketProfileIdentityArgs(
      'get_contractor_award_history',
      JSON.stringify({ company: 'RBA Construction' }),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    expect(JSON.parse(r.args)).toEqual({ company: RBA_IDENTITY.legalName });
    expect(r.changes).toContain('legal_name_enforced');
  });
  it('fills empty award-history company from the prompt (forced round-1 call)', () => {
    const r = enforceFederalMarketProfileIdentityArgs(
      'get_contractor_award_history',
      '{}',
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    expect(JSON.parse(r.args).company).toBe(RBA_IDENTITY.legalName);
  });
  it('rewrites lookup_sam_entity name and get_contractor_profile company_name', () => {
    const sam = enforceFederalMarketProfileIdentityArgs(
      'lookup_sam_entity',
      JSON.stringify({ name: 'RBA Construction & Engineering' }),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    expect(JSON.parse(sam.args).name).toBe(RBA_IDENTITY.legalName);
    const profile = enforceFederalMarketProfileIdentityArgs(
      'get_contractor_profile',
      JSON.stringify({ company_name: 'RBA Construction' }),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    expect(JSON.parse(profile.args).company_name).toBe(RBA_IDENTITY.legalName);
  });
  it('does not rewrite identity tools on a non-profile ask', () => {
    const r = enforceFederalMarketProfileIdentityArgs(
      'get_contractor_award_history',
      JSON.stringify({ company: 'RBA Construction' }),
      'Who is RBA Construction?',
    );
    expect(r.changes).toEqual([]);
    expect(JSON.parse(r.args).company).toBe('RBA Construction');
  });
});

describe('Federal Market Profile self-report (step 2 — not federal data)', () => {
  it('parses bonding, equipment, PE/CCM, and self-perform from the cold prompt', () => {
    const f = extractSelfReportedProfileFacts(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    expect(f.bonding).toBe(RBA_COLD_SELF_REPORT.bonding);
    expect(f.equipment).toBe(RBA_COLD_SELF_REPORT.equipment);
    for (const c of RBA_COLD_SELF_REPORT.credentialsIncludes) {
      expect(f.credentials).toMatch(new RegExp(c, 'i'));
    }
    for (const s of RBA_COLD_SELF_REPORT.selfPerformsIncludes) {
      expect(f.selfPerforms).toMatch(new RegExp(s, 'i'));
    }
    expect(f.jointVenture).toBeNull();
    expect(hasSelfReportedProfileFacts(f)).toBe(true);
  });
  it('name-only prompt has no self-report and the note bans inventing', () => {
    const f = extractSelfReportedProfileFacts(RBA_NAME_ONLY_PROMPT);
    expect(hasSelfReportedProfileFacts(f)).toBe(false);
    const note = federalMarketProfileSelfReportNote(RBA_NAME_ONLY_PROMPT);
    expect(note).toMatch(/none provided/i);
    expect(note).toMatch(/Do not invent bonding/i);
  });
  it('cold prompt note lists bonding and forbids adding beyond the list', () => {
    const note = federalMarketProfileSelfReportNote(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    expect(note).toMatch(/\$20M single/);
    expect(note).toMatch(/40\+ owned equipment/);
    expect(note).toMatch(/not from SAM/i);
    expect(note).toMatch(/Do not add bonding/);
  });
  it('does not invent Pedro or a JV when they were not typed', () => {
    const f = extractSelfReportedProfileFacts(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    expect(f.jointVenture).toBeNull();
    expect(JSON.stringify(f)).not.toMatch(/Pedro/i);
    const note = federalMarketProfileSelfReportNote(RBA_FEDERAL_MARKET_PROFILE_PROMPT) || '';
    expect(note).not.toMatch(/Pedro/i);
    expect(note).not.toMatch(/joint venture/i);
  });
});

describe('Federal Market Profile pathways (step 3 — civil + Mid-Atlantic)', () => {
  it('name-only FMP FIND pin uses award geography + civil query (not empty {}, not award-NAICS-only)', () => {
    const awardJson = JSON.stringify({
      history: {
        recentAwards: [
          { title: 'Bridge', state: 'VA', amount: 1 },
          { title: 'Parkway', state: 'DC', amount: 2 },
          { title: 'Road', where: 'MD', amount: 3 },
        ],
      },
    });
    expect(extractAwardGeographyStates([awardJson]).sort()).toEqual(['DC', 'MD', 'VA']);
    expect(extractProfileStates(RBA_NAME_ONLY_PROMPT)).toEqual([]);
    const args = buildFmpPathwayFindArgs(RBA_NAME_ONLY_PROMPT, {
      awardStates: extractAwardGeographyStates([awardJson]),
    });
    expect(args.query).toMatch(/highway|bridge|heavy civil/i);
    expect(String(args.location).split(',').sort()).toEqual(['DC', 'MD', 'VA']);
    // Award NAICS must NOT be pinned — JBAB/inspection/Capitol live on adjacent codes.
    expect(args.advanced).toBeUndefined();
  });

  it('host pathway supplements name inspection MATOC, Capitol, JBAB, and GWMP forecasts', () => {
    const calls = buildFmpPathwaySupplementalCalls(RBA_NAME_ONLY_PROMPT, {
      awardStates: ['VA', 'MD', 'DC'],
    });
    expect(calls.map((c) => c.name)).toEqual([
      'search_sam_opportunities',
      'search_sam_opportunities',
      'search_sam_opportunities',
      'get_agency_forecasts',
    ]);
    const keywords = calls
      .filter((c) => c.name === 'search_sam_opportunities')
      .map((c) => String(c.args.keyword));
    expect(keywords).toEqual([...FMP_CIVIL_PATHWAY_SUPPLEMENT_KEYWORDS]);
    expect(String(calls[0].args.state).split(',').sort()).toEqual(['DC', 'MD', 'VA']);
    expect(calls[3].args.keyword).toMatch(/GWMP|parkway/i);
    // Distinctive keywords must survive pathway enforce (not rewritten to civil default).
    for (const kw of keywords) {
      const r = enforceFederalMarketProfilePathwayArgs(
        'search_sam_opportunities',
        JSON.stringify({ keyword: kw, state: 'VA,MD,DC' }),
        RBA_NAME_ONLY_PROMPT,
        { awardStates: ['VA', 'MD', 'DC'] },
      );
      expect(JSON.parse(r.args).keyword).toBe(kw);
    }
  });

  it('pathway enforce fills states from award geography when the prompt has none', () => {
    const r = enforceFederalMarketProfilePathwayArgs(
      'find_opportunities',
      '{}',
      RBA_NAME_ONLY_PROMPT,
      { awardStates: ['VA', 'MD', 'DC'] },
    );
    expect(r.changes).toEqual(expect.arrayContaining([
      'pathway_states_enforced',
      'pathway_civil_query_enforced',
    ]));
    const a = JSON.parse(r.args) as { location: string; query: string; advanced?: { naics?: string } };
    expect(a.location.split(',').sort()).toEqual(['DC', 'MD', 'VA']);
    expect(a.query).toMatch(/highway|bridge|heavy civil/i);
    expect(a.advanced?.naics).toBeUndefined();
  });

  it('pathway enforce strips a buildings NAICS the planner invented from construction', () => {
    const r = enforceFederalMarketProfilePathwayArgs(
      'find_opportunities',
      JSON.stringify({ query: 'highway bridge', location: 'VA,MD,DC', advanced: { naics: '236220' } }),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    expect(r.changes).toContain('pathway_buildings_naics_stripped');
    const a = JSON.parse(r.args) as { advanced?: { naics?: string } };
    expect(a.advanced?.naics).toBeUndefined();
  });

  it('extracts DC, MD, VA from the cold prompt', () => {
    expect(extractProfileStates(RBA_FEDERAL_MARKET_PROFILE_PROMPT).sort()).toEqual(
      [...RBA_PATHWAY_SEARCH.states].sort(),
    );
  });
  it('derives civil keywords from self-perform — not bare construction', () => {
    const q = derivePathwaySearchQuery(RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    expect(RBA_PATHWAY_SEARCH.civilQueryMustIncludeOneOf.some((w) => q.toLowerCase().includes(w))).toBe(true);
    expect(q.toLowerCase()).not.toBe(RBA_PATHWAY_SEARCH.mustNotQueryAlone);
  });
  it('rewrites FIND Hawaii/construction into VA,MD,DC + civil query', () => {
    const r = enforceFederalMarketProfilePathwayArgs(
      'find_opportunities',
      JSON.stringify({ query: 'construction', location: 'HI' }),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    const a = JSON.parse(r.args);
    expect(a.location).toMatch(/VA/);
    expect(a.location).toMatch(/MD/);
    expect(a.location).toMatch(/DC/);
    expect(a.query.toLowerCase()).not.toBe('construction');
    expect(r.changes).toEqual(expect.arrayContaining(['pathway_states_enforced', 'pathway_civil_query_enforced']));
  });
  it('rewrites search_sam_opportunities the same way', () => {
    const r = enforceFederalMarketProfilePathwayArgs(
      'search_sam_opportunities',
      JSON.stringify({ keyword: '8(a) construction', state: 'VA' }),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    const a = JSON.parse(r.args);
    expect(a.state.split(',').sort()).toEqual(['DC', 'MD', 'VA']);
    expect(a.keyword.toLowerCase()).toMatch(/bridge|civil|highway|marine/);
  });
  it('forecasts get civil keyword but state is not forced (PoP sparsity)', () => {
    const r = enforceFederalMarketProfilePathwayArgs(
      'get_agency_forecasts',
      JSON.stringify({ keyword: 'construction' }),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    const a = JSON.parse(r.args);
    expect(a.state).toBeUndefined();
    expect(a.keyword.toLowerCase()).not.toBe('construction');
  });
  it('pathway note names Mid-Atlantic states and civil keywords', () => {
    const note = federalMarketProfilePathwayNote(RBA_FEDERAL_MARKET_PROFILE_PROMPT) || '';
    expect(note).toMatch(/VA/);
    expect(note).toMatch(/find_opportunities/);
    expect(note).toMatch(/get_agency_forecasts/);
    expect(note).toMatch(/Clara Barton|civil\/bridge/i);
  });
});

describe('Federal Market Profile vehicles (step 4 — holders + WOSB on award detail)', () => {
  it('fixture pins the three PIID prefixes and WOSB-only-on-award-detail', () => {
    expect([...RBA_VEHICLE_SEARCH.piidPrefixes]).toEqual(['693C7326D', '693C7320D', 'HQ003422D002']);
    expect(RBA_VEHICLE_SEARCH.pentagonIdiq.setAsideOnlyOn).toBe('get_award_detail');
    expect(RBA_VEHICLE_SEARCH.pentagonIdiq.setAside).toMatch(/women-owned/i);
    expect(RBA_GRADING.pentagonIdiq.setAside).toMatch(/women-owned/i);
  });
  it('extracts PIID prefixes when the customer pastes them', () => {
    const text = `${RBA_NAME_ONLY_PROMPT} Check holders on 693C7326D and HQ003422D002.`;
    expect(extractVehiclePiidPrefixes(text).sort()).toEqual(['693C7326D', 'HQ003422D002'].sort());
  });
  it('forces search_idv_contracts to search_type:task when parent_id is set', () => {
    const r = enforceFederalMarketProfileVehicleArgs(
      'search_idv_contracts',
      JSON.stringify({ parent_id: 'CONT_IDV_HQ003422D002_9700', search_type: 'idv' }),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    expect(JSON.parse(r.args).search_type).toBe('task');
    expect(r.changes).toContain('vehicle_idv_task_enforced');
  });
  it('moves a PIID-shaped keyword onto piid_prefix and clears stray state', () => {
    const r = enforceFederalMarketProfileVehicleArgs(
      'search_past_contracts',
      JSON.stringify({ keyword: '693C7326D', state: 'HI' }),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    const a = JSON.parse(r.args);
    expect(a.piid_prefix).toBe('693C7326D');
    expect(a.keyword).toBeUndefined();
    expect(a.state).toBeUndefined();
  });
  it('vehicle note requires get_award_detail for set-aside', () => {
    const note = federalMarketProfileVehicleNote(RBA_FEDERAL_MARKET_PROFILE_PROMPT) || '';
    expect(note).toMatch(/search_past_contracts/);
    expect(note).toMatch(/search_type:"task"/);
    expect(note).toMatch(/get_award_detail/);
    expect(note).toMatch(/women-owned small business/i);
  });
  it('host contract names the vehicle follow-through', () => {
    expect(FEDERAL_MARKET_PROFILE_CHAT_CONTRACT).toMatch(/piid_prefix/);
    expect(FEDERAL_MARKET_PROFILE_CHAT_CONTRACT).toMatch(/search_type:"task"/);
    expect(FEDERAL_MARKET_PROFILE_CHAT_CONTRACT).toMatch(/get_award_detail/);
  });
});

describe('Federal Market Profile market size (step 5 — 237310 × VA/MD/DC)', () => {
  it('fixture pins three per-state calls on 237310 and hand-sum / ranks', () => {
    expect(RBA_MARKET_SIZE.naics).toBe('237310');
    expect(RBA_MARKET_SIZE.notNaics).toBe('236220');
    expect(RBA_MARKET_SIZE.calls).toBe(3);
    expect([...RBA_MARKET_SIZE.states].sort()).toEqual(['DC', 'MD', 'VA']);
    expect(RBA_MARKET_SIZE.fhwaNpsTotalHandSum).toBe('$470M');
    expect(RBA_MARKET_SIZE.ranks).toEqual({ DC: 4, MD: 5, VA: 9 });
    expect(RBA_GRADING.ranks).toEqual({ DC: 4, MD: 5, VA: 9 });
  });
  it('strips set_aside and rejects buildings NAICS + construction keyword + Hawaii', () => {
    const r = enforceFederalMarketProfileMarketSizeArgs(
      'generate_market_report',
      JSON.stringify({
        naics: '236220',
        keyword: 'construction',
        state: 'HI',
        set_aside: '8(a)',
        client_name: 'RBA Construction',
      }),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    const a = JSON.parse(r.args);
    expect(a.set_aside).toBeUndefined();
    expect(a.naics).toBeUndefined();
    expect(a.keyword).toBeUndefined();
    expect(a.state).toBeUndefined();
    expect(a.client_name).toBe(RBA_IDENTITY.legalName);
    expect(r.changes).toEqual(expect.arrayContaining([
      'market_size_set_aside_stripped',
      'market_size_rejected_buildings_naics',
      'market_size_rejected_construction_keyword',
      'market_size_off_profile_state_cleared',
      'market_size_client_legal_name',
    ]));
  });
  it('rejects a multi-state comma list on one call (must be three calls)', () => {
    const r = enforceFederalMarketProfileMarketSizeArgs(
      'generate_market_report',
      JSON.stringify({ naics: '237310', state: 'VA,MD,DC' }),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    expect(JSON.parse(r.args).state).toBeUndefined();
    expect(JSON.parse(r.args).naics).toBe('237310');
    expect(r.changes).toContain('market_size_multi_state_rejected');
  });
  it('keeps a single in-profile state + award NAICS', () => {
    const r = enforceFederalMarketProfileMarketSizeArgs(
      'generate_market_report',
      JSON.stringify({ naics: '237310', state: 'Virginia' }),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    const a = JSON.parse(r.args);
    expect(a.naics).toBe('237310');
    expect(a.state).toBe('VA');
  });
  it('market-size note requires three calls and bans set_aside', () => {
    const note = federalMarketProfileMarketSizeNote(RBA_FEDERAL_MARKET_PROFILE_PROMPT) || '';
    expect(note).toMatch(/ONCE PER state/i);
    expect(note).toMatch(/237310|award-derived|award history/i);
    expect(note).toMatch(/Do NOT pass set_aside/);
    expect(note).toMatch(/top-buyer|competitor list/i);
  });
});

describe('Federal Market Profile contacts + policy (step 6)', () => {
  it('fixture pins notice POCs, WHS OSBP, and FY27 NDAA status-only', () => {
    expect([...RBA_CONTACTS_POLICY.tools]).toEqual([
      'lookup_federal_osbp',
      'search_federal_contacts',
      'get_legislation_status',
    ]);
    expect([...RBA_CONTACTS_POLICY.noticePocs]).toEqual([
      'Helson Roman',
      'David Bogner',
      'Terry Agena',
    ]);
    expect(RBA_CONTACTS_POLICY.osbpAgency).toBe('WHS');
    expect(RBA_CONTACTS_POLICY.legislationQuery).toBe('FY2027 NDAA');
    expect(RBA_CONTACTS_POLICY.legislationIsStatusOnly).toBe(true);
    expect(RBA_GRADING.noticePocs).toEqual(RBA_CONTACTS_POLICY.noticePocs);
    expect(RBA_GRADING.osbp).toBe('WHS small business office');
    expect(RBA_GRADING.legislation).toBe('FY2027 NDAA status');
  });
  it('fills empty / bare NDAA legislation query with FY2027 NDAA', () => {
    const empty = enforceFederalMarketProfileContactsArgs(
      'get_legislation_status',
      JSON.stringify({}),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    expect(JSON.parse(empty.args).query).toBe('FY2027 NDAA');
    expect(empty.changes).toContain('contacts_legislation_query_ndaa');
    const bare = enforceFederalMarketProfileContactsArgs(
      'get_legislation_status',
      JSON.stringify({ query: 'NDAA' }),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    expect(JSON.parse(bare.args).query).toBe('FY2027 NDAA');
    expect(bare.changes).toContain('contacts_legislation_query_fy27');
  });
  it('rewrites Pentagon/DoD OSBP agency to WHS', () => {
    const r = enforceFederalMarketProfileContactsArgs(
      'lookup_federal_osbp',
      JSON.stringify({ agency: 'Pentagon' }),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    expect(JSON.parse(r.args).agency).toBe('WHS');
    expect(r.changes).toContain('contacts_osbp_whs');
  });
  it('clears bare VA/MD/DC agency on OSBP and contacts (state≠agency)', () => {
    for (const tool of ['lookup_federal_osbp', 'search_federal_contacts'] as const) {
      const r = enforceFederalMarketProfileContactsArgs(
        tool,
        JSON.stringify({ agency: 'VA' }),
        RBA_FEDERAL_MARKET_PROFILE_PROMPT,
      );
      expect(JSON.parse(r.args).agency).toBeUndefined();
      expect(r.changes).toContain('contacts_state_code_agency_cleared');
    }
    const keep = enforceFederalMarketProfileContactsArgs(
      'lookup_federal_osbp',
      JSON.stringify({ agency: 'WHS' }),
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    expect(JSON.parse(keep.args).agency).toBe('WHS');
    expect(keep.changes).toEqual([]);
  });
  it('contacts note requires notice POCs, WHS OSBP, FY27 NDAA status-only, and questions', () => {
    const note = federalMarketProfileContactsNote(RBA_FEDERAL_MARKET_PROFILE_PROMPT) || '';
    expect(note).toMatch(/Helson Roman/);
    expect(note).toMatch(/WHS/);
    expect(note).toMatch(/FY2027 NDAA/);
    expect(note).toMatch(/STATUS only/i);
    expect(note).toMatch(/question to ask/i);
  });
});

describe('Federal Market Profile outside web + write-up (steps 7–8)', () => {
  it('fixture pins search_web + CRS / Legacy / Dec 11 / GAO / PAE / 8(a); gap ≠ failure', () => {
    expect(RBA_OUTSIDE_WEB.tool).toBe('search_web');
    expect(RBA_OUTSIDE_WEB.notAFailureWithoutWeb).toBe(true);
    expect(RBA_OUTSIDE_WEB.discloseGap).toBe(true);
    expect(RBA_OUTSIDE_WEB.doNotFabricate).toBe(true);
    expect([...RBA_OUTSIDE_WEB.topics]).toEqual([
      'NPS deferred maintenance (CRS)',
      'Legacy Restoration Fund bills',
      'Dec 11 highway extension',
      'GAO reports',
      'PAE sources',
      '8(a) rule changes',
    ]);
    expect(RBA_GRADING.outsideWebTopics).toEqual(RBA_OUTSIDE_WEB.topics);
    expect(RBA_GRADING.outsideWebWithoutAccess).toBe('known gap, not a failure');
    expect(RBA_WRITEUP.pathwaysFirst).toBe(true);
    expect(RBA_WRITEUP.noEmDashes).toBe(true);
    expect(RBA_WRITEUP.noGradingCompany).toBe(true);
    expect(RBA_WRITEUP.paeSectionRequired).toBe(true);
    expect(RBA_WRITEUP.buyerPainRequired).toBe(true);
    expect(RBA_WRITEUP.whoToTalkToTable).toBe(true);
    expect(RBA_WRITEUP.dsbsInChecklist).toBe(true);
    expect(RBA_WRITEUP.omitMidPlanPrice).toBe(true);
    expect(RBA_WRITEUP.noSingleOpenBidList).toBe(true);
    expect([...RBA_WRITEUP.pathwayFrameOnly]).toEqual(['vehicles', 'sources sought', 'direct awards']);
    expect(RBA_GRADING.writeRules.noEmDashes).toBe(true);
    expect(RBA_GRADING.writeRules.omitMidPlanPrice).toBe(true);
    expect(RBA_GRADING.writeRules.midPlanPriceAccidental).toBe(true);
  });
  it('outside-web note requires search_web and forbids fabrication', () => {
    const note = federalMarketProfileOutsideWebNote(RBA_FEDERAL_MARKET_PROFILE_PROMPT) || '';
    expect(note).toMatch(/search_web/);
    expect(note).toMatch(/CRS/);
    expect(note).toMatch(/Legacy Restoration Fund/);
    expect(note).toMatch(/Dec 11/);
    expect(note).toMatch(/GAO/);
    expect(note).toMatch(/PAE/);
    expect(note).toMatch(/8\(a\)/);
    expect(note).toMatch(/Do NOT fabricate/i);
    expect(FEDERAL_MARKET_PROFILE_CHAT_CONTRACT).toMatch(/call search_web/);
  });
  it('write-up note pins pathways-first frame, table, DSBS, bans em dashes/grading/Mid CTA', () => {
    const note = federalMarketProfileWriteupNote(RBA_FEDERAL_MARKET_PROFILE_PROMPT) || '';
    expect(note).toMatch(/Pathways FIRST/i);
    expect(note).toMatch(/vehicles, sources sought, and direct awards ONLY/i);
    expect(note).toMatch(/PAE/);
    expect(note).toMatch(/Buyer pain/i);
    expect(note).toMatch(/Who to talk to and what to say/i);
    expect(note).toMatch(/DSBS/);
    expect(note).toMatch(/No em dashes/i);
    expect(note).toMatch(/Do not grade/i);
    expect(note).toMatch(/Do NOT include a Mid plan/i);
    expect(FEDERAL_MARKET_PROFILE_CHAT_CONTRACT).toMatch(/Do NOT include a Mid plan/);
  });
  it('host contract names steps 6–8', () => {
    expect(FEDERAL_MARKET_PROFILE_CHAT_CONTRACT).toMatch(/Contacts \+ policy \(step 6\)/);
    expect(FEDERAL_MARKET_PROFILE_CHAT_CONTRACT).toMatch(/Outside Mindy \(step 7\)/);
    expect(FEDERAL_MARKET_PROFILE_CHAT_CONTRACT).toMatch(/Write-up \(step 8\)/);
  });
});

describe('filterToolsForTurn', () => {
  it('CURRENT_FIND: find_opportunities offered, the open-only search and expiring tool are not', () => {
    const r = filterToolsForTurn(CHAT_TOOLS, 'What open opportunities are there for janitorial services in Florida?');
    expect(names(r.defs)).toEqual(['find_opportunities', 'lookup_solicitation', 'get_buying_offices']);
    expect(r.removed.sort()).toEqual(['get_expiring_contracts', 'search_sam_opportunities']);
    expect(r).toMatchObject({ intent: 'CURRENT_FIND', openOnly: false, marketResearch: false, federalMarketProfile: false });
  });
  it('FEDERAL_MARKET_PROFILE: "sources sought" in the ask does not strip search_sam or force FIND-first', () => {
    const tools = [
      'find_opportunities',
      'search_sam_opportunities',
      'get_expiring_contracts',
      'get_contractor_award_history',
      'generate_market_report',
      'lookup_solicitation',
    ].map(def);
    const r = filterToolsForTurn(tools, RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    expect(r.federalMarketProfile).toBe(true);
    expect(r.marketResearch).toBe(false);
    expect(r.intent).toBe('OTHER');
    expect(names(r.defs)).toContain('search_sam_opportunities');
    expect(names(r.defs)).toContain('get_contractor_award_history');
    expect(names(r.defs)).toContain('generate_market_report');
    expect(r.removed).toEqual([]);
  });
  it('MARKET_RESEARCH: drops create_document and capability_market_match when generate_market_report is offered', () => {
    const tools = ['generate_market_report', 'create_document', 'capability_market_match', 'get_pricing_intel', 'find_opportunities'].map(def);
    const r = filterToolsForTurn(tools, 'Build a comprehensive federal market research report for my company.');
    expect(r.marketResearch).toBe(true);
    expect(r.federalMarketProfile).toBe(false);
    expect(names(r.defs)).toEqual(['generate_market_report', 'get_pricing_intel', 'find_opportunities']);
    expect(r.removed.sort()).toEqual(['capability_market_match', 'create_document']);
  });
  it('an explicit open-only request keeps search_sam_opportunities', () => {
    const r = filterToolsForTurn(CHAT_TOOLS, 'Show me only open solicitations for janitorial in FL');
    expect(names(r.defs)).toContain('search_sam_opportunities');
  });
  it('KNOWN_ID / HISTORICAL / recompete questions keep every tool they had before', () => {
    expect(filterToolsForTurn(CHAT_TOOLS, 'Show me W912DY26R0001').defs).toHaveLength(5);
    expect(filterToolsForTurn(CHAT_TOOLS, 'What happened to the bid we submitted last month?').defs).toHaveLength(5);
    expect(filterToolsForTurn(CHAT_TOOLS, 'Which security guard contracts are expiring in the next 12 months?').defs).toHaveLength(5);
  });
  it('card chat (allowlist without find_opportunities) is unaffected: search tools are never removed for lack of FIND', () => {
    const card = ['lookup_solicitation', 'get_solicitation_documents', 'search_sam_opportunities'].map(def);
    expect(names(filterToolsForTurn(card, 'What open opportunities are like this one?').defs)).toEqual(['lookup_solicitation', 'get_solicitation_documents', 'search_sam_opportunities']);
  });
});

describe('enforceMarketReportArgs: packaged report needs a measurement axis', () => {
  const Q = 'Build a comprehensive federal market research report for RBA Construction in Hawaii.';
  it('fills keyword + normalizes Hawaii → HI when the planner omitted the axis', () => {
    const r = enforceMarketReportArgs('generate_market_report', JSON.stringify({ client_name: 'RBA Construction', state: 'Hawaii' }), Q);
    const a = JSON.parse(r.args);
    expect(a.state).toBe('HI');
    expect(a.keyword).toBe('construction');
    expect(a.client_name).toBe('RBA Construction');
    expect(r.changes.sort()).toEqual(['keyword_from_customer', 'state_normalized']);
  });
  it('does not overwrite an explicit keyword/naics', () => {
    const r = enforceMarketReportArgs('generate_market_report', JSON.stringify({ keyword: 'janitorial', state: 'HI' }), Q);
    const a = JSON.parse(r.args);
    expect(a.keyword).toBe('janitorial');
    expect(a.state).toBe('HI');
    // May still fill a missing client_name from the ask — never the keyword.
    expect(r.changes.includes('keyword_from_customer')).toBe(false);
  });
  it('ignores other tools', () => {
    const r = enforceMarketReportArgs('find_opportunities', '{"query":"x"}', Q);
    expect(r).toEqual({ args: '{"query":"x"}', changes: [] });
  });
});

describe('enforceFindArgs: Ask Mindy sends find_opportunities what the MCP host (Claude) sends', () => {
  const OPEN_ONLY = JSON.stringify({ query: 'janitorial', location: 'Florida', horizons: { open_now: true, coming_back: false, coming_soon: false } });
  it('horizons the planner turned off come back; rows per horizon raised to 25', () => {
    const r = enforceFindArgs('find_opportunities', OPEN_ONLY, 'CURRENT_FIND', false);
    expect(JSON.parse(r.args)).toEqual({ query: 'janitorial', location: 'Florida', horizons: { open_now: true, coming_back: true, coming_soon: true }, limit_per_horizon: 25 });
    expect(r.changes).toEqual(['horizons', 'limit_per_horizon']);
  });
  it("a planner-chosen NAICS is removed (Eric's FL janitorial: 561720 narrowed 44 recompetes to 40)", () => {
    const r = enforceFindArgs('find_opportunities', JSON.stringify({ query: 'janitorial services', location: 'Florida', advanced: { naics: '561720' } }), 'CURRENT_FIND', false, []);
    expect(JSON.parse(r.args)).toEqual({ query: 'janitorial services', location: 'Florida', limit_per_horizon: 25 });
    expect(r.changes).toContain('untyped_naics');
  });
  it('a code the customer typed is kept; other advanced filters are kept', () => {
    const r = enforceFindArgs('find_opportunities', JSON.stringify({ query: 'cleaning', advanced: { naics: '561720,561730', set_aside: 'SDVOSB' } }), 'CURRENT_FIND', false, ['561720']);
    expect(JSON.parse(r.args).advanced).toEqual({ naics: '561720', set_aside: 'SDVOSB' });
  });
  it('omitted horizons stay omitted (= all three); an explicit higher limit is kept', () => {
    const r = enforceFindArgs('find_opportunities', JSON.stringify({ query: 'x', limit_per_horizon: 25 }), 'CURRENT_FIND', false);
    expect(r.changes).toEqual([]);
  });
  it('open-only keeps the horizons the customer asked for (rows and codes still aligned)', () => {
    const r = enforceFindArgs('find_opportunities', OPEN_ONLY, 'CURRENT_FIND', true);
    expect(JSON.parse(r.args).horizons).toEqual({ open_now: true, coming_back: false, coming_soon: false });
  });
  it('other intents, other tools and bad JSON are untouched', () => {
    expect(enforceFindArgs('find_opportunities', OPEN_ONLY, 'OTHER', false)).toEqual({ args: OPEN_ONLY, changes: [] });
    expect(enforceFindArgs('search_sam_opportunities', OPEN_ONLY, 'CURRENT_FIND', false)).toEqual({ args: OPEN_ONLY, changes: [] });
    expect(enforceFindArgs('find_opportunities', 'not json', 'CURRENT_FIND', false)).toEqual({ args: 'not json', changes: [] });
  });
});

describe('CURRENT_FIND contract parity: chat and the MCP host say the same load-bearing things', () => {
  it.each([
    [/find_opportunities ONCE/],
    [/Open now/],
    [/Coming back/],
    [/Coming soon/],
    [/unavailable into zero/i],
  ])('both contain %s', (re) => {
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(re);
    expect(CURRENT_FIND_CHAT_CONTRACT).toMatch(re);
  });
  it('both route a known solicitation id and a past bid to lookup_solicitation', () => {
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/lookup_solicitation/);
    expect(CURRENT_FIND_CHAT_CONTRACT).toMatch(/solicitation number or notice id: call lookup_solicitation/);
    expect(CURRENT_FIND_CHAT_CONTRACT).toMatch(/past bid .*lookup_solicitation/);
  });
});

describe('a short refinement inherits the previous FIND ("What about in Florida?")', () => {
  const PRIOR = 'What security guard opportunities are open right now?';
  it.each([
    ['What about in Florida?', 'CURRENT_FIND'],
    ['and Georgia?', 'CURRENT_FIND'],
    ['How about Texas instead', 'CURRENT_FIND'],
    ['in Virginia', 'CURRENT_FIND'],
  ])('%s after a FIND -> %s', (q, want) => expect(inheritFindIntent(q, PRIOR)).toBe(want));
  it('does not inherit without a FIND before it, for long or different questions, or for recompete follow-ups', () => {
    expect(inheritFindIntent('What about in Florida?', 'How do I write a capability statement?')).toBe('OTHER');
    expect(inheritFindIntent('What about in Florida?', null)).toBe('OTHER');
    expect(inheritFindIntent('What about the buying offices in Florida that handle these and who runs them?', PRIOR)).toBe('OTHER');
    expect(inheritFindIntent('What about the ones expiring next year?', PRIOR)).toBe('OTHER');
  });
  it('filterToolsForTurn applies the inherited FIND (open-only search not offered)', () => {
    const r = filterToolsForTurn(CHAT_TOOLS, 'What about in Florida?', PRIOR);
    expect(r.intent).toBe('CURRENT_FIND');
    expect(names(r.defs)).not.toContain('search_sam_opportunities');
  });
});
