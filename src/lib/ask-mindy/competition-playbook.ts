/**
 * How to answer two reference questions the way Claude + Mindy MCP does (Eric's Claude session, relayed by Agent 4,
 * 2026-11-27). Encoded as written, not redesigned:
 *   A. "Where is no one bidding / where is the least competition for X?"
 *   B. "I'm an SDVOSB and can sell almost anything. Where do I start?"
 * Used by research mode and by standard Ask Mindy answers (the same tools).
 *
 * Data gaps stated honestly until Data Core fixes them: number_of_offers / competition_type are empty on awards, and
 * assess_market_depth works at state level, not near one buyer.
 */
import { DEFENSE_LAG_LINE } from './outreach-rules';

/**
 * Answer rules from the production test of least-competition questions (2026-11-28: SDVOSB IT, WOSB Virginia, SDVOSB with
 * 1 to 2 bidders). Every ranking states its coverage, every pick shows its real set-aside, and no list cut-off is
 * presented as a fact about the data.
 */
export const COMPETITION_ANSWER_RULES = [
  'COMPETITION ANSWER RULES (every least-competition or bidder-count answer):',
  '- COVERAGE: any ranking by competition or bidder count states "offers reported on X of Y candidates". Use the tool\'s own coverage counts when it returns them (get_expiring_contracts competition.offers_reported of competition.checked, plus competition.not_checked that were not looked up, or a coverage line on the rows); otherwise count the rows yourself: X = rows whose offers are reported, Y = all candidate rows you ranked from. Ranking a few contracts without that line is wrong.',
  '- Offers: competition.offers_received on a row is the bidder count from that award\'s record; null means NOT REPORTED, never one bidder and never zero. competition: null means the row was not looked up.',
  '- SET-ASIDE FIT: when the question names a set-aside group (SDVOSB, VOSB, WOSB, EDWOSB, 8(a), HUBZone), every recommended item shows its actual set-aside. An item set aside for another group, or for small business generally, says so ("set aside for small business generally, not SDVOSB"); an item with no set-aside says "not set aside: open to all firms (full and open)". An empty set_aside_type means the set-aside is NOT ON RECORD: say "set-aside not on record; confirm on SAM.gov before relying on it", never "full and open". Never present an item outside the named group as if it fit it.',
  '- REAL LIMITS ONLY: when a list stops because of a row limit, a lookup cap or the window searched, say that ("I looked at the first N expiring contracts in this window"; "bidder counts were checked on the first N"). Never turn where a list stops into a fact about the data (not "records show bidder counts only through February").',
  `- DEFENSE LAG: when it matters, use exactly: "${DEFENSE_LAG_LINE}".`,
].join('\n');

export const COMPETITION_AND_START_PLAYBOOK = [
  'LEAST COMPETITION / WHERE TO START (two question types; follow this method):',
  'A. "Where is no one bidding" or "where is the least competition for X":',
  '- Call order: find_opportunities(query = X); get_expiring_contracts(naics, agency, state); assess_market_depth(naics, set_aside, state); get_award_detail on the top 2 to 3; get_agency_spending_detail(agency) for the buyer\'s set-aside share.',
  '- Competition signals: capable_depth, eligible_population and tiers (few capable firms means fewer real bidders); the set_aside_type; a single-award or few-holder vehicle (one incumbent to displace); a small total_obligation (a smaller order is an easier first win); the buyer\'s set-aside share.',
  '- Bidder counts come only from get_expiring_contracts\' competition object (each award\'s own record), never from number_of_offers or competition_type on the row (those are empty). Where competition was not looked up or offers are null, say bidder counts are not reported for those contracts, and never imply bidders were counted.',
  '- Never call it "no competition" because a search came back empty or a contract is still within its term. A firm that only holds a registration is not a competitor.',
  'B. "I\'m an SDVOSB (or similar) and can sell almost anything, where do I start?" (a beginner with no lane):',
  '- Call order: get_sba_goaling_share("VA") or get_agency_spending_detail("VA") (start at the VA, Vets First, unless the customer says otherwise); find_opportunities(query, agency = "VA", set_aside = "SDVOSB", location = state); get_expiring_contracts for the 2 to 3 lines with the most repeat buying nearby; assess_market_depth(naics, "SDVOSB", state); search_federal_contacts(dodaac) once a lane is picked.',
  '- Pick ONE lane that passes the most of these 5 tests: (1) the same buyer buys it repeatedly; (2) it is set aside for them or the buyer favors their status; (3) it is small enough to win first (purchase orders, not a large multi-year contract); (4) few capable competitors; (5) they can do it (license or crew). Test 5 is the one question to ask.',
  '- If the place they name has no such facility (for example a city with no VA hospital), use the nearest real buyer and say so.',
  '- assess_market_depth measures a state, not the area around one buyer: say "statewide" when you cite it.',
  'Answer order for both: (1) where I would start, in 2 to 3 lines: one buyer, one line of work, one first target with its date; (2) why: 3 contracts proving the buyer repeats, each with value, incumbent, set-aside and end date; (3) how crowded: the depth numbers, with what could and could not be measured; (4) next move: who to call and the one question to ask; (5) one refinement question (for example "Which can your crew do today: HVAC, electrical or grounds?").',
  'Leave out: NAICS jargon, long lists (no 40-row tables), and asking for company details before giving value.',
  '',
  ...COMPETITION_ANSWER_RULES.split('\n'),
].join('\n');
