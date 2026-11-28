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
    expect(COMPETITION_AND_START_PLAYBOOK).toMatch(/a row's number_of_offers \/ competition_type count only when competition_fields_source is set .* never imply bidders were counted/);
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
    // #2583 shape (Agent 3): _meta.competition.coverage_line, row competition_status, competition_fields_source.
    expect(COMPETITION_ANSWER_RULES).toMatch(/When get_expiring_contracts returns _meta\.competition\.coverage_line \("Competition checked on X of Y contracts; offers reported on N, set-aside reported on M; K not checked"\), quote it VERBATIM/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/Otherwise count the rows yourself and say "offers reported on X of Y candidates" \(X = rows whose offers are reported, Y = all candidate rows you ranked from\)/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/Ranking a few contracts without a coverage line is wrong/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/number_of_offers null means NOT REPORTED, never one bidder and never zero/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/competition_status "not_checked" means the row was NOT CHECKED \(past the lookup cap\): say "not checked", never "not reported"/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/usable when competition_fields_source is set \("usaspending_award" = that award's own record; "usaspending_parent_idv" = the parent vehicle's record, so say the count is for the vehicle, not this order\)/);
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
    // Worded to match the source and linked to it (Eric, 2026-11-28: "yes link the source").
    expect(DEFENSE_LAG_LINE).toBe('Defense contract data (DoD and the Army Corps of Engineers) is published on a 90-day delay ([USAspending: About the Data](https://www.usaspending.gov/data/about-the-data-download.pdf))');
    expect(DEFENSE_LAG_LINE).toMatch(/\[USAspending: About the Data\]\(https:\/\/www\.usaspending\.gov\/[^)]+\)/); // a markdown link
    expect(COMPETITION_ANSWER_RULES).toContain(`use exactly: "${DEFENSE_LAG_LINE}"`);
    expect(NO_DATA_DATES).toContain(DEFENSE_LAG_LINE);
    expect(RESEARCH_INSTRUCTIONS).toContain(DEFENSE_LAG_LINE);
    const route = readFileSync(join(process.cwd(), 'src/app/api/app/chat/route.ts'), 'utf8');
    expect(route).toContain('${DEFENSE_LAG_LINE}, so recent awards may not appear yet'); // the route interpolates the one constant
    for (const t of [COMPETITION_ANSWER_RULES, NO_DATA_DATES, RESEARCH_INSTRUCTIONS, route]) expect(t).not.toMatch(/show up about 90 days late|post about 90 days late|publish about 90 days late|with a delay of about 90 days \(DoD reporting policy\)/);
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

describe('35-prompt production run fixes (2026-11-28: 28 pass / 7 fail)', () => {
  it('Q19: not competed / sole source is "awarded without competition", never "only one bidder"; one offer only on a competed award', () => {
    expect(COMPETITION_ANSWER_RULES).toMatch(/competition class is not_competed, whose extent_competed says not competed or not available for competition, or that has a sole_source_reason .* was AWARDED WITHOUT COMPETITION/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/Say "awarded without competition \(sole source: <reason>\)"\. Never call it "only one bidder" or "one offer"\. "One offer" applies only to a COMPETED award whose number_of_offers is 1/);
  });
  it('Q9/Q33: places are ranked only from a real count, never a sample; follow-ups keep the caveat', () => {
    expect(COMPETITION_ANSWER_RULES).toMatch(/ranked only from a real count: assess_market_depth eligible_population and capable_depth per state \(exhaustive counts\)/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/A sample or a capped list of firms \(for example 5 per state\) is NEVER a count: never say "Vermont has 1 firm" from it/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/If no real count is available for the places asked, say the count is not available and do not rank them/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/A follow-up that reuses earlier numbers carries the same caveat and never restates a sample as fact/);
  });
  it('Q34: current period vs options, written against both potential-end field names', () => {
    expect(COMPETITION_ANSWER_RULES).toMatch(/current period end \(period_of_performance_current_end\) and a potential end with all options \(period_of_performance_potential_end or potential_end_date\), say "current period ends <date>; options can run to <date>"/);
    expect(COMPETITION_ANSWER_RULES).toMatch(/Never present the current period end as the contract's end when options exist/);
  });
  it('Q13/Q26: "does not list a city" only when place_of_performance_city is actually empty', () => {
    expect(COMPETITION_ANSWER_RULES).toMatch(/say a record "does not list a city" only when the place-of-performance city field \(place_of_performance_city\) is actually empty on those rows/);
  });
  it('Q27: a fact another result in the chat contains is used, never "could not be established"', () => {
    expect(COMPETITION_ANSWER_RULES).toMatch(/if any tool result in this conversation gives a fact \(a response deadline, an incumbent, an end date\), use it\. Never say a fact "could not be established" when another result in the same conversation contains it/);
  });
});
