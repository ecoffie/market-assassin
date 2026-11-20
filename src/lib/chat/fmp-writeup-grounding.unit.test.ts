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
  fmpPlannerMaxTokensForCreateDocument,
  requiredSnippetsForWriteup,
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

  it('host DocModel includes required snippets, passes validate, and never uses Performance Assessment Evaluation', () => {
    const evidence = accumulateFmpEvidence(
      [
        { tool: 'get_contractor_award_history', content: AWARD_JSON },
        { tool: 'search_past_contracts', content: VEHICLE_JSON },
        { tool: 'search_federal_contacts', content: CONTACT_JSON },
        { tool: 'search_web', content: WEB_JSON },
      ],
      RBA_FEDERAL_MARKET_PROFILE_PROMPT,
    );
    const snippets = requiredSnippetsForWriteup(evidence);
    const model = buildFmpHostDocModel(evidence, {
      customerText: RBA_FEDERAL_MARKET_PROFILE_PROMPT,
      defenseBuyersAppear: true,
      today: () => '2026-11-20',
    });
    const flat = JSON.stringify(model);
    expect(flat).not.toMatch(/Performance\s+Assessment\s+Evaluation/i);
    expect(flat).toMatch(/defense construction oversight/i);
    for (const s of snippets) expect(flat).toContain(s);

    const v = validateFmpWriteup(model, {
      defenseBuyersAppear: true,
      requiredSnippets: snippets,
    });
    expect(v.ok).toBe(true);
    expect(v.issues.filter((i) => i.severity === 'error')).toEqual([]);

    const inject = buildFmpCreateDocumentInjectArgs(evidence, {
      customerText: RBA_FEDERAL_MARKET_PROFILE_PROMPT,
      defenseBuyersAppear: true,
      today: () => '2026-11-20',
    });
    expect(createDocumentArgsHaveUsableDocModel(inject)).toBe(true);
    expect(inject).not.toBe('{}');
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
});
