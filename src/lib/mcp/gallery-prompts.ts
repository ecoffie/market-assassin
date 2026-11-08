/**
 * The prompts behind each "Mindy in your AI" gallery card. Imported ONLY by the signed-in
 * route /api/mcp/gallery/prompts, so signed-out visitors never receive them. Keep it out of
 * any client component and out of src/lib/mcp/gallery.ts.
 */
export const GALLERY_PROMPTS: Record<string, string> = {
  'capability-statement':
    'Build a one-page capability statement for my company from my SAM registration and federal award history: core competencies, differentiators, past performance, NAICS codes and certifications. [paste your UEI]',
  'money-map':
    'Show me on a map where the federal facilities maintenance work is in Florida: what is open now, what contracts are coming back up for bid, and what agencies plan to buy.',
  'where-the-money-is':
    'I run a janitorial company in Florida and want to sell to the federal government. Where is the money right now? Show me what is open, what is coming back up for bid, and what agencies plan to buy.',
  'expiring-contracts':
    'Which facilities support, grounds maintenance and HVAC contracts in Georgia and Florida end in the next 12 months? Show who holds each one now, what it is worth, and when it ends.',
  'agency-forecasts':
    'What IT services are civilian agencies planning to buy in the next 6 to 18 months? Include the agency, the expected quarter and any set-aside.',
  'matched-to-my-company':
    'Here is my UEI. Which open federal bids fit my company right now, based on my registration, certifications and past awards? [paste your UEI]',
  'meet-the-buyers':
    'What industry days, outreach events and conferences are coming up where I can meet Navy buyers in the Southeast? Include dates and whether each is in person or online.',
  'who-holds-it':
    'Who is the incumbent on this solicitation, what is the contract worth, when does it end, and what vehicle and set-aside was it awarded under? [paste the solicitation number or SAM.gov link]',
  'who-wins':
    'Who wins federal roofing work? Show the total market over the last three years, the share each top company holds, and how much went to small businesses.',
  'teaming-partners':
    'Find HUBZone small businesses in Georgia that have already won federal aircraft maintenance or logistics work. Show their certifications and how much they have won, so I can pick a teaming partner.',
  'who-buys-it':
    'Who are the contracting officers and specialists at the Army Corps of Engineers Los Angeles District who buy construction work? Include the small-business specialist.',
  'agency-priorities':
    'What is the Department of Veterans Affairs struggling with right now? Pull its priorities and problems from GAO, OIG and budget documents, and cite each source.',
  'labor-rates':
    'What does the government pay on GSA schedules for a Project Manager, Senior Software Engineer, Tier 2 Help Desk and Cyber Analyst? Give me low, median and high hourly rates.',
  'bid-no-bid':
    'Should my company bid on this? Here is our UEI and the solicitation. Give me a bid or no-bid call with the reasons for and against. [paste your UEI and the solicitation number]',
  'compliance-matrix':
    'Build a compliance matrix from this RFP. List every requirement from Sections L, M and C, and where each one should be answered in my proposal. [paste the solicitation number]',
  'proposal-draft':
    'Draft Volume I, the technical approach, for this solicitation using my company profile and past performance. Follow the page limits in Section L. [paste the solicitation number]',
  'market-report':
    'Build me a market report on federal drone spending that I can send to a client: total market, top buying agencies, top winners, the set-aside mix, and where a small business should start. Give me the share link.',
  'event-action-plan':
    'I am attending the NAVFAC Southeast industry day next week. Build me an action plan: who will be there, what they are buying, which primes and buyers I should meet, what to ask each one, and how to follow up.',
  'go-to-market':
    'I run a small janitorial company in Florida and I am new to federal contracting. Build me a go-to-market strategy: which buyer to start with and why, which set-aside gives me an edge, which contract vehicle to get on later, and a 90-day plan. [paste your UEI if you have one]',
  'whos-winning-near-me':
    'Who is winning federal contracts within 50 miles of Tampa, Florida? Show the top companies, how much each won in the last 12 months, and which agencies they won it from.',
  'teaming-plan':
    'How should my company team with Ridgeline Defense on the upcoming Robins AFB recompete? Tell me what gap I fill for them, what role and share of work to ask for, who to contact, and how to open the conversation. [paste your UEI]',
  'elevator-pitch':
    'Write me a 30-second elevator pitch for the VA facilities chief in Florida, built from the VA priorities and my past work. End with a clear ask. [paste your UEI]',
};
