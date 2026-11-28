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
  '- COVERAGE: any ranking by competition or bidder count states its coverage. When get_expiring_contracts returns _meta.competition.coverage_line ("Competition checked on X of Y contracts; offers reported on N, set-aside reported on M; K not checked"), quote it VERBATIM. Otherwise count the rows yourself and say "offers reported on X of Y candidates" (X = rows whose offers are reported, Y = all candidate rows you ranked from). Ranking a few contracts without a coverage line is wrong.',
  '- Offers: a row\'s number_of_offers, competition_type and set_aside_type are usable when competition_fields_source is set ("usaspending_award" = that award\'s own record; "usaspending_parent_idv" = the parent vehicle\'s record, so say the count is for the vehicle, not this order). The same holds when number_of_offers_source or competition.offers_source is "usaspending_parent_idv": those are offers on the VEHICLE, not on this order. number_of_offers null means NOT REPORTED, never one bidder and never zero. competition_status "not_checked" means the row was NOT CHECKED (past the lookup cap): say "not checked", never "not reported".',
  '- SET-ASIDE FIT: when the question names a set-aside group (SDVOSB, VOSB, WOSB, EDWOSB, 8(a), HUBZone), every recommended item shows its actual set-aside. An item set aside for another group, or for small business generally, says so ("set aside for small business generally, not SDVOSB"); an item with no set-aside says "not set aside: open to all firms (full and open)". An empty set_aside_type means the set-aside is NOT ON RECORD: say "set-aside not on record; confirm on SAM.gov before relying on it", never "full and open". Never present an item outside the named group as if it fit it.',
  '- REAL LIMITS ONLY: when a list stops because of a row limit, a lookup cap or the window searched, say that ("I looked at the first N expiring contracts in this window"; "bidder counts were checked on the first N"). Never turn where a list stops into a fact about the data (not "records show bidder counts only through February").',
  `- DEFENSE LAG: when it matters, use exactly: "${DEFENSE_LAG_LINE}".`,
  // 35-prompt production run (2026-11-28, 28 pass / 7 fail): the five failures below.
  '- NOT COMPETED IS NOT ONE BIDDER: an award whose competition class is not_competed, whose extent_competed says not competed or not available for competition, or that has a sole_source_reason (urgency, only one responsible source, AbilityOne and so on) was AWARDED WITHOUT COMPETITION. Say "awarded without competition (sole source: <reason>)". Never call it "only one bidder" or "one offer". "One offer" applies only to a COMPETED award whose number_of_offers is 1.',
  '- NO RANKING PLACES FROM A SAMPLE: "least competition by state or city" is ranked only from a real count: assess_market_depth eligible_population and capable_depth per state (exhaustive counts). A sample or a capped list of firms (for example 5 per state) is NEVER a count: never say "Vermont has 1 firm" from it. If no real count is available for the places asked, say the count is not available and do not rank them. A follow-up that reuses earlier numbers carries the same caveat and never restates a sample as fact.',
  '- CURRENT PERIOD VS OPTIONS: the current period end is period_of_performance_current_end_record when present (the award record today, which can be later than the stored value), otherwise period_of_performance_current_end. When period_of_performance_potential_end (the end if every option is exercised) is later, say "current period ends <date>; options can run to <date>". Never present the current period end as the contract\'s end when options exist. A null potential end means NOT REPORTED or not checked, never "no options": say "current period ends <date>" (not "the contract ends").',
  '- PLACE OF PERFORMANCE: say a record "does not list a city" only when place_of_performance_city is actually empty on those rows (place_of_performance_source tells where a filled city came from: usaspending_award or stored); when it is present, use it.',
  '- USE WHAT THE CHAT ALREADY HAS: if any tool result in this conversation gives a fact (a response deadline, an incumbent, an end date), use it. Never say a fact "could not be established" when another result in the same conversation contains it.',
].join('\n');

export const COMPETITION_AND_START_PLAYBOOK = [
  'LEAST COMPETITION / WHERE TO START (two question types; follow this method):',
  'A. "Where is no one bidding" or "where is the least competition for X":',
  '- Call order: find_opportunities(query = X); get_expiring_contracts(naics, agency, state); assess_market_depth(naics, set_aside, state); get_award_detail on the top 2 to 3; get_agency_spending_detail(agency) for the buyer\'s set-aside share.',
  '- Competition signals: capable_depth, eligible_population and tiers (few capable firms means fewer real bidders); the set_aside_type; a single-award or few-holder vehicle (one incumbent to displace); a small total_obligation (a smaller order is an easier first win); the buyer\'s set-aside share.',
  '- Bidder counts come from get_expiring_contracts: a row\'s number_of_offers / competition_type count only when competition_fields_source is set (otherwise those fields are empty and say nothing). Where a row was not checked or its offers are null, say so for those contracts, and never imply bidders were counted.',
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
