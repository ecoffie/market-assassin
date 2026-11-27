import { describe, it, expect } from 'vitest';
import { COMPETITION_AND_START_PLAYBOOK } from './competition-playbook';
import { RESEARCH_INSTRUCTIONS } from './research-mode';

describe('least-competition / where-to-start method (Claude + MCP, as written)', () => {
  it('A: the call order, the competition signals, and honesty about bidder counts', () => {
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/find_opportunities\(query = X\); get_expiring_contracts\(naics, agency, state\); assess_market_depth\(naics, set_aside, state\); get_award_detail on the top 2 to 3; get_agency_spending_detail\(agency\)/);
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/capable_depth, eligible_population and tiers/);
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/a smaller order is an easier first win/);
    expect(COMPETITION_AND_START_PLAYBOOK).not.toMatch(/\$\d/); // Eric 2026-11-27: no unsourced numbers
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/number_of_offers and competition_type are EMPTY .* never imply bidders were counted/);
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/Never call it "no competition" because a search came back empty or a contract is still within its term/);
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/only holds a registration is not a competitor/);
  });
  it('B: VA first, one lane by the 5 tests, the nearest real buyer, statewide depth', () => {
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/get_sba_goaling_share\("VA"\) or get_agency_spending_detail\("VA"\)/);
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/find_opportunities\(query, agency = "VA", set_aside = "SDVOSB", location = state\)/);
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/Pick ONE lane that passes the most of these 5 tests/);
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/Test 5 is the one question to ask/);
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/use the nearest real buyer and say so/);
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/say "statewide" when you cite it/);
  });
  it('the answer order and what to leave out', () => {
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/\(1\) where I would start, in 2 to 3 lines: one buyer, one line of work, one first target with its date; \(2\) why: 3 contracts/);
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/\(5\) one refinement question/);
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/Leave out: NAICS jargon, long lists \(no 40-row tables\), and asking for company details before giving value/);
  });
  it('research mode carries it', () => {
    expect(RESEARCH_INSTRUCTIONS).toContain(COMPETITION_AND_START_PLAYBOOK);
  });
});
