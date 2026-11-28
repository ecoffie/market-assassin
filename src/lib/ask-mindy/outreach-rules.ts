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
  + ' the profile at all and do not mention it in the answer body; at most one line in Sources and coverage.'
  + ' A FILE THE CUSTOMER ATTACHED counts as their words: when an attached file (a capability statement, company'
  + ' profile, past performance) describes a company, research THAT company, not the saved profile, and say whose'
  + ' file it is from its own name.'
  + ' When the question names a status or place but no line of work ("I\'m an SDVOSB, where is the least competition?"),'
  + ' do not narrow the searches to the saved profile\'s trade: answer across trades first, then add a short "For your saved'
  + ' profile (<trade>): ..." part. Saying you used the profile is not enough when it would change which results appear.';

/** The one wording for the Defense reporting lag (#2549), wherever it is said. */
/**
 * The one wording for the Defense reporting lag, with its source link (Eric, 2026-11-28: "yes link the source"). Worded
 * to match the source: USAspending's About the Data says "Procurement data for DoD and USACE, including contracts and
 * IDVs, is published on a 90-day delay in FPDS" (FPDS's DoD data availability page states the same 90-day delay).
 */
export const DEFENSE_LAG_SOURCE_URL = 'https://www.usaspending.gov/data/about-the-data-download.pdf';
export const DEFENSE_LAG_LINE = `Defense contract data (DoD and the Army Corps of Engineers) is published on a 90-day delay ([USAspending: About the Data](${DEFENSE_LAG_SOURCE_URL}))`;

/**
 * A company's OWN claims from its attached file (Eric, 2026-11-27, "claims-by-audience", from the Claude + Mindy MCP
 * baseline). Production retest: figures in an attached capability statement ("$35 billion+") came back "not
 * established". They are sourced to the file, and WHO READS decides the wording.
 */
export const ATTACHED_FACTS_SOURCED =
  'FACTS FROM AN ATTACHED FILE ARE SOURCED to that file: cite the file. Who reads decides the wording.'
  + ' (a) In a document prepared FOR that company (its report, capability statement, leave-behind), state its own claims AS'
  + ' WRITTEN: no "<Company> states", no brackets, no "reportedly", and never an "Unverified" label.'
  + ' (b) In anything addressed to a third party (an outreach email, a teaming note), attribute in plain words: "<Company>'
  + ' has funded <the figure as the file writes it>".'
  + ' (c) In the chat answer, say where it comes from ("your capability statement says ...").'
  + ' Never change their word ("funded" is not "awarded" or "revenue"); never round, convert or combine a file figure with'
  + ' Mindy\'s figures.'
  + ' CONFLICTS: an official record beats the file for status (the file says "WOSB pending" and SAM shows WOSB certified: the'
  + ' report uses SAM, and the chat says to update the capability statement). An eligibility claim found only in the file'
  + ' (8(a), HUBZone, SDVOSB, WOSB, sole-source eligibility) is never pitched or used to rank; the chat says "confirm before'
  + ' using".'
  + ' Doubts about the file go in the chat answer under "Before you hand it out", never in the client document.'
  + ' A file\'s figure is never "not established": "not established" is only for Mindy\'s own inferences or third-party facts'
  + ' the data does not show, and it says what the data does NOT prove (no prime awards does not mean the firm is small or new).';

/** No data-freshness dates in what the customer reads. */
export const NO_DATA_DATES =
  'DATES: never print how current Mindy\'s data is or when a record was read ("as of", "data through", "current through",'
  + ' "record from <date>", "retrieved", "verified on", "last updated"), even when a tool result carries that date. Say what'
  + ' the record shows. When data may be behind, say so in words without a date ("recent awards may not appear yet",'
  + ' "confirm on SAM.gov before relying on it"); never drop that warning. Dates that are facts about the work stay: response deadlines,'
  + ` contract end dates, registration expiry, campaign timing, and caveats such as "${DEFENSE_LAG_LINE}, so a missing recent`
  + ' award does not mean they stopped buying".'
  + ' CONTACTS (Eric, 2026-11-27, "contacts: show notice date"): each named contact\'s "why they matter" names the source'
  + ' record and THAT record\'s own date, e.g. "primary contact on the office\'s newest notice (W91ZRS27QA001, Oct 28, 2026)",'
  + ' preferring the newest notice, with its citation marker [n]. A record\'s own date is a fact about the record, not data'
  + ' freshness. A contact found only on a notice older than 180 days gets "confirm before reaching out". Never an inferred'
  + ' email; with no supported person, give the office\'s published inbox.';

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
  '4. Who to talk to and what to say: a table (person or office, how to reach them, why they matter to this company, the one question to ask). Contracting officers from recent notices, the person who feels the problem (program, outreach or recruiting lead from an official page), the agency small business office (lookup_federal_osbp), and the office\'s published inbox when no person is named. Every named contact carries a citation marker [n] pointing to its source (the notice number or official page) in Sources, and its "why they matter" cell names that record and the record\'s own date (e.g. "primary contact on the office\'s newest notice (W91ZRS27QA001, Oct 28, 2026)"), preferring the newest notice. A contact found only on a notice older than 180 days is marked "confirm before reaching out". Never a data-freshness date. Fewer verified contacts beat a long list. Never infer an email from a name pattern; unpublished means it is left out, and say so.',
  '5. The plan, week by week: dated moves, including the events where these buyers will be (search_federal_events / get_federal_event_series, or an official event page read with read_web_page); name only events confirmed by a source, and say plainly when none are confirmed.',
  '6. What to say on every call: lead with their problem, show one real example, be local, end with what they plan to buy, when and how they will post it, and ask to be on the quote list rather than for the work.',
  '7. Emails to send: short, following OUTREACH, each naming that office\'s own past buys.',
  '8. Sources.',
].join('\n');

/** Everything above, for the prompts that need all of it. */
export const OUTREACH_AND_PLAN_RULES = [OUTREACH_RULES, '', ACTION_PLAN_STRUCTURE, '', NO_DATA_DATES].join('\n');
