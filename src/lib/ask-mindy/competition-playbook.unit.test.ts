import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPETITION_AND_START_PLAYBOOK, COMPETITION_ANSWER_RULES } from './competition-playbook';
import { DEFENSE_LAG_LINE, NO_DATA_DATES, QUESTION_OVER_PROFILE } from './outreach-rules';
import { RESEARCH_INSTRUCTIONS } from './research-mode';

describe('least-competition / where-to-start method (Claude + MCP, as written)', () => {
  it('A: the call order, the competition signals, and honesty about bidder counts', () => {
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/find_opportunities\(query = X\); get_expiring_contracts\(naics, agency, state\); assess_market_depth\(naics, set_aside, state\); get_award_detail on the top 2 to 3; get_agency_spending_detail\(agency\)/);
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/capable_depth, eligible_population and tiers/);
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/a smaller order is an easier first win/);
    expect(COMPETITION_AND_START_PLAYBOOK).not.toMatch(/\$\d/); // Eric 2026-11-27: no unsourced numbers
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/Bidder counts come only from get_expiring_contracts' competition object .* never imply bidders were counted/);
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

describe('competition answer rules (production test 2026-11-28: SDVOSB IT, WOSB Virginia, SDVOSB 1-2 bidders)', () => {
  it('1. coverage: every ranking states "offers reported on X of Y candidates" from the tool counts', () => {
    expect(COMPETITION_ANSWER_RULES).toMatch(/states, from the tool's own counts, "offers reported on X of Y candidates" \(get_expiring_contracts competition\.offers_reported of competition\.checked/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/Ranking a few contracts without that line is wrong/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/null means NOT REPORTED, never one bidder and never zero/);
  });
  it('2. set-aside fit: each pick shows its real set-aside; outside the named group is labelled; empty is "not on record", never "full and open"', () => {
    expect(COMPETITION_ANSWER_RULES).toMatch(/when the question names a set-aside group \(SDVOSB, VOSB, WOSB, EDWOSB, 8\(a\), HUBZone\), every recommended item shows its actual set-aside/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/"not set aside: open to all firms \(full and open\)"/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/"set aside for small business generally, not SDVOSB"/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/An empty set_aside_type means the set-aside is NOT ON RECORD: say "set-aside not on record; confirm on SAM\.gov before relying on it", never "full and open"/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/Never present an item outside the named group as if it fit it/);
  });
  it('3. no invented data limits: a cut-off is stated as what was looked at, never as a fact about the data', () => {
    expect(COMPETITION_ANSWER_RULES).toMatch(/"I looked at the first N expiring contracts in this window"/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/Never turn where a list stops into a fact about the data/);
  });
  it('4. the Defense lag line is the exact #2549 wording, everywhere it is said', () => {
    expect(DEFENSE_LAG_LINE).toBe('Defense awards are published on USAspending.gov with a delay of about 90 days (DoD reporting policy)');
    expect(COMPETITION_ANSWER_RULES).toContain(`use exactly: "${DEFENSE_LAG_LINE}"`);
    expect(NO_DATA_DATES.replace(/' \+ '/g, '')).toContain('Defense awards are published on USAspending.gov with a delay of about 90 days (DoD reporting policy)');
    expect(RESEARCH_INSTRUCTIONS).toContain(DEFENSE_LAG_LINE);
    const route = readFileSync(join(process.cwd(), 'src/app/api/app/chat/route.ts'), 'utf8');
    expect(route).toContain(DEFENSE_LAG_LINE);
    for (const t of [COMPETITION_ANSWER_RULES, NO_DATA_DATES, RESEARCH_INSTRUCTIONS, route]) expect(t).not.toMatch(/show up about 90 days late|post about 90 days late|publish about 90 days late/);
  });
  it('5. profile: a status with no trade is answered across trades first, then "For your saved profile (<trade>): ..."', () => {
    expect(QUESTION_OVER_PROFILE).toMatch(/names a status or place but no line of work .* do not narrow the searches to the saved profile's trade: answer across trades first, then add a short "For your saved profile \(<trade>\): \.\.\." part/);
    expect(QUESTION_OVER_PROFILE).toMatch(/Saying you used the profile is not enough when it would change which results appear/);
  });
  it('the rules ride with the playbook into both engines', () => {
    expect(COMPETITION_AND_START_PLAYBOOK).toContain('COMPETITION ANSWER RULES');
    expect(RESEARCH_INSTRUCTIONS).toContain('COMPETITION ANSWER RULES');
  });
});
