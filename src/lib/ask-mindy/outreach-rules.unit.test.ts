import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUESTION_OVER_PROFILE, NO_DATA_DATES, OUTREACH_RULES, ACTION_PLAN_STRUCTURE, OUTREACH_AND_PLAN_RULES, ATTACHED_FACTS_SOURCED } from './outreach-rules';
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
    expect(ACTION_PLAN_STRUCTURE).toMatch(/write no 'from the notice\.\.\.' prose in the table or body/);
    expect(ACTION_PLAN_STRUCTURE).toMatch(/"confirm this contact before reaching out", with no date shown/);
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
  });
  it('no freshness dates, but opportunity dates stay', () => {
    expect(NO_DATA_DATES).toMatch(/never print how current Mindy's data is/);
    expect(NO_DATA_DATES).toMatch(/response deadlines, contract end dates, registration expiry/);
    expect(NO_DATA_DATES).toMatch(/Defense awards are published on USAspending\.gov with a delay of about 90 days \(DoD reporting policy\)/);
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

describe('ATTACHED_FACTS_SOURCED (production retest 2026-11-27)', () => {
  it('a file\'s figure is sourced and attributed, never "not established"; not established stays for facts found nowhere', () => {
    expect(ATTACHED_FACTS_SOURCED).toMatch(/sourced to that file/);
    expect(ATTACHED_FACTS_SOURCED).toMatch(/State it with attribution to the company and the file/);
    expect(ATTACHED_FACTS_SOURCED).toMatch(/not independently verified/);
    expect(ATTACHED_FACTS_SOURCED).toMatch(/never "not established"/);
    expect(ATTACHED_FACTS_SOURCED).toMatch(/"Not established" is only for something that appears in no tool result, web page, customer message or attached file/);
  });
});
