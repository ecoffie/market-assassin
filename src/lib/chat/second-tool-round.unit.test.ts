import { describe, expect, it } from 'vitest';
import {
  shouldOfferSecondToolRound,
  decideSecondToolRound,
  SECOND_ROUND_SEED_TOOLS,
  SECOND_ROUND_COMPLETE_TOOLS,
  SECOND_ROUND_HOP_CUE,
  toolCallIdentityKey,
  dropDuplicateRound2Calls,
} from './second-tool-round';
import { splitViewPreamble } from './view-preamble';

/** The eight measured R2 cases from ASK-MINDY-R2-EVALUATION-2026-11-18 (plus T7 docs outlier). */
const EIGHT_CASES = {
  T4_clean_incumbent_compete: {
    tools: [{ tool: 'get_solicitation_incumbent', status: 'success' }],
    text: 'Who held the previous contract for solicitation A031392 and which other companies compete with that incumbent',
  },
  T6_plain_past_awards: {
    tools: [{ tool: 'search_past_contracts', status: 'success' }],
    text: 'Largest contracts awarded in FL for NAICS 541512 last year',
  },
  T7_docs_outlier: {
    tools: [{ tool: 'lookup_solicitation', status: 'success' }],
    text: 'What is solicitation 36C24626B0031 about and when is it due',
  },
  T8_lookup_dup: {
    tools: [{ tool: 'lookup_solicitation', status: 'success' }],
    text: 'What is solicitation 140A1627Q0105 about and when is it due',
  },
  T9_clean_lookup_contact: {
    tools: [{ tool: 'lookup_solicitation', status: 'success' }],
    text: 'What is solicitation FA480027Q0009 about and who is the contact',
  },
  B_already_complete_triple: {
    tools: [
      { tool: 'lookup_solicitation', status: 'success' },
      { tool: 'search_past_contracts', status: 'success' },
      { tool: 'search_federal_contacts', status: 'success' },
    ],
    text: 'Lookup W912WJ26QA168, past contracts, and contacts',
  },
  C_clean_past_contact: {
    tools: [{ tool: 'search_past_contracts', status: 'success' }],
    text: 'Past contracts for snow removal in MA, then the buying-office contact',
  },
  H_past_dup_with_contact_cue: {
    tools: [{ tool: 'search_past_contracts', status: 'success' }],
    text: 'Past contracts for snow removal in MA, then the buying-office contact',
  },
  D_bogus_incumbent: {
    tools: [{ tool: 'get_solicitation_incumbent', status: 'success' }],
    text: 'Lookup bogus solicitation ZZZ999NOTREAL0001',
  },
} as const;

describe('shouldOfferSecondToolRound / decideSecondToolRound', () => {
  it('offers a second round after a successful seed tool when the question needs a hop', () => {
    expect(
      shouldOfferSecondToolRound([{ tool: 'get_solicitation_incumbent', status: 'success' }], {
        customerText: 'who competes with the incumbent',
      }),
    ).toBe(true);
    expect(
      shouldOfferSecondToolRound([{ tool: 'lookup_solicitation', status: 'success' }], {
        customerText: 'who is the contact for this notice',
      }),
    ).toBe(true);
  });

  it('does not offer when round 1 had no tools, only failures, or non-seed tools', () => {
    expect(shouldOfferSecondToolRound([], { customerText: 'who is the contact' })).toBe(false);
    expect(
      shouldOfferSecondToolRound([{ tool: 'get_solicitation_incumbent', status: 'failed' }], {
        customerText: 'who competes',
      }),
    ).toBe(false);
    expect(
      shouldOfferSecondToolRound([{ tool: 'get_my_pipeline', status: 'success' }], {
        customerText: 'who is the contact',
      }),
    ).toBe(false);
  });

  it('does not offer after timeout or planner failure', () => {
    const seed = [{ tool: 'lookup_solicitation', status: 'success' }];
    expect(shouldOfferSecondToolRound(seed, { turnTimedOut: true, customerText: 'contact' })).toBe(false);
    expect(shouldOfferSecondToolRound(seed, { plannerUnavailable: true, customerText: 'contact' })).toBe(false);
  });

  it('seed set is notice/award unlocks only — not open/expiring list tools', () => {
    for (const t of ['lookup_solicitation', 'get_solicitation_incumbent', 'search_past_contracts']) {
      expect(SECOND_ROUND_SEED_TOOLS.has(t)).toBe(true);
    }
    expect(SECOND_ROUND_SEED_TOOLS.has('find_opportunities')).toBe(false);
    expect(SECOND_ROUND_SEED_TOOLS.has('get_expiring_contracts')).toBe(false);
    expect(SECOND_ROUND_COMPLETE_TOOLS.has('find_capable_contractors')).toBe(true);
    expect(SECOND_ROUND_COMPLETE_TOOLS.has('search_federal_contacts')).toBe(true);
  });

  it('skips already-complete R1 (hop tool already ran)', () => {
    const d = decideSecondToolRound(
      [
        { tool: 'lookup_solicitation', status: 'success' },
        { tool: 'search_federal_contacts', status: 'success' },
      ],
      { customerText: 'who is the contact' },
    );
    expect(d).toEqual({ offer: false, reason: 'already_complete' });
  });

  it('skips plain lookups with no hop cue (T7/T8 document-hop / lookup-dup class)', () => {
    expect(decideSecondToolRound(EIGHT_CASES.T7_docs_outlier.tools, { customerText: EIGHT_CASES.T7_docs_outlier.text })).toEqual({
      offer: false,
      reason: 'no_hop_cue',
    });
    expect(decideSecondToolRound(EIGHT_CASES.T8_lookup_dup.tools, { customerText: EIGHT_CASES.T8_lookup_dup.text })).toEqual({
      offer: false,
      reason: 'no_hop_cue',
    });
    expect(decideSecondToolRound(EIGHT_CASES.T6_plain_past_awards.tools, { customerText: EIGHT_CASES.T6_plain_past_awards.text })).toEqual({
      offer: false,
      reason: 'no_hop_cue',
    });
    expect(decideSecondToolRound(EIGHT_CASES.D_bogus_incumbent.tools, { customerText: EIGHT_CASES.D_bogus_incumbent.text })).toEqual({
      offer: false,
      reason: 'no_hop_cue',
    });
  });

  it('offers legitimate document-research hops after a seed lookup', () => {
    const seed = [{ tool: 'lookup_solicitation', status: 'success' }];
    expect(decideSecondToolRound(seed, { customerText: 'Pull the SOW and attachments for solicitation FA480027Q0009' }).offer).toBe(true);
    expect(decideSecondToolRound(seed, { customerText: 'What does the PWS say for this notice' }).offer).toBe(true);
    expect(decideSecondToolRound(seed, { customerText: 'Get solicitation documents for 36C24626B0031' }).offer).toBe(true);
  });

  it('skips document-only questions when R1 already fetched solicitation documents', () => {
    expect(
      decideSecondToolRound(
        [
          { tool: 'lookup_solicitation', status: 'success' },
          { tool: 'get_solicitation_documents', status: 'success' },
        ],
        { customerText: 'Pull the SOW and attachments for this notice' },
      ),
    ).toEqual({ offer: false, reason: 'documents_already_fetched' });
  });

  it('preserves clean multi-hop cases (T4, T9, C)', () => {
    expect(decideSecondToolRound(EIGHT_CASES.T4_clean_incumbent_compete.tools, { customerText: EIGHT_CASES.T4_clean_incumbent_compete.text }).offer).toBe(true);
    expect(decideSecondToolRound(EIGHT_CASES.T9_clean_lookup_contact.tools, { customerText: EIGHT_CASES.T9_clean_lookup_contact.text }).offer).toBe(true);
    expect(decideSecondToolRound(EIGHT_CASES.C_clean_past_contact.tools, { customerText: EIGHT_CASES.C_clean_past_contact.text }).offer).toBe(true);
  });

  it('skips the already-complete triple (case B)', () => {
    expect(decideSecondToolRound(EIGHT_CASES.B_already_complete_triple.tools, { customerText: EIGHT_CASES.B_already_complete_triple.text })).toEqual({
      offer: false,
      reason: 'already_complete',
    });
  });

  it('hop cue regex matches competitors, contacts, and documents — not plain due-date questions', () => {
    expect(SECOND_ROUND_HOP_CUE.test('who competes with the incumbent')).toBe(true);
    expect(SECOND_ROUND_HOP_CUE.test('buying-office contact')).toBe(true);
    expect(SECOND_ROUND_HOP_CUE.test('pull the SOW')).toBe(true);
    expect(SECOND_ROUND_HOP_CUE.test('What is solicitation X about and when is it due')).toBe(false);
  });

  it('route must strip map preamble before hop matching (false contacts in view note)', () => {
    const seed = [{ tool: 'lookup_solicitation', status: 'success' }] as const;
    const raw =
      '[Current map view \u2014 contacts for this NAICS; buying offices nearby. Answer for THIS view.]\n\nWhen is it due?';
    // Raw message would falsely match hop cues living only in the preamble.
    expect(decideSecondToolRound(seed, { customerText: raw }).offer).toBe(true);
    expect(
      decideSecondToolRound(seed, { customerText: splitViewPreamble(raw).rest || raw }).offer,
    ).toBe(false);
  });
});

describe('toolCallIdentityKey + dropDuplicateRound2Calls', () => {
  it('treats identical tool+args as the same key (key order / comma set / ignore limit only)', () => {
    const a = toolCallIdentityKey('lookup_solicitation', '{"notice_id":"abc","limit":5}');
    const b = toolCallIdentityKey('lookup_solicitation', '{"limit":20,"notice_id":"abc"}');
    expect(a).toBe(b);
    expect(toolCallIdentityKey('search_past_contracts', '{"state":"MA,NH"}')).toBe(
      toolCallIdentityKey('search_past_contracts', '{"state":"NH,MA"}'),
    );
  });

  it('preserves legitimate calls when arguments change', () => {
    const a = toolCallIdentityKey('search_past_contracts', '{"naics":"541512","state":"FL"}');
    const b = toolCallIdentityKey('search_past_contracts', '{"naics":"541512","state":"MA"}');
    expect(a).not.toBe(b);
  });

  it('keeps pagination follow-ups (display_offset / page differ)', () => {
    const page0 = toolCallIdentityKey('search_past_contracts', '{"keyword":"snow","state":"MA","display_offset":0}');
    const page1 = toolCallIdentityKey('search_past_contracts', '{"keyword":"snow","state":"MA","display_offset":10}');
    expect(page0).not.toBe(page1);
    // Omitted offset ≡ explicit 0 (no false "new page")
    expect(page0).toBe(toolCallIdentityKey('search_past_contracts', '{"keyword":"snow","state":"MA"}'));
    const cross = dropDuplicateRound2Calls(
      [{ id: 'p2', function: { name: 'search_past_contracts', arguments: '{"keyword":"snow","state":"MA","display_offset":10}' } }],
      [{ tool: 'search_past_contracts', args: '{"keyword":"snow","state":"MA","display_offset":0}' }],
    );
    expect(cross.keep.map((c) => c.id)).toEqual(['p2']);
    expect(cross.duplicates).toHaveLength(0);
  });

  it('drops R2 duplicates of R1 and keeps new hops', () => {
    const round1 = [
      { tool: 'lookup_solicitation', args: '{"solicitation":"FA480027Q0009"}' },
      { tool: 'search_past_contracts', args: '{"keyword":"snow","state":"MA"}' },
    ];
    const planned = [
      { id: 'c1', function: { name: 'lookup_solicitation', arguments: '{"solicitation":"FA480027Q0009"}' } },
      { id: 'c2', function: { name: 'search_federal_contacts', arguments: '{"agency":"Army"}' } },
      { id: 'c3', function: { name: 'search_past_contracts', arguments: '{"state":"MA","keyword":"snow","limit":10}' } },
    ];
    const { keep, duplicates } = dropDuplicateRound2Calls(planned, round1);
    expect(keep.map((c) => c.id)).toEqual(['c2']);
    expect(duplicates.map((d) => d.id).sort()).toEqual(['c1', 'c3']);
  });

  it('case H: repeated past-contracts call is dropped; contact hop would remain', () => {
    const round1 = [{ tool: 'search_past_contracts', args: '{"keyword":"snow removal","state":"MA"}' }];
    const dupOnly = [
      { id: 'd1', function: { name: 'search_past_contracts', arguments: '{"keyword":"snow removal","state":"MA"}' } },
    ];
    expect(dropDuplicateRound2Calls(dupOnly, round1).keep).toHaveLength(0);
    const withHop = [
      ...dupOnly,
      { id: 'h1', function: { name: 'search_federal_contacts', arguments: '{"keyword":"snow"}' } },
    ];
    expect(dropDuplicateRound2Calls(withHop, round1).keep.map((c) => c.id)).toEqual(['h1']);
  });
});

describe('eight-case hygiene matrix (regression for evaluation set)', () => {
  it('offer decisions match the intended after-hygiene outcomes', () => {
    const matrix: Array<{ id: keyof typeof EIGHT_CASES; offer: boolean; reason?: string }> = [
      { id: 'T4_clean_incumbent_compete', offer: true },
      { id: 'T6_plain_past_awards', offer: false, reason: 'no_hop_cue' },
      { id: 'T7_docs_outlier', offer: false, reason: 'no_hop_cue' },
      { id: 'T8_lookup_dup', offer: false, reason: 'no_hop_cue' },
      { id: 'T9_clean_lookup_contact', offer: true },
      { id: 'B_already_complete_triple', offer: false, reason: 'already_complete' },
      { id: 'C_clean_past_contact', offer: true },
      { id: 'H_past_dup_with_contact_cue', offer: true },
      { id: 'D_bogus_incumbent', offer: false, reason: 'no_hop_cue' },
    ];
    for (const row of matrix) {
      const c = EIGHT_CASES[row.id];
      const d = decideSecondToolRound(c.tools, { customerText: c.text });
      expect({ id: row.id, ...d }, row.id).toEqual(
        row.offer ? { id: row.id, offer: true } : { id: row.id, offer: false, reason: row.reason },
      );
    }
  });
});

describe('second round: recovery and decision questions (2026-11-25)', () => {
  it('a seed lookup that found nothing gets one recovery round (award number looked up as a solicitation)', () => {
    expect(decideSecondToolRound([
      { tool: 'get_solicitation_incumbent', status: 'success', empty: true },
      { tool: 'lookup_solicitation', status: 'success', empty: true },
    ], { customerText: 'Should my company pursue the VA janitorial contract 36C24823P1623 when it comes back?' })).toEqual({ offer: true });
  });
  it('a decision question after a successful seed gets the follow-on round', () => {
    expect(decideSecondToolRound([{ tool: 'search_past_contracts', status: 'success' }], { customerText: 'Is this worth pursuing for us?' })).toEqual({ offer: true });
  });
  it('a decision question whose round 1 found facts (non-seed tool) still gets the follow-on round', () => {
    expect(decideSecondToolRound([{ tool: 'get_award_detail', status: 'success' }], { customerText: 'Should we bid on 36C24823P1623?' })).toEqual({ offer: true });
  });
  it('unchanged: a plain lookup with a found seed and no decision or hop cue still skips', () => {
    expect(decideSecondToolRound([{ tool: 'lookup_solicitation', status: 'success' }], { customerText: 'When is FA805127R0001 due?' })).toEqual({ offer: false, reason: 'no_hop_cue' });
  });
  it('unchanged: a list question with no seed skips', () => {
    expect(decideSecondToolRound([{ tool: 'find_opportunities', status: 'success' }], { customerText: 'What janitorial opportunities are open in Florida?' })).toEqual({ offer: false, reason: 'no_seed' });
  });
});
