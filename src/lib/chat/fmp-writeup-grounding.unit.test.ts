import { describe, expect, it } from 'vitest';
import {
  accumulateFmpEvidence,
  buildFmpCreateDocumentAnswerNote,
  buildFmpCreateDocumentInjectArgs,
  buildFmpHostDocModel,
  buildFmpWriteupGroundingNote,
  createDocumentArgsHaveUsableDocModel,
  FMP_DOC_TOOL_ROUND_MAX_TOKENS,
  formatObligationSnippet,
  fmpDocModelRichness,
  fmpPlannerMaxTokensForCreateDocument,
  flattenDocModelText,
  looksLikePersonContactName,
  requiredSnippetsForWriteup,
  resolveFmpCreateDocumentArgs,
  rewriteFmpAnswerDownloadLinks,
  shouldPreferPlannerFmpDocModel,
} from './fmp-writeup-grounding';
import { RBA_FEDERAL_MARKET_PROFILE_PROMPT } from './__fixtures__/rba-federal-market-profile';
import { validateFmpWriteup } from './fmp-writeup-validate';
import type { DocModel } from '@/lib/documents/model';
import { DOC_SCHEMA } from '@/lib/documents/model';

const AWARD_JSON = JSON.stringify({
  history: {
    summary: { totalObligations: 42_500_000, awardCount: 17 },
    topNaics: [{ naics: '237310', amount: 40_000_000, count: 14 }],
  },
  _meta: { grounded: true, award_count: 17, total_obligations: 42_500_000 },
});

const VEHICLE_JSON = JSON.stringify({
  items: [
    { parent_piid: '693C7326D0001', description: 'Inspection MATOC highway' },
    { parent_piid: 'HQ003422D0002', description: 'Pentagon IDIQ' },
  ],
});

const CONTACT_JSON = JSON.stringify({
  contacts: [
    { name: 'Helson Roman', office: 'FHWA notice POC' },
    { name: 'Spare Dla Person', agency: 'DLA Aviation' },
  ],
});

const WEB_JSON = JSON.stringify({
  results: [{ snippet: 'Firm exits 8(a) program in 2031 under current schedule.' }],
});

function goodSectionsWithSnippets(extra: string): DocModel['sections'] {
  return [
    {
      id: 'sec-path',
      heading: 'Six pathways, in priority order',
      blocks: [{
        type: 'paragraph' as const,
        id: 'p1',
        text: `Lead with Inspection MATOC. Primary NAICS 237310. Firm scale ${extra}. Exits 8(a) in 2031.`,
        claim: 'fact' as const,
        cites: ['s1'],
      }],
    },
    {
      id: 'sec-pae',
      heading: 'Who owns defense construction now: the PAE shift',
      blocks: [{
        type: 'paragraph' as const,
        id: 'p-pae',
        text: 'PAE now oversees several Navy construction buying offices.',
        claim: 'fact' as const,
        cites: ['s1'],
      }],
    },
    {
      id: 'sec-pain',
      heading: 'What buyers are under pressure to fix',
      blocks: [{
        type: 'paragraph' as const,
        id: 'p-pain',
        text: 'Deferred maintenance and highway timelines.',
        claim: 'fact' as const,
        cites: ['s1'],
      }],
    },
    {
      id: 'sec-who',
      heading: 'Who to talk to and what to say',
      blocks: [{
        type: 'table' as const,
        id: 't-who',
        columns: [
          { key: 'contact', label: 'Contact' },
          { key: 'question', label: 'Question to ask' },
        ],
        rows: [{ contact: 'Helson Roman', question: 'Ask about Inspection MATOC small-business seats.' }],
      }],
    },
    {
      id: 'sec-ready',
      heading: 'Readiness checklist',
      blocks: [{
        type: 'bullets' as const,
        id: 'b-ready',
        ordered: false,
        items: [
          { text: 'Update DSBS keywords for heavy civil and bridge.', claim: 'recommendation' as const },
        ],
      }],
    },
  ];
}

describe('fmp-writeup-grounding', () => {
  it('extracts dominant NAICS, obligations, vehicles, contacts, 2031, and self-report', () => {
    const evidence = accumulateFmpEvidence(
      [
        { tool: 'get_contractor_award_history', content: AWARD_JSON },
        { tool: 'search_past_contracts', content: VEHICLE_JSON },
        { tool: 'search_federal_contacts', content: CONTACT_JSON },
        { tool: 'search_web', content: WEB_JSON },
      ],
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    expect(evidence.dominantNaics).toBe('237310');
    expect(evidence.totalObligations).toBe('$42.5M');
    expect(evidence.awardCount).toBe(17);
    expect(evidence.vehicleTokens.some((t) => t.includes('MATOC') || t.includes('693C73'))).toBe(true);
    expect(evidence.contactNames[0]).toBe('Helson Roman');
    expect(evidence.eightAExitYear).toBe('2031');
    expect(evidence.selfReportLines.some((l) => /bonding/i.test(l))).toBe(true);
  });

  it('requiredSnippets includes NAICS, obligation, 2031, and a vehicle token when found', () => {
    const evidence = accumulateFmpEvidence(
      [
        { tool: 'get_contractor_award_history', content: AWARD_JSON },
        { tool: 'search_past_contracts', content: VEHICLE_JSON },
        { tool: 'search_web', content: WEB_JSON },
      ],
      '',
    );
    const snippets = requiredSnippetsForWriteup(evidence);
    expect(snippets).toContain('237310');
    expect(snippets).toContain('$42.5M');
    expect(snippets).toContain('2031');
    expect(snippets.some((s) => /MATOC|693C73|HQ0034/i.test(s))).toBe(true);
  });

  it('grounding note forbids Performance Assessment Evaluation and pins PAE instruction', () => {
    const evidence = accumulateFmpEvidence(
      [{ tool: 'get_contractor_award_history', content: AWARD_JSON }],
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    const note = buildFmpWriteupGroundingNote(evidence, RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    expect(note).toMatch(/defense construction oversight/i);
    expect(note).toMatch(/FORBIDDEN/);
    expect(note).toMatch(/Performance Assessment Evaluation/);
    expect(note).not.toMatch(/—/);
    expect(note).toContain('237310');
  });

  it('validateFmpWriteup hard-fails when a required snippet is missing', () => {
    const model: DocModel = {
      schema: DOC_SCHEMA,
      title: 'Profile',
      date: '2026-11-20',
      sources: [{ id: 's1', label: 'USAspending', kind: 'usaspending' }],
      sections: goodSectionsWithSnippets('$10M'),
    };
    const bad = validateFmpWriteup(model, {
      defenseBuyersAppear: true,
      requiredSnippets: ['237310', '$42.5M', '2031', 'MATOC'],
    });
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((i) => i.code === 'required_snippet' && i.message.includes('$42.5M'))).toBe(true);
  });

  it('validateFmpWriteup passes when all required snippets are present', () => {
    const model: DocModel = {
      schema: DOC_SCHEMA,
      title: 'Profile',
      date: '2026-11-20',
      sources: [{ id: 's1', label: 'USAspending', kind: 'usaspending' }],
      sections: goodSectionsWithSnippets('$42.5M'),
    };
    const ok = validateFmpWriteup(model, {
      defenseBuyersAppear: true,
      requiredSnippets: ['237310', '$42.5M', '2031', 'MATOC'],
    });
    expect(ok.ok).toBe(true);
  });

  it('fmpPlannerMaxTokensForCreateDocument returns 8192 when create_document is offered', () => {
    expect(fmpPlannerMaxTokensForCreateDocument(true)).toBe(FMP_DOC_TOOL_ROUND_MAX_TOKENS);
    expect(FMP_DOC_TOOL_ROUND_MAX_TOKENS).toBe(8192);
    expect(fmpPlannerMaxTokensForCreateDocument(false)).toBeNull();
  });

  it('answer note after create_document cites real download_path values only', () => {
    const evidence = accumulateFmpEvidence(
      [{ tool: 'get_contractor_award_history', content: AWARD_JSON }],
      '',
    );
    const note = buildFmpCreateDocumentAnswerNote({
      evidence,
      downloadPaths: ['/api/app/vault/documents/download?id=abc'],
      title: 'RBA Federal Market Profile',
    });
    expect(note).toContain('/api/app/vault/documents/download?id=abc');
    expect(note).toMatch(/Never invent URLs/i);
    expect(note).toMatch(/Summarize the federal market profile/i);
    expect(note).not.toMatch(/—/);
  });

  describe('rewriteFmpAnswerDownloadLinks', () => {
    const docId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const realPath = `/api/app/vault/documents/download?id=${docId}`;
    const docId2 = '11111111-2222-3333-4444-555555555555';
    const realPath2 = `/api/app/vault/documents/download?id=${docId2}`;

    it('rewrites your-link-to-download.com/<uuid> markdown links to the matching real path', () => {
      const before = [
        'Your federal market profile is ready.',
        '',
        `- [Word](https://your-link-to-download.com/${docId})`,
        `- [PDF](https://your-link-to-download.com/${docId2})`,
      ].join('\n');
      const after = rewriteFmpAnswerDownloadLinks(before, [realPath, realPath2]);
      expect(after).toContain(`[Word](${realPath})`);
      expect(after).toContain(`[PDF](${realPath2})`);
      expect(after).not.toMatch(/your-link-to-download\.com/i);
    });

    it('replaces invent-only link lists with a short bullet list of real paths', () => {
      const before = [
        'Downloads:',
        `- [file](https://your-link-to-download.com/not-a-real-id)`,
        `- [other](https://example.com/download/foo)`,
      ].join('\n');
      const after = rewriteFmpAnswerDownloadLinks(before, [realPath]);
      expect(after).not.toMatch(/your-link-to-download\.com/i);
      expect(after).toContain(realPath);
      expect(after).toMatch(/Downloads \(Vault\):/);
      expect(after).toContain(`- ${realPath}`);
    });

    it('preserves already-allowlisted vault download paths', () => {
      const before = `Open [the profile](${realPath}) from Vault.`;
      const after = rewriteFmpAnswerDownloadLinks(before, [realPath]);
      expect(after).toBe(before);
    });

    it('strips bare fake-host URLs and never leaves your-link-to-download.com', () => {
      const before = `Grab it at https://your-link-to-download.com/${docId} thanks.`;
      const after = rewriteFmpAnswerDownloadLinks(before, [realPath]);
      expect(after).toContain(realPath);
      expect(after).not.toMatch(/your-link-to-download\.com/i);
    });
  });

  it('formatObligationSnippet scales millions', () => {
    expect(formatObligationSnippet(42_500_000)).toBe('$42.5M');
    expect(formatObligationSnippet(1_000_000_000)).toBe('$1B');
  });

  it('createDocumentArgsHaveUsableDocModel rejects empty inject and accepts a titled model', () => {
    expect(createDocumentArgsHaveUsableDocModel('{}')).toBe(false);
    expect(createDocumentArgsHaveUsableDocModel('{"doc_model":{}}')).toBe(false);
    expect(createDocumentArgsHaveUsableDocModel(JSON.stringify({
      doc_model: { title: 'X', sections: [{ id: 'a', heading: 'H', blocks: [] }] },
    }))).toBe(true);
  });

  it('host DocModel passes validateDocModel + validateFmpWriteup with 237310/$42.5M/693C73/2031', async () => {
    const { validateDocModel } = await import('@/lib/documents/validate');
    const evidence = accumulateFmpEvidence(
      [
        { tool: 'get_contractor_award_history', content: AWARD_JSON },
        { tool: 'search_past_contracts', content: VEHICLE_JSON },
        { tool: 'search_federal_contacts', content: CONTACT_JSON },
        { tool: 'search_web', content: WEB_JSON },
      ],
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    const required = ['237310', '$42.5M', '693C73', '2031'];
    const snippets = requiredSnippetsForWriteup(evidence);
    for (const s of required) expect(snippets).toContain(s);

    const model = buildFmpHostDocModel(evidence, {
      customerText: RBA_FEDERAL_MARKET_PROFILE_PROMPT,
      defenseBuyersAppear: true,
      today: () => '2026-11-20',
    });
    expect(model.title).toBe('RBA Engineering International PLLC Federal Market Profile');
    expect(model.preparedFor).toBe('RBA Engineering International PLLC');
    expect(model.preparedFor).not.toMatch(/\. 8/);
    const flat = JSON.stringify(model);
    expect(flat).not.toMatch(/Performance\s+Assessment\s+Evaluation/i);
    expect(flat).toMatch(/defense construction oversight/i);
    for (const s of required) expect(flat).toContain(s);

    const shape = validateDocModel(model);
    expect(shape.ok).toBe(true);

    const v = validateFmpWriteup(model, {
      defenseBuyersAppear: true,
      requiredSnippets: required,
    });
    expect(v.ok).toBe(true);
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(v.issues.some((i) => i.code === 'open_bid_frame')).toBe(false);

    const inject = buildFmpCreateDocumentInjectArgs(evidence, {
      customerText: RBA_FEDERAL_MARKET_PROFILE_PROMPT,
      defenseBuyersAppear: true,
      today: () => '2026-11-20',
    });
    expect(createDocumentArgsHaveUsableDocModel(inject)).toBe(true);
    expect(inject).not.toBe('{}');
  });

  it('cleanLegalCompanyName / identity strips trailing . 8 from 8(a) paren trap', async () => {
    const { extractProfileCompanyIdentity, cleanLegalCompanyName } = await import('./tool-selection');
    expect(cleanLegalCompanyName('RBA Engineering International PLLC. 8')).toBe(
      'RBA Engineering International PLLC',
    );
    const id = extractProfileCompanyIdentity(
      'Build a federal market profile for RBA Engineering International PLLC. 8(a) through 2031 in VA.',
    );
    expect(id.legalName).toBe('RBA Engineering International PLLC');
  });

  it('validateFmpWriteup hard-fails Performance Assessment Evaluation gloss', () => {
    const evidence = accumulateFmpEvidence(
      [{ tool: 'get_contractor_award_history', content: AWARD_JSON }],
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    const model = buildFmpHostDocModel(evidence, {
      customerText: RBA_FEDERAL_MARKET_PROFILE_PROMPT,
      defenseBuyersAppear: true,
      today: () => '2026-11-20',
    });
    const poisoned = {
      ...model,
      sections: model.sections.map((s) => {
        if (s.id !== 'sec-pae') return s;
        return {
          ...s,
          blocks: [{
            type: 'paragraph' as const,
            id: 'p-pae',
            text: 'PAE means Performance Assessment Evaluation for this buyer.',
            claim: 'fact' as const,
            cites: ['s1'],
          }],
        };
      }),
    };
    const bad = validateFmpWriteup(poisoned, {
      defenseBuyersAppear: true,
      requiredSnippets: requiredSnippetsForWriteup(evidence),
    });
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((i) => i.code === 'pae_gloss_ban')).toBe(true);
  });

  describe('contact filter', () => {
    it('rejects Internal Revenue Service and other org names; keeps real people', () => {
      expect(looksLikePersonContactName('Internal Revenue Service')).toBe(false);
      expect(looksLikePersonContactName('Internal Revenue')).toBe(false);
      for (const org of [
        'Federal Highway Administration', 'Bureau Of Reclamation', 'Defense Logistics Agency',
        'Small Business Office', 'Treasury Department', 'Clara Barton Parkway', 'Eastern Federal Lands',
        'Government Services', 'Naval Command',
      ]) expect(looksLikePersonContactName(org)).toBe(false);
      for (const person of ['Helson Roman', 'David Bogner', 'Terry Agena']) {
        expect(looksLikePersonContactName(person)).toBe(true);
      }
    });

    it('rejects procurement / set-aside / placeholder phrases; still accepts real people', () => {
      for (const junk of [
        'No Range Specified', 'Sole Source', 'Sources Sought', 'Combined Synopsis', 'Set-Aside Small',
        'Set Aside Total', 'Full Open', 'Small Business', 'Woman Owned', 'Veteran Owned', 'Hubzone Set',
        'Not Applicable', 'Unknown Contact', 'None Listed', 'Limited Competition', 'Unrestricted Award',
        'Contract Ceiling', 'Obligations Amount', 'Request Rfq', 'No Contact', 'Notice Tbd',
      ]) expect(looksLikePersonContactName(junk), junk).toBe(false);
      for (const person of ['Helson Roman', 'David Bogner', 'Terry Agena', 'Noel Rangel']) {
        expect(looksLikePersonContactName(person), person).toBe(true);
      }
    });

    it('accumulate keeps garbage award-field strings out of contacts', () => {
      const evidence = accumulateFmpEvidence([
        {
          tool: 'get_contractor_award_history',
          content: JSON.stringify({
            history: { recentAwards: [{ id: 'a1', title: 'Bridge repair', setAside: 'No Range Specified', competition: 'Sole Source', amount: 1_000_000 }] },
          }),
        },
        { tool: 'search_federal_contacts', content: CONTACT_JSON },
      ]);
      expect(evidence.contactNames).toEqual(['Helson Roman', 'Spare Dla Person']);
      expect(JSON.stringify(evidence.contactRows)).not.toMatch(/No Range|Sole Source/);
    });

    it('accumulate drops IRS but keeps Helson Roman from the same payload', () => {
      const evidence = accumulateFmpEvidence([
        {
          tool: 'search_federal_contacts',
          content: JSON.stringify({
            contacts: [
              { name: 'Internal Revenue Service', agency: 'Treasury' },
              { name: 'Helson Roman', email: 'helson.roman@dot.gov', office: 'FHWA Eastern Federal Lands' },
            ],
          }),
        },
      ]);
      expect(evidence.contactNames).toEqual(['Helson Roman']);
      expect(evidence.contactRows?.[0]).toMatchObject({
        person: 'Helson Roman',
        email: 'helson.roman@dot.gov',
        agency: 'FHWA Eastern Federal Lands',
      });
      expect(JSON.stringify(evidence.contactRows)).not.toMatch(/Internal Revenue/);
    });
  });

  describe('enriched evidence + host DocModel parity', () => {
    const AWARDS_RICH = JSON.stringify({
      history: {
        summary: { totalObligations: 42_500_000, awardCount: 17 },
        topNaics: [{ naics: '237310', amount: 40_000_000, count: 14 }],
        recentAwards: [
          { id: 'a1', title: 'Rock Creek bridge rehabilitation', agency: 'Department of Transportation', subAgency: 'Federal Highway Administration', amount: 9_800_000, state: 'DC', setAside: '8(a) Competed' },
          { id: 'a2', title: 'Parkway paving and drainage', agency: 'Department of the Interior', subAgency: 'National Park Service', amount: 6_200_000, state: 'VA', setAside: null },
          { id: 'a3', title: 'Marine pier repair', agency: 'Department of Defense', subAgency: 'Army Corps of Engineers', amount: 3_100_000, state: 'MD' },
        ],
      },
      _meta: { grounded: true, award_count: 17, total_obligations: 42_500_000 },
    });
    const OPPS_RICH = JSON.stringify({
      items: [
        { notice_id: 'abc123def456abc123def456abc123de', solicitation_number: '693C7326R0001', title: 'Eastern Federal Lands Inspection MATOC', department: 'Federal Highway Administration', naics_code: '237310', response_deadline: '2027-01-15T17:00:00Z', notice_type: 'Combined Synopsis/Solicitation', description: 'Construction inspection services across the eastern region.' },
        { notice_id: 'fed654fed654fed654fed654fed654fe', solicitation_number: 'N4008026S0042', title: 'Pentagon paving and stormwater successor', department: 'Department of the Navy', naics_code: '236220', response_deadline: '2026-12-20T17:00:00Z', notice_type: 'Sources Sought' },
        { notice_id: '0011223344556677889900aabbccddee', title: 'Clara Barton Parkway rehabilitation', department: 'National Park Service', naics_code: '237310' },
      ],
    });
    const CONTACTS_RICH = JSON.stringify({
      contacts: [
        { name: 'Helson Roman', email: 'helson.roman@dot.gov', agency: 'FHWA Eastern Federal Lands' },
        { name: 'David Bogner', email: 'david.bogner@whs.mil', office: 'WHS small business' },
        { name: 'Internal Revenue Service', agency: 'Treasury' },
      ],
    });
    const MARKET_RICH = JSON.stringify({
      sections: {
        top_agencies: [
          { name: 'Federal Highway Administration', amount: 310_000_000 },
          { name: 'National Park Service', amount: 160_000_000 },
        ],
        competition: { contractors: [{ name: 'Acme Paving', amount: 12_000_000, state: 'VA' }] },
      },
    });

    const results = [
      { tool: 'get_contractor_award_history', content: AWARDS_RICH },
      { tool: 'find_opportunities', content: OPPS_RICH },
      { tool: 'search_federal_contacts', content: CONTACTS_RICH },
      { tool: 'generate_market_report', content: MARKET_RICH },
      { tool: 'search_past_contracts', content: VEHICLE_JSON },
      { tool: 'search_web', content: WEB_JSON },
    ];
    const evidence = accumulateFmpEvidence(results, RBA_FEDERAL_MARKET_PROFILE_PROMPT);
    const hostOpts = { customerText: RBA_FEDERAL_MARKET_PROFILE_PROMPT, defenseBuyersAppear: true, today: () => '2026-11-20' };

    it('parses award rows, pathways, contacts, buyer spend and competitors from tool JSON', () => {
      expect(evidence.awardRows?.map((r) => r.buyer)).toEqual([
        'Federal Highway Administration', 'National Park Service', 'Army Corps of Engineers',
      ]);
      expect(evidence.awardRows?.[0]).toMatchObject({ where: 'DC', competition: '8(a) Competed', obligated: '$9.8M' });
      expect(evidence.pathways?.map((p) => p.noticeId)).toContain('693C7326R0001');
      // vehicle first, then sources sought, then the rest
      expect(evidence.pathways?.[0].title).toMatch(/MATOC/);
      expect(evidence.pathways?.[1].noticeType).toMatch(/sources sought/i);
      expect(evidence.contactRows?.map((c) => c.person)).toEqual(['Helson Roman', 'David Bogner']);
      expect(evidence.buyerSpend?.[0]).toEqual({ agency: 'Federal Highway Administration', dollars: 310_000_000 });
      expect(evidence.competitors?.[0].firm).toBe('Acme Paving');
      // nothing invented: no rank or territory total in the fixture
      expect(evidence.ranksByState).toEqual({});
      expect(evidence.marketTerritoryDollars).toBeNull();
    });

    it('only reports ranks and territory dollars when the tool text states them', () => {
      const ev = accumulateFmpEvidence([
        { tool: 'generate_market_report', content: 'RBA is #4 in DC and ranked 9 in VA. FHWA + NPS territory spend $470M over three years.' },
      ]);
      expect(ev.ranksByState).toEqual({ DC: 4, VA: 9 });
      expect(ev.marketTerritoryDollars).toBe('$470M');
    });

    it('host model is dense, grounded, and passes every gate', async () => {
      const { validateDocModel } = await import('@/lib/documents/validate');
      const model = buildFmpHostDocModel(evidence, hostOpts);
      const rich = fmpDocModelRichness(model);
      expect(rich.chars).toBeGreaterThanOrEqual(3500);
      expect(rich.hasPathways).toBe(true);
      expect(rich.whoToTalkPersonRows).toBeGreaterThanOrEqual(2);

      const flat = flattenDocModelText(model);
      expect(flat).toContain('693C7326R0001');
      expect(flat).toContain('Helson Roman');
      expect(flat).not.toMatch(/Internal Revenue/i);
      expect(flat).not.toMatch(/Performance\s+Assessment\s+Evaluation/i);
      expect(flat).not.toMatch(/\$470M/); // not in this corpus
      expect(flat).not.toMatch(/Mid plan|upgrade to|book a/i);

      const awards = model.sections.find((s) => /already proven/i.test(s.heading));
      expect(awards?.blocks.some((b) => b.type === 'table' && b.rows.length === 3)).toBe(true);
      expect(model.sections.some((s) => /where the money sits/i.test(s.heading))).toBe(true);

      const shape = validateDocModel(model);
      expect(shape.ok ? [] : shape.issues).toEqual([]);
      const v = validateFmpWriteup(model, {
        defenseBuyersAppear: true,
        requiredSnippets: requiredSnippetsForWriteup(evidence),
      });
      expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);
    });

    it('parses a FIND-shaped payload (open / coming_back / coming_soon, id, due) into pathway rows', () => {
      const find = JSON.stringify({
        open: [
          { id: 'aaaa1111bbbb2222cccc3333dddd4444', name: 'Highway bridge inspection services', solicitationNumber: '693C7326R0100', due: '2027-02-01T17:00:00Z', naicsCode: 237310, agency: { name: 'Federal Highway Administration' }, type: 'Sources Sought', summary: 'Bridge inspection support.' },
        ],
        coming_back: [
          { noticeId: 'eeee5555ffff6666aaaa7777bbbb8888', title: 'Pentagon grounds maintenance recompete', department: 'Department of Defense', naics: '561730' },
        ],
        coming_soon: [
          { title: 'Eastern Lands paving MATOC', notice_id: '99990000aaaabbbbccccddddeeeeffff', response_deadline: '2027-03-01' },
        ],
      });
      const ev = accumulateFmpEvidence([{ tool: 'find_opportunities', content: find }]);
      expect(ev.pathways?.length).toBeGreaterThanOrEqual(2);
      expect(ev.pathways?.map((p) => p.noticeId)).toEqual(expect.arrayContaining([
        '693C7326R0100', 'eeee5555ffff6666aaaa7777bbbb8888', '99990000aaaabbbbccccddddeeeeffff',
      ]));
      const first = ev.pathways?.find((p) => p.noticeId === '693C7326R0100');
      expect(first).toMatchObject({ naics: '237310', buyer: 'Federal Highway Administration', when: 'Due 2027-02-01' });

      // a `results` list from an unrecognized tool counts only with a real notice key
      const other = accumulateFmpEvidence([{ tool: 'custom_tool', content: JSON.stringify({ results: [
        { notice_id: 'abcd'.repeat(8), title: 'Roadway resurfacing services' },
        { id: 'xyz123', title: 'Some contact record here' },
      ] }) }]);
      expect(other.pathways?.map((p) => p.noticeId)).toEqual(['abcd'.repeat(8)]);

      // a bare nested {id, name} object is not a notice
      const nested = accumulateFmpEvidence([{ tool: 'find_opportunities', content: JSON.stringify({ meta: { agency: { id: 'x1', name: 'Department of Transportation' } } }) }]);
      expect(nested.pathways).toEqual([]);
    });

    it('host model with garbage-only contact JSON never puts those names in who-to-talk', () => {
      const ev = accumulateFmpEvidence([
        { tool: 'search_federal_contacts', content: JSON.stringify({ contacts: [{ name: 'No Range Specified' }, { name: 'Sole Source' }] }) },
        { tool: 'get_contractor_award_history', content: AWARD_JSON },
      ], RBA_FEDERAL_MARKET_PROFILE_PROMPT);
      expect(ev.contactNames).toEqual([]);
      // callers can also hand the builder pre-built garbage rows
      const withRows = {
        ...ev,
        contactNames: ['No Range Specified', 'Sole Source'],
        contactRows: [{ person: 'No Range Specified, FHWA, x@y.gov' }, { person: 'Sole Source' }],
      };
      const model = buildFmpHostDocModel(withRows, hostOpts);
      const who = JSON.stringify(model.sections.find((s) => /who to talk to/i.test(s.heading)));
      expect(who).toContain('Named notice POC on the active pathway');
      expect(who).not.toMatch(/No Range Specified|Sole Source/);
      expect(flattenDocModelText(model)).not.toMatch(/No Range Specified|Sole Source/);
    });

    it('with no pathway rows the pathways section is a multi-bullet frame, not one thin paragraph', () => {
      const thin = accumulateFmpEvidence(
        [
          { tool: 'get_contractor_award_history', content: AWARD_JSON },
          { tool: 'search_past_contracts', content: VEHICLE_JSON },
        ],
        RBA_FEDERAL_MARKET_PROFILE_PROMPT,
      );
      const model = buildFmpHostDocModel(thin, hostOpts);
      const pathways = model.sections.find((s) => /pathways/i.test(s.heading))!;
      const bullets = pathways.blocks.find((b) => b.type === 'bullets');
      expect(bullets && bullets.type === 'bullets' ? bullets.items.length : 0).toBeGreaterThanOrEqual(4);
      expect(flattenDocModelText(model)).toContain('693C73');
      // no contact in evidence: placeholder is the notice POC, never an agency
      const who = model.sections.find((s) => /who to talk to/i.test(s.heading))!;
      expect(JSON.stringify(who)).toContain('Named notice POC on the active pathway');
    });
  });

  describe('planner vs host DocModel', () => {
    const evidence = accumulateFmpEvidence(
      [
        { tool: 'get_contractor_award_history', content: AWARD_JSON },
        { tool: 'search_past_contracts', content: VEHICLE_JSON },
        { tool: 'search_federal_contacts', content: CONTACT_JSON },
        { tool: 'search_web', content: WEB_JSON },
      ],
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    const opts = { customerText: RBA_FEDERAL_MARKET_PROFILE_PROMPT, defenseBuyersAppear: true, today: () => '2026-11-20' };
    const longText = (seed: string, long = true) => `${seed} `.repeat(long ? 70 : 1);

    function plannerModel(whoRows: Array<Record<string, string>>, extra = '', long = true): DocModel {
      const base = goodSectionsWithSnippets('$42.5M');
      const sections = base.map((s) => {
        if (s.id === 'sec-path') {
          return {
            ...s,
            blocks: [
              ...s.blocks,
              ...[{ type: 'paragraph' as const, id: 'p-long', text: longText(`Inspection MATOC 693C73 small-business seats and sources sought at FHWA and WHS. ${extra}`, long), claim: 'fact' as const, cites: ['s1'] }],
            ],
          };
        }
        if (s.id === 'sec-who') {
          return {
            ...s,
            blocks: [{
              type: 'table' as const,
              id: 't-who',
              claim: 'fact' as const,
              cites: ['s1'],
              columns: [
                { key: 'person', label: 'Person' },
                { key: 'why', label: 'Why they matter' },
                { key: 'question', label: 'Question to ask' },
              ],
              rows: whoRows,
            }],
          };
        }
        return s;
      });
      return { schema: DOC_SCHEMA, title: 'RBA Profile', date: '2026-11-20', sources: [{ id: 's1', label: 'Tools', kind: 'tool' }], sections };
    }

    const goodRows = [
      { person: 'Helson Roman, FHWA EFL', why: 'Notice POC', question: 'Ask about MATOC seats.' },
      { person: 'David Bogner, WHS', why: 'Notice POC', question: 'Ask about the Pentagon IDIQ successor.' },
    ];

    it('keeps a rich, valid planner model', () => {
      const args = JSON.stringify({ doc_model: plannerModel(goodRows) });
      const pick = shouldPreferPlannerFmpDocModel(args, evidence, opts);
      expect(pick.reason).toBe('planner_rich_valid');
      expect(pick.prefer).toBe(true);
      const resolved = resolveFmpCreateDocumentArgs(args, evidence, opts);
      expect(resolved.source).toBe('planner');
      expect(resolved.notice).toBe('fmp_create_document:planner_doc_model_kept');
    });

    it('falls back to host for thin, IRS-contact, Mid CTA and empty planner output', () => {
      const thin = JSON.stringify({ doc_model: plannerModel(goodRows, '', false) });
      expect(shouldPreferPlannerFmpDocModel(thin, evidence, opts)).toMatchObject({ prefer: false });
      expect(shouldPreferPlannerFmpDocModel(thin, evidence, opts).reason).toMatch(/^too_thin:/);

      const irs = JSON.stringify({
        doc_model: plannerModel([
          { person: 'Internal Revenue Service', why: 'Agency', question: 'Ask about seats.' },
          { person: 'Helson Roman', why: 'POC', question: 'Ask about MATOC seats.' },
          { person: 'David Bogner', why: 'POC', question: 'Ask about IDIQ.' },
        ]),
      });
      const irsPick = shouldPreferPlannerFmpDocModel(irs, evidence, opts);
      expect(irsPick.prefer).toBe(false);
      expect(irsPick.reason).toBe('irs_like_contact');

      const garbage = JSON.stringify({
        doc_model: plannerModel([
          ...goodRows,
          { person: 'No Range Specified', why: 'Award field', question: 'Ask about seats.' },
          { person: 'Sole Source, DLA, a@b.gov', why: 'Award field', question: 'Ask about seats.' },
        ]),
      });
      const garbagePick = shouldPreferPlannerFmpDocModel(garbage, evidence, opts);
      expect(garbagePick.prefer).toBe(false);
      expect(garbagePick.reason).toBe('non_person_contact');

      const oneContact = JSON.stringify({ doc_model: plannerModel([goodRows[0]]) });
      expect(shouldPreferPlannerFmpDocModel(oneContact, evidence, opts).reason).toBe('who_to_talk_person_rows:1');

      const mid = JSON.stringify({ doc_model: plannerModel(goodRows, 'Upgrade to the Mid plan for $5K-$10K.') });
      expect(shouldPreferPlannerFmpDocModel(mid, evidence, opts).reason).toBe('mid_cta_ban');

      for (const args of ['{}', '{"doc_model":{}}', 'not json']) {
        const r = resolveFmpCreateDocumentArgs(args, evidence, opts);
        expect(r.source).toBe('host');
        expect(r.notice).toBe('fmp_create_document:host_doc_model_forced');
        expect(createDocumentArgsHaveUsableDocModel(r.args)).toBe(true);
      }
    });
  });
});
