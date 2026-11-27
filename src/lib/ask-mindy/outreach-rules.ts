/**
 * How Ask Mindy writes what the customer will SAY and SEND, and how it plans their outreach (Eric, 2026-11-27, from the
 * Claude + Mindy MCP "EFS Digital: CT Guard and Coast Guard Academy Action Plan" and Eric's own outreach method).
 * One source for research mode, standard Ask Mindy and create_document, so the three never drift.
 *
 * Also: the customer's question overrides the saved Vault profile (a demo prospect's question must never be answered
 * for the presenter's company), and record dates are not printed as data freshness (Eric: "Claude MCP does not have
 * dates"; dates make the data look stale). Opportunity dates (deadlines, contract end dates, registration expiry, the
 * defense award-reporting lag) are facts about the work and stay.
 */

/** The customer's words beat the saved profile. Appended wherever a saved profile reaches the model. */
export const QUESTION_OVER_PROFILE =
  'QUESTION OVER PROFILE: facts the customer states in THIS conversation (their status or certifications, location, what'
  + ' they sell, the company they name) override the saved profile. Use the profile only to fill what the question leaves'
  + ' out. When the question describes a different business (another company named, other work, another place), do not use'
  + ' the profile at all and do not mention it in the answer body; at most one line in Sources and coverage.';

/** No data-freshness dates in what the customer reads. */
export const NO_DATA_DATES =
  'DATES: never print how current Mindy\'s data is or when a record was read ("as of", "data through", "record from'
  + ' <date>", "retrieved"). Say what the record shows. Dates that are facts about the work stay: response deadlines,'
  + ' contract end dates, registration expiry, campaign timing, and caveats such as "defense awards publish about 90 days'
  + ' late, so a missing recent award does not mean they stopped buying".';

/** Eric's outreach method (rules 0-6), the "Before you send" checklist and the closing line. */
export const OUTREACH_RULES = [
  'OUTREACH (every "what to say", call script, email or "draft an email to ..."; the first sentence is about the BUYER, not the company):',
  '1. Lead with their buy, by name: the specific requirement, who won it, the amounts and the end date, and that no follow-on has been published when that is what the records show (e.g. "Your office has bought recruiting advertising for the State Guard each of the last two years. The last order ended in July, and I could not find a follow-on award yet.").',
  '2. The pain point is a reason, not a lecture: take it from a cited source (the notice or work statement, GAO or IG findings, a strategic plan, a budget justification) and turn it into one line about what the company delivers ("... so you can show exactly what each dollar produced"). Never tell a buyer they have a problem; say what they will be able to show. An uncited pain point is a hypothesis and is not used.',
  '3. One proof point from their world: the company\'s closest real result (commercial is fine with no federal past performance). Use only real numbers from the conversation or the records; otherwise leave [brackets] and say only the company can fill them. Never invent a metric.',
  '4. A small, specific ask: two reply-sized questions (e.g. "When do you expect the next requirement?" and "Can we be added to your quote list?"). Not "consider us for future work", not a meeting request on first contact, never asking for the work on the first call.',
  '5. Credentials last, in a block under the signature: legal name, UEI, CAGE, certifications, NAICS. A certification is a tiebreaker unless the buy is set aside for it; never open with "We are a [certification] firm".',
  '6. Short, plain and local: under 150 words, no em dashes, no jargon, and the local address when it matters ("in-state work, in-state firm").',
  'After a script or email add "Before you send": renew SAM if it expires soon (give the expiry date), fix stale items on the capability statement that the records contradict, fill the [brackets] with real numbers or cut that sentence, and follow up once by phone after 7 to 10 business days with the same two questions. Close with: "Every fact in this script comes from Mindy\'s data, except the bracketed results, which only <company> can supply."',
].join('\n');

/** The action-plan deliverable ("action plan", "who should I talk to", "what events", "what should I say"). */
export const ACTION_PLAN_STRUCTURE = [
  'ACTION PLAN (when the customer asks for an action plan, who to talk to, which events to attend or what to say), in this order:',
  '1. Dates that matter: opportunity dates only (response deadlines, registration expiry, contract end dates, when the buyer usually buys), each with what to do by then.',
  '2. The pitch in three lines: what the company does, the buyer\'s cited problem and what the company delivers against it, why they are close (local, already known). No certification in the pitch.',
  '3. Who buys this work here: a table of the buyer\'s own past buys (year, what, who won, amount), and what a missing recent year means.',
  '4. Who to talk to and what to say: a table (person or office, how to reach them, why they matter to this company, the one question to ask). Contracting officers from recent notices, the person who feels the problem (program, outreach or recruiting lead from an official page), the agency small business office (lookup_federal_osbp), and the office\'s published inbox when no person is named. Every named contact carries a citation marker [n] pointing to its source (the notice number or official page) in Sources; write no \'from the notice...\' prose in the table or body. Check staleness yourself: a contact whose newest source is older than about six months is dropped or marked "confirm this contact before reaching out", with no date shown. Fewer verified contacts beat a long list. Never infer an email from a name pattern; unpublished means it is left out, and say so.',
  '5. The plan, week by week: dated moves, including the events where these buyers will be (search_federal_events / get_federal_event_series, or an official event page read with read_web_page); name only events confirmed by a source, and say plainly when none are confirmed.',
  '6. What to say on every call: lead with their problem, show one real example, be local, end with what they plan to buy, when and how they will post it, and ask to be on the quote list rather than for the work.',
  '7. Emails to send: short, following OUTREACH, each naming that office\'s own past buys.',
  '8. Sources.',
].join('\n');

/** Everything above, for the prompts that need all of it. */
export const OUTREACH_AND_PLAN_RULES = [OUTREACH_RULES, '', ACTION_PLAN_STRUCTURE, '', NO_DATA_DATES].join('\n');
