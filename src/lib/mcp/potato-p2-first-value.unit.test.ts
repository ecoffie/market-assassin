/**
 * Potato P2 — value before qualification.
 * Instruction + FIND presentation contract only. Does not change v1 evidence engines.
 */
import { describe, it, expect } from 'vitest';
import {
  HOST_RULES_MONITOR,
  HOST_RULES_POSITION,
  P2_FIRST_TURN_INSTRUCTIONS,
  POTATO_JOURNEY_INSTRUCTIONS,
} from './potato-journey';
import { MCP_CONNECTOR_INSTRUCTIONS } from './schedule-discovery';
import { HOST_RULES_PATHWAY_FIT } from '@/lib/pathways/pathway-fit-types';
import {
  buildFindNext,
  buildFindPresentation,
  HOST_RULES_FIND_FIRST_VALUE,
  type HorizonKey,
  type HorizonResult,
} from '@/lib/opportunities/find-opportunities';

function hz(
  status: HorizonResult['status'],
  matched: number | null,
  items: HorizonResult['items'] = [],
): HorizonResult {
  return {
    status,
    matched_count: matched,
    returned_count: items.length,
    items,
    source: 'test',
    as_of: null,
    filters_consumed: [],
    filters_unsupported: [],
    unmapped_count: 0,
    error: null,
    allowed_handoffs: [],
    semantics_note: null,
  };
}

describe('P2 first-turn connector', () => {
  it('1. broad intent → FIND-first instruction', () => {
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/Call find_opportunities ONCE using the user's words/i);
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/help me/i);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toContain(P2_FIRST_TURN_INSTRUCTIONS);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toMatch(/call find_opportunities ONCE/i);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toMatch(/Do not ask qualification questions first/i);
  });

  it('2. first value precedes qualification', () => {
    const blob = POTATO_JOURNEY_INSTRUCTIONS;
    const valueAt = blob.indexOf('VALUE BEFORE QUALIFICATION');
    const companyAt = blob.indexOf('Which company should I match');
    const clearanceAt = blob.indexOf('do not ask merely because the buyer is SOCOM');
    expect(valueAt).toBeGreaterThanOrEqual(0);
    expect(companyAt).toBeGreaterThan(valueAt);
    expect(clearanceAt).toBeGreaterThan(valueAt);
    expect(blob).toMatch(/Do not treat this list as first-turn intake/i);
  });

  it('4. no first-turn identity requirement', () => {
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/do NOT: ask company identity, UEI, CAGE/i);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toMatch(/Do not ask company identity on the FIND turn/i);
  });

  it('5. no first-turn clearance requirement', () => {
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/do not ask merely because the buyer is SOCOM/i);
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/hard gate on most SOCOM cyber work/i);
    expect(HOST_RULES_FIND_FIRST_VALUE.join('\n')).toMatch(/Clearance is not a first-value question/i);
  });

  it('6. no first-turn deliverable menu', () => {
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/do not ask market map vs access-path plan vs capability statement/i);
    expect(HOST_RULES_POSITION.join('\n')).toMatch(/Do not first-turn menu market map vs access-path plan vs capability statement/i);
  });

  it('7. plain-English refinement', () => {
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/Which sounds closest to what you sell/i);
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/Cybersecurity services/i);
    expect(P2_FIRST_TURN_INSTRUCTIONS).toMatch(/Do not use RMF, ATO, CNO, CEMA/i);
  });

  it('9. PATHWAY still asks company when matching is needed', () => {
    expect(POTATO_JOURNEY_INSTRUCTIONS).toMatch(/Which company should I match against what I found/i);
    expect(POTATO_JOURNEY_INSTRUCTIONS).toMatch(/Keep this market-level for now/i);
    expect(HOST_RULES_PATHWAY_FIT.join('\n')).toMatch(/Which company should I match against what I found/i);
    expect(HOST_RULES_PATHWAY_FIT.join('\n')).toMatch(/Resolve UEI\/CAGE\/SAM internally/i);
  });

  it('10. MONITOR still waits for confirmation', () => {
    expect(HOST_RULES_MONITOR.join('\n')).toMatch(/wait for confirmation/i);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toMatch(/Confirm before calling schedule_market_search/i);
  });
});

describe('P2 FIND local presentation + one-FIND', () => {
  it('3. one-FIND instruction is present locally on FIND result', () => {
    const presentation = buildFindPresentation();
    expect(presentation.host_rules).toEqual([...HOST_RULES_FIND_FIRST_VALUE]);
    expect(presentation.host_rules.join('\n')).toMatch(/ONE FIND/i);
    expect(presentation.host_rules.join('\n')).toMatch(/Do not call find_opportunities again before presenting/i);
    expect(presentation.host_rules.join('\n')).toMatch(/Do not fan out parallel FIND variants/i);
    expect(presentation.sections.open_now.display_title).toBe('Open now');
    expect(presentation.sections.coming_back.display_title).toBe('Coming back');
    expect(presentation.sections.coming_soon.display_title).toBe('Coming soon');
    expect(presentation.sections.gaps.provenance_label).toMatch(/never fabricated as zero/i);
  });

  it('one broad customer intent → one FIND call before first value (instruction regression)', () => {
    const haystack = `${P2_FIRST_TURN_INSTRUCTIONS}\n${HOST_RULES_FIND_FIRST_VALUE.join('\n')}\n${MCP_CONNECTOR_INSTRUCTIONS}`;
    expect(haystack).toMatch(/find_opportunities ONCE/i);
    expect(haystack).toMatch(/Do not call find_opportunities a second time or in parallel/i);
    expect(haystack).not.toMatch(/call find_opportunities three times/i);
  });

  it('8. UNDERSTAND remains confirmation-gated', () => {
    const next = buildFindNext('specific', {
      open_now: hz('grounded', 3, [
        {
          horizon: 'open_now',
          title: 'Cyber RFP',
          buyer: 'SOCOM',
          location_label: null,
          relevant_date: new Date(Date.now() + 7 * 86400_000).toISOString(),
          relevant_date_label: 'response_deadline',
          value_label: null,
          source: 'sam_opportunities',
          why_this_matched: 'test',
          identity: { kind: 'notice_id', id: 'abc' },
          notice_id: 'abc',
        },
      ]),
      coming_back: hz('empty', 0),
      coming_soon: hz('empty', 0),
    } as Record<HorizonKey, HorizonResult>);
    expect(next[0].tool).toBe('understand_customer');
    expect(next[0].requires_confirmation).toBe(true);
    expect(HOST_RULES_FIND_FIRST_VALUE.join('\n')).toMatch(/Do not auto-call understand_customer/i);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toMatch(/UNDERSTAND is confirmation-gated — do not auto-call it/i);
  });
});
