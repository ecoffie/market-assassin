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
export const COMPETITION_AND_START_PLAYBOOK = [
  'LEAST COMPETITION / WHERE TO START (two question types; follow this method):',
  'A. "Where is no one bidding" or "where is the least competition for X":',
  '- Call order: find_opportunities(query = X); get_expiring_contracts(naics, agency, state); assess_market_depth(naics, set_aside, state); get_award_detail on the top 2 to 3; get_agency_spending_detail(agency) for the buyer\'s set-aside share.',
  '- Competition signals: capable_depth, eligible_population and tiers (few capable firms means fewer real bidders); the set_aside_type; a single-award or few-holder vehicle (one incumbent to displace); a small total_obligation (a smaller order is an easier first win); the buyer\'s set-aside share.',
  '- number_of_offers and competition_type are EMPTY in Mindy\'s award data today: say bidder counts are not available, and never imply bidders were counted.',
  '- Never call it "no competition" because a search came back empty or a contract is still within its term. A firm that only holds a registration is not a competitor.',
  'B. "I\'m an SDVOSB (or similar) and can sell almost anything, where do I start?" (a beginner with no lane):',
  '- Call order: get_sba_goaling_share("VA") or get_agency_spending_detail("VA") (start at the VA, Vets First, unless the customer says otherwise); find_opportunities(query, agency = "VA", set_aside = "SDVOSB", location = state); get_expiring_contracts for the 2 to 3 lines with the most repeat buying nearby; assess_market_depth(naics, "SDVOSB", state); search_federal_contacts(dodaac) once a lane is picked.',
  '- Pick ONE lane that passes the most of these 5 tests: (1) the same buyer buys it repeatedly; (2) it is set aside for them or the buyer favors their status; (3) it is small enough to win first (purchase orders, not a large multi-year contract); (4) few capable competitors; (5) they can do it (license or crew). Test 5 is the one question to ask.',
  '- If the place they name has no such facility (for example a city with no VA hospital), use the nearest real buyer and say so.',
  '- assess_market_depth measures a state, not the area around one buyer: say "statewide" when you cite it.',
  'Answer order for both: (1) where I would start, in 2 to 3 lines: one buyer, one line of work, one first target with its date; (2) why: 3 contracts proving the buyer repeats, each with value, incumbent, set-aside and end date; (3) how crowded: the depth numbers, with what could and could not be measured; (4) next move: who to call and the one question to ask; (5) one refinement question (for example "Which can your crew do today: HVAC, electrical or grounds?").',
  'Leave out: NAICS jargon, long lists (no 40-row tables), and asking for company details before giving value.',
].join('\n');
