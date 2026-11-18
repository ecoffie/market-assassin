import { describe, expect, it } from 'vitest';
import { shouldOfferSecondToolRound, SECOND_ROUND_SEED_TOOLS } from './second-tool-round';

describe('shouldOfferSecondToolRound', () => {
  it('offers a second round after a successful seed tool', () => {
    expect(shouldOfferSecondToolRound([{ tool: 'get_solicitation_incumbent', status: 'success' }])).toBe(true);
    expect(shouldOfferSecondToolRound([{ tool: 'lookup_solicitation', status: 'success' }])).toBe(true);
  });

  it('does not offer when round 1 had no tools, only failures, or non-seed tools', () => {
    expect(shouldOfferSecondToolRound([])).toBe(false);
    expect(shouldOfferSecondToolRound([{ tool: 'get_solicitation_incumbent', status: 'failed' }])).toBe(false);
    expect(shouldOfferSecondToolRound([{ tool: 'get_my_pipeline', status: 'success' }])).toBe(false);
  });

  it('does not offer after timeout or planner failure', () => {
    const seed = [{ tool: 'lookup_solicitation', status: 'success' }];
    expect(shouldOfferSecondToolRound(seed, { turnTimedOut: true })).toBe(false);
    expect(shouldOfferSecondToolRound(seed, { plannerUnavailable: true })).toBe(false);
  });

  it('seed set is notice/award unlocks only — not open/expiring list tools', () => {
    for (const t of ['lookup_solicitation', 'get_solicitation_incumbent', 'search_past_contracts']) {
      expect(SECOND_ROUND_SEED_TOOLS.has(t)).toBe(true);
    }
    expect(SECOND_ROUND_SEED_TOOLS.has('find_opportunities')).toBe(false);
    expect(SECOND_ROUND_SEED_TOOLS.has('search_sam_opportunities')).toBe(false);
    expect(SECOND_ROUND_SEED_TOOLS.has('get_expiring_contracts')).toBe(false);
    expect(SECOND_ROUND_SEED_TOOLS.has('create_document')).toBe(false);
  });
});
