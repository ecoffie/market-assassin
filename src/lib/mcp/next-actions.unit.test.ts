/**
 * Guided next-step suggestions on MCP tool results.
 *
 * Pins the search → assess → monitor arc and the "suggest ≠ execute" contract
 * so an agent can guide customers without inventing a workflow or auto-running
 * paid / watch / delivery tools.
 */
import { describe, it, expect } from 'vitest';
import {
  attachNextActions,
  suggestNextActions,
  type McpNextBlock,
} from './next-actions';
import { MCP_CONNECTOR_INSTRUCTIONS } from './schedule-discovery';

function expectConfirmation(block: McpNextBlock | null, tool: string) {
  expect(block).not.toBeNull();
  expect(block!.primary.tool).toBe(tool);
  expect(block!.primary.requires_confirmation).toBe(true);
  expect(typeof block!.primary.credits).toBe('number');
  expect(block!.primary.prompt.length).toBeGreaterThan(10);
}

describe('MCP connector instructions — guided next steps', () => {
  it('teaches the agent to use _next and not auto-execute confirmation tools', () => {
    expect(MCP_CONNECTOR_INSTRUCTIONS).toContain('_next');
    expect(MCP_CONNECTOR_INSTRUCTIONS.toLowerCase()).toContain('requires_confirmation');
    expect(MCP_CONNECTOR_INSTRUCTIONS.toLowerCase()).toMatch(/do not auto-run/);
    expect(MCP_CONNECTOR_INSTRUCTIONS.toLowerCase()).toContain('ordinary language');
  });

  it('keeps schedule-discovery routing intact', () => {
    expect(MCP_CONNECTOR_INSTRUCTIONS).toContain('schedule_market_search');
    expect(MCP_CONNECTOR_INSTRUCTIONS.toLowerCase()).toContain('monitor');
  });
});

describe('suggestNextActions — opportunity search → monitor', () => {
  it('after a grounded search, offers to monitor (primary) and assess top match (secondary)', () => {
    const next = suggestNextActions(
      'search_sam_opportunities',
      {
        count: 2,
        items: [
          { title: 'IT Support', solicitation_number: '47QTCB26R0001', naics_code: '541512' },
          { title: 'Cloud Ops', solicitation_number: '47QTCB26R0002', naics_code: '541512' },
        ],
      },
      { keyword: 'cybersecurity', naics: '541512', state: 'FL' },
    );
    expectConfirmation(next, 'schedule_market_search');
    expect(next!.primary.prompt.toLowerCase()).toMatch(/monitor/);
    expect(next!.primary.suggested_args?.filters).toMatchObject({
      keyword: 'cybersecurity',
      naics: '541512',
      state: 'FL',
    });
    expect(next!.secondary?.tool).toBe('get_solicitation_incumbent');
    expect(next!.secondary?.suggested_args).toEqual({ solicitation_number: '47QTCB26R0001' });
    expect(next!.secondary?.requires_confirmation).toBe(true);
  });

  it('returns null when the search found nothing', () => {
    expect(
      suggestNextActions('search_sam_opportunities', { count: 0, items: [] }, { keyword: 'zzznomatch' }),
    ).toBeNull();
  });
});

describe('suggestNextActions — watch created → delivery prefs', () => {
  it('shows cadence/destination and offers update_market_schedule', () => {
    const next = suggestNextActions('schedule_market_search', {
      schedule_id: 'ss-1',
      cadence: 'weekly',
      alert_destination: 'account_email',
      _meta: { grounded: true },
    });
    expectConfirmation(next, 'update_market_schedule');
    expect(next!.primary.prompt.toLowerCase()).toMatch(/weekly/);
    expect(next!.primary.prompt.toLowerCase()).toMatch(/email/);
    expect(next!.primary.suggested_args).toEqual({ schedule_id: 'ss-1' });
    expect(next!.primary.credits).toBe(0);
  });
});

describe('suggestNextActions — incumbent / bid / dossier arc', () => {
  it('after incumbent lookup, offers bid-fit then dossier', () => {
    const next = suggestNextActions(
      'get_solicitation_incumbent',
      {
        notice: { solicitation_number: '47QTCB26R0001' },
        incumbent: { recipientName: 'ACME' },
        _meta: { grounded: true },
      },
      { solicitation_number: '47QTCB26R0001' },
    );
    expectConfirmation(next, 'evaluate_bid_decision');
    expect(next!.secondary?.tool).toBe('build_pursuit_dossier');
  });

  it('after a scored pursue recommendation, offers dossier + compliance', () => {
    const next = suggestNextActions(
      'evaluate_bid_decision',
      {
        decision: { recommendation: 'pursue', score: 82 },
        _meta: { grounded: true, scored: true, blocked: false, recommendation: 'pursue' },
      },
      { solicitation_number: '47QTCB26R0001' },
    );
    expectConfirmation(next, 'build_pursuit_dossier');
    expect(next!.secondary?.tool).toBe('extract_compliance_matrix');
  });

  it('after a scored no-bid, offers coaching instead of dossier', () => {
    const next = suggestNextActions('evaluate_bid_decision', {
      decision: { recommendation: 'no_bid', blocked: true },
      _meta: { grounded: true, scored: true, blocked: true, recommendation: 'no_bid' },
    });
    expectConfirmation(next, 'get_winning_playbook');
  });
});

describe('suggestNextActions — market report → buyers', () => {
  it('offers agency intel on the top buyer', () => {
    const next = suggestNextActions('generate_market_report', {
      subject: 'cybersecurity',
      sections: {
        top_agencies: [{ name: 'Department of Defense' }, { name: 'Department of Homeland Security' }],
      },
      _meta: { grounded: true, sections_grounded: 4 },
    });
    expectConfirmation(next, 'get_agency_intel');
    expect(next!.primary.prompt).toContain('Department of Defense');
    expect(next!.primary.suggested_args).toEqual({ agency: 'Department of Defense' });
    expect(next!.secondary?.tool).toBe('search_federal_contacts');
  });
});

describe('attachNextActions', () => {
  it('adds _next without clobbering an existing _next', () => {
    const withOwn = attachNextActions(
      'search_sam_opportunities',
      {
        count: 1,
        items: [{ solicitation_number: 'X' }],
        _next: { primary: { prompt: 'custom', tool: 'get_balance', credits: 0, requires_confirmation: false } },
      },
      { keyword: 'it' },
    );
    expect((withOwn._next as McpNextBlock).primary.tool).toBe('get_balance');
  });

  it('decorates a plain search result', () => {
    const out = attachNextActions(
      'search_sam_opportunities',
      { count: 1, items: [{ solicitation_number: '47QTCB26R0001' }] },
      { keyword: 'it' },
    );
    expect(out._next).toBeDefined();
    expect((out._next as McpNextBlock).primary.tool).toBe('schedule_market_search');
  });
});

/**
 * Complete conversation contract: search → assess → monitor using ordinary-language
 * intents. No live APIs — proves the `_next` chain a host agent should follow.
 */
describe('conversation: search → assess → monitor', () => {
  it('walks the guided arc with confirmation gates at each paid/watch step', () => {
    // 1) Customer: "find cybersecurity opps in Florida"
    const afterSearch = suggestNextActions(
      'search_sam_opportunities',
      {
        count: 3,
        items: [{ title: 'Cyber RFP', solicitation_number: 'N00178-26-R-0001' }],
      },
      { keyword: 'cybersecurity', state: 'FL' },
    );
    expect(afterSearch!.primary.tool).toBe('schedule_market_search');
    expect(afterSearch!.primary.requires_confirmation).toBe(true);
    expect(afterSearch!.secondary!.tool).toBe('get_solicitation_incumbent');

    // 2) Customer: "check the top one for me" (assess) — NOT auto from step 1
    const afterIncumbent = suggestNextActions(
      'get_solicitation_incumbent',
      {
        notice: { title: 'Cyber RFP' },
        incumbent: { recipientName: 'Leidos' },
        _meta: { grounded: true, solicitation: 'N00178-26-R-0001' },
      },
      { solicitation_number: 'N00178-26-R-0001' },
    );
    expect(afterIncumbent!.primary.tool).toBe('evaluate_bid_decision');
    expect(afterIncumbent!.primary.requires_confirmation).toBe(true);

    // 3) Customer scores → pursue
    const afterBid = suggestNextActions(
      'evaluate_bid_decision',
      {
        _meta: { grounded: true, scored: true, blocked: false, recommendation: 'pursue' },
      },
      { solicitation_number: 'N00178-26-R-0001' },
    );
    expect(afterBid!.primary.tool).toBe('build_pursuit_dossier');
    expect(afterBid!.primary.requires_confirmation).toBe(true);

    // 4) Customer: "also keep watching this search" — monitor (from step 1 primary)
    const afterWatch = suggestNextActions('schedule_market_search', {
      schedule_id: 'watch-1',
      cadence: 'daily',
      alert_destination: 'account_email',
      filters: { keyword: 'cybersecurity', state: 'FL' },
      _meta: { grounded: true, schedule_saved: true },
    });
    expect(afterWatch!.primary.tool).toBe('update_market_schedule');
    expect(afterWatch!.primary.requires_confirmation).toBe(true);
    expect(afterWatch!.primary.prompt.toLowerCase()).toMatch(/daily/);
  });
});

describe('next-action credit prices track TOOL_CREDITS', () => {
  /**
   * Permanent drift guard: NEXT_TOOL_CREDITS duplicates TOOL_CREDITS to avoid a
   * circular import. If either side is repriced alone, the host will quote the
   * wrong cost — this test must stay green forever, not get deleted as "redundant."
   */
  it('every _next-quoted credit equals the live registry price', async () => {
    const { nextToolCreditEntries } = await import('./next-actions');
    const { TOOL_CREDITS } = await import('./tool-registry');
    const entries = nextToolCreditEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const [tool, quoted] of entries) {
      expect(TOOL_CREDITS[tool], `${tool} missing from TOOL_CREDITS`).toBeDefined();
      expect(quoted, `${tool} drift: _next quotes ${quoted}, registry is ${TOOL_CREDITS[tool]}`).toBe(
        TOOL_CREDITS[tool],
      );
    }
  });

  it('emitted _next blocks use those aligned prices', async () => {
    const { TOOL_CREDITS } = await import('./tool-registry');
    const afterSearch = suggestNextActions(
      'search_sam_opportunities',
      { count: 1, items: [{ solicitation_number: 'X' }] },
      { keyword: 'it' },
    )!;
    expect(afterSearch.primary.credits).toBe(TOOL_CREDITS.schedule_market_search);
    expect(afterSearch.secondary!.credits).toBe(TOOL_CREDITS.get_solicitation_incumbent);

    const afterBid = suggestNextActions(
      'evaluate_bid_decision',
      { _meta: { grounded: true, scored: true, blocked: false, recommendation: 'pursue' } },
      {},
    )!;
    expect(afterBid.primary.credits).toBe(TOOL_CREDITS.build_pursuit_dossier);
    expect(afterBid.secondary!.credits).toBe(TOOL_CREDITS.extract_compliance_matrix);
  });
});
