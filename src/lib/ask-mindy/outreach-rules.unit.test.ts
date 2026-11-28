import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUESTION_OVER_PROFILE, NO_DATA_DATES, OUTREACH_RULES, ACTION_PLAN_STRUCTURE, OUTREACH_AND_PLAN_RULES, ATTACHED_FACTS_SOURCED, DEFENSE_LAG_LINE } from './outreach-rules';
import { RESEARCH_INSTRUCTIONS, researchSystemDynamic } from './research-mode';
import { CREATE_DOCUMENT_TOOL_DEF } from '@/lib/chat/generate-document-tool';

const ALL = [QUESTION_OVER_PROFILE, NO_DATA_DATES, OUTREACH_AND_PLAN_RULES].join('\n');

describe('outreach rules (Eric\'s method, 2026-11-27)', () => {
  it('rule 0 and 1: the first sentence is about the buyer and names their own buy', () => {
    expect(OUTREACH_RULES).toMatch(/the first sentence is about the BUYER, not the company/);
    expect(OUTREACH_RULES).toMatch(/1\. Lead with their buy, by name: the specific requirement, who won it, the amounts and the end date/);
  });
  it('rule 2: a cited pain point turned into what the company delivers; never "you have a problem"; uncited = not used', () => {
    expect(OUTREACH_RULES).toMatch(/2\. The pain point is a reason, not a lecture: take it from a cited source/);
    expect(OUTREACH_RULES).toMatch(/Never tell a buyer they have a problem/);
    expect(OUTREACH_RULES).toMatch(/An uncited pain point is a hypothesis and is not used/);
  });
  it('rule 3: one real proof point; [brackets] when the number is unknown; never an invented metric', () => {
    expect(OUTREACH_RULES).toMatch(/3\. One proof point/);
    expect(OUTREACH_RULES).toMatch(/leave \[brackets\]/);
    expect(OUTREACH_RULES).toMatch(/Never invent a metric/);
  });
  it('rule 4: two reply-sized questions; never asking for the work on the first call', () => {
    expect(OUTREACH_RULES).toMatch(/4\. A small, specific ask: two reply-sized questions/);
    expect(OUTREACH_RULES).toMatch(/never asking for the work on the first call/);
  });
  it('rule 5: credentials last under the signature; never open with a certification', () => {
    expect(OUTREACH_RULES).toMatch(/5\. Credentials last, in a block under the signature: legal name, UEI, CAGE, certifications, NAICS/);
    expect(OUTREACH_RULES).toMatch(/never open with "We are a \[certification\] firm"/);
  });
  it('rule 6: under 150 words, no em dashes, local; plus "Before you send" and the closing line', () => {
    expect(OUTREACH_RULES).toMatch(/6\. Short, plain and local: under 150 words, no em dashes/);
    expect(OUTREACH_RULES).toMatch(/"Before you send": renew SAM if it expires soon/);
    expect(OUTREACH_RULES).toMatch(/Every fact in this script comes from Mindy's data, except the bracketed results/);
  });
  it('the rules practice what they preach: no em dashes, and no reference-case names', () => {
    expect(ALL).not.toMatch(/—/);
    expect(ALL).not.toMatch(/\bEFS\b|Norwich|Colon|Connecticut|Coast Guard Academy|Jobelephant|X6PKH4P1T124/i);
  });
});

describe('action plan structure (the Claude + Mindy MCP reference plan)', () => {
  it('has the eight sections in order', () => {
    const order = ['Dates that matter', 'The pitch in three lines', 'Who buys this work here', 'Who to talk to and what to say', 'The plan, week by week', 'What to say on every call', 'Emails to send', '8. Sources'];
    let at = -1;
    for (const h of order) { const i = ACTION_PLAN_STRUCTURE.indexOf(h); expect(i, h).toBeGreaterThan(at); at = i; }
  });
  it('no certification in the pitch; contacts are sourced, never inferred; only confirmed events', () => {
    expect(ACTION_PLAN_STRUCTURE).toMatch(/No certification in the pitch/);
    expect(ACTION_PLAN_STRUCTURE).toMatch(/Every named contact carries a citation marker \[n\] pointing to its source \(the notice number or official page\) in Sources/);
    // Eric, 2026-11-27 ("contacts: show notice date"): the record and ITS own date, newest notice first.
    expect(ACTION_PLAN_STRUCTURE).toMatch(/its "why they matter" cell names that record and the record's own date \(e\.g\. "primary contact on the office's newest notice \(W91ZRS27QA001, Oct 28, 2026\)"\), preferring the newest notice/);
    expect(ACTION_PLAN_STRUCTURE).toMatch(/A contact found only on a notice older than 180 days is marked "confirm before reaching out"\. Never a data-freshness date\./);
    expect(ACTION_PLAN_STRUCTURE).toMatch(/Never infer an email from a name pattern/);
    expect(ACTION_PLAN_STRUCTURE).not.toMatch(/says where it came from/);
    expect(ACTION_PLAN_STRUCTURE).toMatch(/Never infer an email from a name pattern/);
    expect(ACTION_PLAN_STRUCTURE).toMatch(/name only events confirmed by a source, and say plainly when none are confirmed/);
    expect(ACTION_PLAN_STRUCTURE).toMatch(/search_federal_events \/ get_federal_event_series/);
    expect(ACTION_PLAN_STRUCTURE).toMatch(/lookup_federal_osbp/);
  });
});

describe('question over profile, and no data dates', () => {
  it('the question overrides the saved profile; a different business means the profile is not used or mentioned', () => {
    expect(QUESTION_OVER_PROFILE).toMatch(/override the saved profile/);
    expect(QUESTION_OVER_PROFILE).toMatch(/Use the profile only to fill what the question leaves out/);
    expect(QUESTION_OVER_PROFILE).toMatch(/do not use the profile at all and do not mention it in the answer body/);
    // 2026-11-27 dry run: an attached capability statement is the customer's words in BOTH engines (standard chat
    // gets this through userProfileBlock; research through RESEARCH_INSTRUCTIONS and ATTACHED_FILES_RULE).
    expect(QUESTION_OVER_PROFILE).toMatch(/A FILE THE CUSTOMER ATTACHED counts as their words: .* research THAT company, not the saved profile/);
  });
  it('no freshness dates, but opportunity dates stay', () => {
    expect(NO_DATA_DATES).toMatch(/never print how current Mindy's data is/);
    expect(NO_DATA_DATES).toMatch(/response deadlines, contract end dates, registration expiry/);
    expect(NO_DATA_DATES).toContain(DEFENSE_LAG_LINE); // the one sourced wording (Eric, 2026-11-28)
  });
});

describe('every surface carries the rules', () => {
  it('research mode: instructions include them; the saved-profile header points at the override', () => {
    expect(RESEARCH_INSTRUCTIONS).toContain(QUESTION_OVER_PROFILE);
    expect(RESEARCH_INSTRUCTIONS).toContain(OUTREACH_AND_PLAN_RULES);
    expect(researchSystemDynamic({ today: '2026-11-27', profileBlock: 'Company: X' })).toMatch(/the question overrides it/);
  });
  it('standard Ask Mindy: the system prompt template carries them and a saved profile always comes with the override', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/app/chat/route.ts'), 'utf8');
    expect(src).toMatch(/\$\{OUTREACH_AND_PLAN_RULES\}\n\nUSER PROFILE/);
    expect(src).toMatch(/const userProfileBlock = profileText \+ \(profileText\.trim\(\) \? `\\n\\n\$\{QUESTION_OVER_PROFILE\}` : ''\)/);
  });
  it('create_document: outreach, action-plan sections and the no-dates rule', () => {
    const d = CREATE_DOCUMENT_TOOL_DEF.function.description as string;
    expect(d).toMatch(/OUTREACH AND ACTION PLANS: a script, email or 'what to say' opens with the buyer's own buy/);
    expect(d).toMatch(/credentials \(UEI, CAGE, certifications, NAICS\) last, under the signature/);
    expect(d).toMatch(/Dates that matter \(opportunity dates only\), The pitch in three lines/);
    expect(d).toMatch(/DATES: no data-freshness dates/);
    expect(d).toMatch(/every named contact cites its source with the citation marker/);
    expect(d).toMatch(/no 'from the notice\.\.\.' prose in the table or body/);
  });
});

describe('ATTACHED_FACTS_SOURCED: claims by audience (Eric, 2026-11-27, from the Claude + Mindy MCP baseline)', () => {
  it('sourced to the file and cited; never "not established"', () => {
    expect(ATTACHED_FACTS_SOURCED).toMatch(/FACTS FROM AN ATTACHED FILE ARE SOURCED to that file: cite the file/);
    expect(ATTACHED_FACTS_SOURCED).toMatch(/A file's figure is never "not established"/);
  });
  it('a document FOR the company states its claims as written, with no attribution words and no Unverified label', () => {
    expect(ATTACHED_FACTS_SOURCED).toMatch(/In a document prepared FOR that company \(its report, capability statement, leave-behind\), state its own claims AS WRITTEN: no "<Company> states", no brackets, no "reportedly", and never an "Unverified" label/);
  });
  it('third-party content attributes in plain words; the chat says where it comes from', () => {
    expect(ATTACHED_FACTS_SOURCED).toMatch(/addressed to a third party \(an outreach email, a teaming note\), attribute in plain words: "<Company> has funded/);
    expect(ATTACHED_FACTS_SOURCED).toMatch(/In the chat answer, say where it comes from \("your capability statement says \.\.\."\)/);
  });
  it('word preservation: same word, never rounded, converted or combined with Mindy figures', () => {
    expect(ATTACHED_FACTS_SOURCED).toMatch(/Never change their word \("funded" is not "awarded" or "revenue"\); never round, convert or combine a file figure with Mindy's figures/);
  });
  it('conflicts: SAM beats the file on status; a file-only eligibility claim is never pitched and is flagged in chat', () => {
    expect(ATTACHED_FACTS_SOURCED).toMatch(/an official record beats the file for status \(the file says "WOSB pending" and SAM shows WOSB certified: the report uses SAM, and the chat says to update the capability statement\)/);
    expect(ATTACHED_FACTS_SOURCED).toMatch(/An eligibility claim found only in the file \(8\(a\), HUBZone, SDVOSB, WOSB, sole-source eligibility\) is never pitched or used to rank; the chat says "confirm before using"/);
    expect(ATTACHED_FACTS_SOURCED).toMatch(/Doubts about the file go in the chat answer under "Before you hand it out", never in the client document/);
  });
  it('"not established" is only for Mindy\'s inferences or unshown third-party facts, and says what the data does not prove', () => {
    expect(ATTACHED_FACTS_SOURCED).toMatch(/"not established" is only for Mindy's own inferences or third-party facts the data does not show, and it says what the data does NOT prove \(no prime awards does not mean the firm is small or new\)/);
  });
  it('create_document carries the same audience rule and the SAM/eligibility conflict rule', async () => {
    const { CREATE_DOCUMENT_TOOL_DEF } = await import('@/lib/chat/generate-document-tool');
    const d = JSON.stringify(CREATE_DOCUMENT_TOOL_DEF);
    expect(d).toMatch(/written AS THE FILE STATES THEM: no .*<Company> states.*, no brackets, no .*reportedly.*, same word/);
    expect(d).toMatch(/SAM beats the file on status; an eligibility claim only the file makes \(8\(a\), HUBZone, SDVOSB, WOSB\) is left out of the document and flagged in the chat answer/);
    expect(d).toMatch(/primary contact on the office's newest notice \(W91ZRS27QA001, Oct 28, 2026\)/);
  });
});
