/** Eric's day-plan answer rules (2026-11-28): date kinds, thin results in the lag window, channels no platform sees. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANSWER_TRUST_RULES, DATE_KIND_RULES, LAG_WINDOW_RULES, UNSEEN_CHANNELS_RULES, DEFENSE_LAG_SENTENCE } from './answer-trust-rules';
import { RESEARCH_INSTRUCTIONS } from './research-mode';
import { NO_DATA_DATES } from './outreach-rules';

describe('a. date kinds', () => {
  it('a contract end is not a recompete date; a forecast is the agency plan, not a solicitation', () => {
    expect(DATE_KIND_RULES).toMatch(/every date in an answer says what kind of date it is/);
    expect(DATE_KIND_RULES).toMatch(/Contract end date .* It is NOT a recompete or release date/);
    expect(DATE_KIND_RULES).toMatch(/Forecast date: the agency's planned quarter or date .* \(a plan, not a solicitation; plans move\)/);
    expect(DATE_KIND_RULES).toMatch(/Never write that something "comes out on", "is released on" or "opens on" a contract end date or a forecast date/);
  });
});

describe('b. thin results inside the reporting lag', () => {
  it('"not yet published", never "no award was made"; reuse lag_note; the Defense line carries its source', () => {
    expect(LAG_WINDOW_RULES).toMatch(/say the recent awards are "not yet published", never "no award was made", "they stopped buying" or "no activity"/);
    expect(LAG_WINDOW_RULES).toMatch(/Reuse the tool's lag_note in plain words/);
    expect(DEFENSE_LAG_SENTENCE).toBe('Defense awards are published on USAspending.gov with a delay of about 90 days (DoD reporting policy)');
    expect(LAG_WINDOW_RULES).toContain(`use exactly: "${DEFENSE_LAG_SENTENCE}"`);
    // Same wording as the standing no-dates rule (#2549).
    expect(NO_DATA_DATES.replace(/'\s*\+\s*'/g, '')).toContain(DEFENSE_LAG_SENTENCE);
  });
  it('no freshness dates', () => {
    expect(LAG_WINDOW_RULES).toMatch(/No data-freshness dates/);
    expect(ANSWER_TRUST_RULES).not.toMatch(/\bas of \d|data through \d/i);
  });
});

describe('c. channels no platform can see: honest, with where to go instead', () => {
  it('names each channel with why and where to go; never a Mindy gap or invented coverage', () => {
    expect(UNSEEN_CHANNELS_RULES).toMatch(/say plainly that no platform \(Mindy or any other\) shows it, why, and where to go instead\. Never call it a Mindy gap, never offer a search for it and never invent coverage/);
    expect(UNSEEN_CHANNELS_RULES).toMatch(/GSA eBuy RFQs: only GSA Schedule \(MAS\) holders can see them\. Where to go: get on the relevant GSA Schedule, or team with a current schedule holder/);
    expect(UNSEEN_CHANNELS_RULES).toMatch(/Classified and intelligence community requirements: not published, by rule \(FAR 5\.202\(a\)\(1\)/);
    expect(UNSEEN_CHANNELS_RULES).toMatch(/Consortium-managed OTA solicitations: project calls go to consortium members only\. Where to go: join the consortium .*name one only when a source in the conversation or the rules register names it as active/);
    expect(UNSEEN_CHANNELS_RULES).toMatch(/Purchase-card micro-purchases: not posted anywhere.* the buying office's award history shows what it buys small/);
  });
  it('lab/FFRDC subcontracts are not tracked; NECO is never an active channel', () => {
    expect(UNSEEN_CHANNELS_RULES).toMatch(/Mindy does not track lab subcontracting\. Name a lab's supplier portal only when a source in this conversation gives it/);
    expect(UNSEEN_CHANNELS_RULES).toMatch(/NECO .* never cite it as an active place to find Navy solicitations/);
  });
});

describe('both engines carry the rules', () => {
  it('research instructions and the standard system prompt', () => {
    expect(RESEARCH_INSTRUCTIONS).toContain(ANSWER_TRUST_RULES);
    const route = readFileSync(join(process.cwd(), 'src/app/api/app/chat/route.ts'), 'utf8');
    expect(route).toMatch(/\+ `\\n\\n\$\{COMPETITION_AND_START_PLAYBOOK\}`\n\s*\/\/ Date kinds[^\n]*\n\s*\+ `\\n\\n\$\{ANSWER_TRUST_RULES\}`/);
  });
});
