# Ask Mindy Backend Spec

Nov 21, 2026 · @Eric

## Goal and how a question flows

A user types one plain sentence into Ask Mindy and gets a finished answer about their own company: the top picks, why each fits, who to contact and the next move. They should never need to know which tool to call, what a NAICS code is, or to ask a follow-up to see the results.

Today's answers fall short in four ways. They report counts and say "ask me to list them." They give generic advice ("review the opportunity, consider tracking expiring contracts"). They show unranked noise: 25 direct matches out of 719. And their suggested next questions aren't tied to the user.

Every question runs through the same seven steps in the backend:

1. **Load the user profile** from the Vault: company, codes, certifications, location, past performance (section 3).
2. **Classify the question** into one of the recipes (section 5). If none fits, use the general research recipe.
3. **Run the recipe's tool sequence**, in parallel where the calls don't depend on each other.
4. **Score and rank** every result against the profile (section 4). Drop anything below the cutoff.
5. **Check sources.** Every fact in the answer must trace to a tool result. Remove anything that doesn't.
6. **Write the answer** in the fixed format (section 8), under the rules layer (section 2).
7. **Generate next-step buttons** from the actual results, not generic prompts.

## Rules layer: Ask Mindy system instructions

This is Ask Mindy's CLAUDE.md. It loads before every answer, in every recipe. Paste it as the system instructions and keep it under two pages.

```markdown
You are Mindy, a federal market intelligence analyst working for the user's company.

WHO YOU WORK FOR
- The user's company profile is loaded above. Every answer is about what THIS company can win.
- Never ask for information already in the profile. Ask at most one question, only when the answer changes the result.

TRUTH
- Every fact, number, name and date comes from a tool result in this turn. If no tool returned it, do not say it.
- An empty answer beats a wrong one. Say "I could not find that" and what you checked.
- Give a clear read with its conditions ("Worth pursuing if you can staff it by March"), not a hedge.
- Never promise wins, revenue or award dates.
- Statements the user makes about their own company stand as given.

ANSWER SHAPE
- First sentence = the answer.
- Show the top 3 to 5 results, ranked by fit score, each with one line on why it fits this company.
- Never report a count and then say "ask me to list them." Show the best ones.
- Never show a result scored below the cutoff.
- Frame the answer as pathways: the route into the buyer (vehicle, set-aside, office, prime, event), with contracts as examples.
- Include the buyer's pain point when a sourced GAO or Inspector General finding exists.
- Name a real person or office to contact when a tool returned one.
- End with the single best next move.

RULES OF THE TRADE
- Department of War buyers: say which Portfolio Acquisition Executive owns the work, and why that route is shorter than the old program office structure.
- Low federal prime totals do not mean a small company. Mention subcontract, joint venture and commercial work before judging size.
- A forecast is a plan, not a posted solicitation. Say so when you show one.
- An award the company held as a subcontractor is never called a prime.

WRITING
- Plain words. Spell out names before abbreviations. No em dashes. Short sentences.
- No filler, no restating the question, no "here's what I found."
- Never mention other GovCon data platforms. Cite primary sources (SAM.gov, USASpending, GAO, agency pages).
```

## User profile: loaded before every answer

The profile is built once at signup from a UEI or website and refreshed weekly. It is what turns "find me work" into "work this company can win." If a user has no profile, the first recipe Ask Mindy runs is Profile Setup (section 5).

| Field | Source | Used for |
| --- | --- | --- |
| Legal name, UEI, CAGE, address | SAM.gov (lookup_sam_entity) | Identity, location scoring |
| NAICS codes and size under each | SAM.gov | NAICS fit, eligibility |
| Service codes (PSC) | SAM.gov | Matching notices tagged by service code |
| Certifications: 8(a), HUBZone, WOSB, SDVOSB, VOSB, with dates and self-reported vs SBA-certified | SAM.gov plus SBA certification search | Set-aside eligibility |
| Owner and contacts | SAM.gov and SBA profile | Drafts and outreach |
| Capabilities narrative and keywords | SBA Small Business Search profile | Keyword matching, readiness check |
| Past performance (prime, sub, commercial, state and local) | Federal award data, SBA profile, user uploads to the Vault | Relevance, "Lunacon rule" |
| Contract vehicles held (GSA Schedule, OASIS+, IDIQs) | Federal award data, user entry | Pathway scoring |
| Target buyers and regions | User entry, inferred from past work | Ranking, alerts |
| Pursuits and watchlist | User actions in the app | Avoid repeats, track status |
| Capability statement and documents | Vault uploads | Drafting responses |

**Rule:** a field the backend could not fill is marked unknown, never guessed. Show the user what is missing once, on the profile page, not inside every answer.

## Fit scoring: rank, don't match

Every opportunity, contract coming back and forecast gets a 0 to 100 fit score for this company. Only results scoring 60 or higher are shown. Results from 40 to 59 are kept as "related" and shown only when the user asks for more. This replaces the DIRECT_MATCH label, which today passes food carts as transport matches.

**Step 1: eligibility gate (pass or route).** If the set-aside does not match the company's certifications, or the company is not small under the notice's NAICS code, the result is not dropped. It is relabeled "subcontract route" and scored for teaming instead.

**Step 2: score.** These are starting weights. Tune them against the test set (section 9).

| Factor | Points | How it is scored |
| --- | --- | --- |
| Capability match | 30 | NAICS or PSC exact match to the profile 30; same industry family 15; text match only 5. The title or description must contain the query's concepts, not just one generic word |
| Past performance relevance | 15 | Same buyer 15; same agency 10; same type of work for anyone, including commercial 7 |
| Timing | 15 | Open with 10 or more days left 15; open with under 10 days 8; coming back in 6 to 18 months 12; forecast 8 |
| Competition | 10 | Set aside for a certification the company holds 10; small business set-aside 7; full and open 4; incumbent holds an 8(a) sole source 2 |
| Size fit | 10 | Value within 0.5x to 3x the company's largest past award 10; up to 10x 5; beyond that 2 |
| Location | 10 | Same state or within 150 miles 10; same region 6; nationwide or remote 6; elsewhere 2 |
| Pathway access | 10 | Company holds the vehicle 10; vehicle open to new bidders 6; closed vehicle, sub route only 2 |

**Every shown result carries its top two reasons in plain words**, for example: "Matches your wheelchair transport work and is set aside for small business." The user sees why, not a number.

## Skills: the recipes behind each question

Each skill is a fixed recipe: the backend recognizes the kind of question, runs a set tool sequence, and fills a template. These are the workflows run by hand dozens of times in client work this fall. Tool names are Mindy's existing MCP tools; tools marked NEW are in section 6.

| # | Skill | The user types | Tool sequence | What comes back | Priority |
| --- | --- | --- | --- | --- | --- |
| 1 | Where to start (market map) | "What should I go after?" · "Where's the money for us?" | profile → find_opportunities (UEI-anchored) + get_expiring_contracts (profile NAICS, region) + get_agency_forecasts → get_agency_intel (sourced items only) → search_contractors → fit score | Top 5 pathways, each with a pick, why it fits, the buyer's pain point and the next move. Report button = full market map PDF | High |
| 2 | Profile setup and readiness | "Here's my website" · a UEI · first login | lookup_sam_entity → SBA profile lookup (NEW) → get_contractor_award_history → derive_company_keywords | Saved profile plus a readiness checklist: contacts, SBA keywords, service codes, website | High |
| 3 | Opportunity deep dive | "Tell me about 36C25027R5412" · clicks a map pin | lookup_solicitation → get_solicitation_documents → get_solicitation_incumbent or find_predecessor_award → understand_customer → evaluate_bid_decision | Pursue or pass with conditions, incumbent and price history, what the buyer cares about, the question to ask the contracting officer | High |
| 4 | Event plan | "I'm going to NVSBE" · an event link | event agenda reader (NEW) → search_federal_events → find_opportunities for each attending agency → lookup_federal_osbp + get_sblo_contact | Gold Coast-format plan: deadline box, pitch, named people with titles and the question for each, labeled Report by Mindy AI | High |
| 5 | Buyer brief | "Tell me about the Coast Guard" | get_agency_intel (sourced only) → get_agency_spending_detail → get_agency_forecasts → lookup_federal_osbp → PAE structure feed (NEW, Department of War only) | Pain points with citations, who buys what, set-aside share, small business office contact, PAE owner | High |
| 6 | Teaming finder | "Who should I team with on this?" | get_solicitation_incumbent → find_capable_contractors → search_contractors → get_sblo_contact (UEI-matched) | Ranked partners: incumbent, likely primes, complementary small firms, each with the question to ask | Medium |
| 7 | Sources sought response | "Help me answer this RFI" | lookup_solicitation → get_solicitation_documents → extract_compliance_matrix → profile past performance → draft_proposal_section | A draft response mapped to each question, for the user to review | Medium |
| 8 | Price check | "What should I charge for a General Clerk II?" | get_pricing_intel → wage determination lookup (NEW) | Rate table: aggressive, competitive, premium, plus the wage floor | Medium |
| 9 | Outreach draft | "Draft an email to the small business office" | profile → contact from the last answer → rules layer writing style | Short email naming the specific buy, never sent automatically | Medium |
| 10 | General research | Anything that fits no recipe | find_opportunities → the tools its result points to | Same answer format; logged so new recipes can be built from repeat questions | Low |

**Routing rule:** classify on intent, not keywords. When two recipes fit, run the one whose output answers the literal question and offer the other as a next-step button.

## Tools: what to add or fix

The recipes are only as good as the tools under them. The full list of 21 fixes, with evidence, is in the [Mindy MCP Fix List](https://claude.ai/artifact/7UbFPzuVaXtLq4QVCxGbR8). These are the ones the recipes depend on.

| Tool | Add or fix | What it must do | Recipes it unblocks | Priority |
| --- | --- | --- | --- | --- |
| Fit scorer | Add | Score every result 0 to 100 against the profile (section 4); return the top reasons in plain words | All | High |
| find_opportunities | Fix | Stop labeling single-word matches as direct; require the query's concepts in the title or description; fall back to the profile's NAICS when the text match is empty | 1, 3, 4, 10 | High |
| SBA profile lookup | Add | By UEI: owner, narrative, keywords, past performance, certification dates | 2, every profile | High |
| lookup_sam_entity | Fix | Retry live SAM.gov before using the mirror; refresh the mirror weekly; carry service codes and contact names | 2, all | High |
| get_agency_intel | Fix | Return only sourced GAO and Inspector General items, with report number and date | 1, 5 | High |
| Event agenda reader | Add | Take an event URL; return sessions, times, rooms, speakers with titles, and matchmaking agencies as rows | 4 | High |
| get_sblo_contact and search_federal_contacts | Fix | Match on UEI and valid office codes; return nothing rather than another company's contact | 4, 5, 6 | High |
| Result size limits | Fix | Default to a summary plus the top 25 rows; page the rest. get_expiring_contracts and search_federal_events now return 75,000 to 285,000 characters | All | High |
| search_federal_events | Fix | Keep past events with their real dates, labeled "held"; never delete real events; separate attendable events from RFIs | 4 | High |
| PAE structure feed | Add | A maintained table: portfolio, leader, programs, small business lead | 1, 5 | Medium |
| Wage determination lookup | Add | Service Contract Act rates by county and labor category | 8 | Medium |
| search_grants | Fix | Rank by grant title and assistance listing; include forecasted programs | 1 | Medium |
| get_agency_forecasts | Fix | Refresh DOT (109 days old); add DLA and NGA or state plainly that coverage doesn't exist | 1, 5 | Medium |

## Agents: what runs on its own

Skills answer when the user asks. Agents run without being asked and bring the result to the user. Each one reuses the recipes above, so there is one set of logic to maintain.

| Agent | Trigger | What it does | What the user sees | Priority |
| --- | --- | --- | --- | --- |
| Profile builder | Signup, or weekly refresh | Runs Profile Setup; flags changes (SAM.gov expiring, new certification, new award) | A complete profile without filling out a form; a note when something changes | High |
| Weekly opportunity brief | Every Monday | Runs Where to Start against new notices, contracts coming back and forecasts since last week; scores them; keeps only 60 and above | An email and in-app brief: the 3 to 5 best new picks, each with why and the next move | High |
| Event prep | An event the user saved or an agency event within 30 days | Runs Event Plan; after the event, drafts follow-ups from the user's notes | The plan a week before; follow-up drafts the day after | High |
| Pursuit watcher | User saves a pursuit | Watches for amendments, Q&A, deadline changes, award notices, incumbent changes | An alert only when something changed, with what to do about it | Medium |
| Batch market maps | A consultant or counselor uploads a client list | Runs Where to Start for each client in parallel; holds every report for review | Finished reports, one per client, overnight | Medium |
| Quality monitor | Every Ask Mindy answer | Logs empty, oversized or low-scoring results and answers with unsourced facts; groups them weekly | An internal weekly fix list for the Mindy team, never shown to users | Medium |

**Guardrail for every agent:** nothing is sent outside the app or to another person without the user approving it. Agents draft; users send.

## Answer format and next-step buttons

Every answer, in every recipe, uses the same shape. The Report button turns the same content into the full branded PDF.

```markdown
[One sentence: the answer, with the number that matters.]

TOP PICKS (ranked by fit for [Company])
1. [Title], [Buyer], [value], [open until / ends / forecast quarter]
   Why it fits: [top reason]; [second reason].
   Pathway: [set-aside / vehicle / sub to incumbent / event].
2. ...
3. ...

WHAT THE BUYER IS DEALING WITH
[One sourced pain point, with GAO or IG report number and date.]

WHO TO CONTACT
[Named person or office, title, and the exact question to ask.]

NEXT MOVE
[The single most useful action this week.]
```

**Next-step buttons are written from the results, never from a fixed list.** Three buttons, each naming a specific item from the answer:

| Today | Instead |
| --- | --- |
| "Find open opportunities at Department of Defense" | "Build my plan for the Army small business day on December 9" |
| "Who is the incumbent for 140P1326P0024?" | "Who holds the Access Road Repair contract now, and do they subcontract?" |
| "Draft outreach email to Ranco Construction INC" | "Draft a capability email to the contracting officer for pick #1" |

The right column shows the pattern. The backend fills it with real items from each answer.

**Banned in answers:** "ask me to list them," a count without the top results, generic advice that would fit any company, and next steps that send the user to another tool or website.

## Test set and build order

**The test set** is how you know a backend change made Ask Mindy better, not just different. Build 100 to 200 real questions from this fall's client work, each with the company profile it was asked for and what a great answer contains. Every change runs against the full set before release.

| Field | Example |
| --- | --- |
| Question | "What should we go after?" |
| Company profile | Superb Staffing Solutions, Memphis, NAICS 561320, GSA offer in process |
| Must include | Tennessee staffing contracts coming back (Fort Campbell clerks, Memphis VA lab staffing); GSA Schedule as the pathway; a sourced pain point |
| Must not include | Construction notices; unsourced claims; "ask me to list them" |
| Score | Pass or fail on each line, plus a 1 to 5 grade for usefulness |

The client reports already built cover about 25 companies across staffing, construction, IT, healthcare transport and consulting. That is a ready-made starting set.

**Build order**

1. **Week 1: rules layer and answer format.** Paste the system instructions (section 2) and the answer template (section 8). Fastest change with the most visible lift.
2. **Weeks 1 to 2: tool fixes.** find_opportunities relevance, result size limits, lookup_sam_entity reliability, sourced-only agency intel, and keeping past events with real dates.
3. **Weeks 2 to 3: profile and fit scorer.** Auto-load the profile from the Vault; score and rank every result.
4. **Weeks 3 to 4: first three skills.** Where to start, Opportunity deep dive, Profile setup.
5. **Month 2: Event plan and Buyer brief skills, plus the event agenda reader and SBA profile lookup.**
6. **Month 2: Weekly opportunity brief agent.** It reuses the Where to start skill, so it is mostly scheduling.
7. **Ongoing: test set** grows with every new question type users ask.
