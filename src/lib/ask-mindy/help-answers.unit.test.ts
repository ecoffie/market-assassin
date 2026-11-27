/**
 * Help answers (beta). The 15 fixture questions are PARAPHRASES of the kinds of how-to questions customers ask (no
 * customer's own text). Each routes to the right entry; ordinary research questions never match; the answers carry
 * no podcast, episode or course text, no invented thresholds or dollar figures, no dates and no em dashes; and every
 * route an answer names exists under src/app.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HELP_ENTRIES, helpAnswerFor, helpAnswersEnabledFor, HELP_BETA_NOTE } from './help-answers';
import { matchHelpIntent, type HelpIntentId } from './help-match';

const FIXTURES: Array<[string, HelpIntentId]> = [
  // Product
  ['How do I find contracts in here?', 'find_contracts'],
  ['How can I pull bids off the map?', 'pull_bids_from_map'],
  ['How do I make a top 25 list of targets?', 'build_shortlist'],
  ['Where do I upload my capability statement?', 'upload_capability_statement'],
  ['How do I find upcoming agency events?', 'find_events'],
  ['How do I connect Mindy to ChatGPT?', 'connect_chatgpt'],
  ['How do I cancel my subscription?', 'cancel_subscription'],
  // GovCon basics
  ['How do I write a capability statement?', 'write_capability_statement'],
  ['What is a set-aside?', 'set_asides'],
  ['What does socially and economically disadvantaged mean?', 'disadvantaged_meaning'],
  ['How do I get a veteran small business certification?', 'certifications'],
  ['How do I get certified as a small business?', 'certifications'],
  ['How do I go after my first federal contract?', 'first_bid'],
  ['How should I pursue this opportunity?', 'first_bid'],
  ['Can you help me write a proposal?', 'write_proposal'],
];

const NOT_HELP = [
  'Find me cybersecurity work in Florida',
  'Who buys roofing in Texas?',
  'Give me a full assessment of Ridgeline Digital.',
  'What opportunities are available for janitorial services at the VA?',
  'Which contracts expire next year at the Navy?',
  'Show me set-aside construction work in Georgia',
  'Research EFS Digital',
  '',
];

describe('help-match: routing', () => {
  it.each(FIXTURES)('%s routes to %s', (q, id) => {
    expect(matchHelpIntent(q)).toBe(id);
  });

  it('covers every entry in the register', () => {
    const routed = new Set(FIXTURES.map(([, id]) => id));
    for (const id of Object.keys(HELP_ENTRIES)) expect(routed.has(id as HelpIntentId)).toBe(true);
  });

  it.each(NOT_HELP)('research or search request "%s" is not a help question', (q) => {
    expect(matchHelpIntent(q)).toBeNull();
  });

  it('"pursue this" with an opportunity attached goes to the full answer, not the generic playbook', () => {
    expect(matchHelpIntent('How should I pursue this opportunity?', { hasAttachedOpportunity: true })).toBeNull();
    expect(matchHelpIntent('How do I cancel my subscription?', { hasAttachedOpportunity: true })).toBe('cancel_subscription');
  });

  it('a very long message is never treated as a help question', () => {
    expect(matchHelpIntent(`How do I find contracts? ${'x '.repeat(300)}`)).toBeNull();
  });
});

const ALL = Object.values(HELP_ENTRIES);

describe('help-answers: content rules', () => {
  it.each(ALL.map((e) => [e.id, e] as const))('%s: no podcast, episode, course or corpus text', (_id, e) => {
    expect(e.answer).not.toMatch(/podcast|episode|our course|course|lesson|curriculum|webinar|govcon giants/i);
  });

  it.each(ALL.map((e) => [e.id, e] as const))('%s: no invented thresholds, dollar figures or dates', (_id, e) => {
    expect(e.answer).not.toMatch(/\$|dollars?\b|million|billion|threshold/i);
    expect(e.answer).not.toMatch(/\b(19|20)\d\d\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d/i);
    // The only figures allowed: step numbers, the SBA-quoted 51% (8(a) entry), "13 CFR Part 124", the quoted "top 25".
    const figures = e.answer
      .replace(/^\d+\. /gm, '')
      .replace(/8\(a\)/g, '')
      .replace(/13 CFR Part 124/g, '')
      .replace(/"top 25"/g, '')
      .match(/\d[\d,.%]*/g) || [];
    if (e.id === 'disadvantaged_meaning') expect(figures).toEqual(['51%']);
    else expect(figures).toEqual([]);
  });

  it('a quoted figure is attributed to its official source in the same answer', () => {
    const e = HELP_ENTRIES.disadvantaged_meaning;
    expect(e.answer).toMatch(/SBA describes 8\(a\) firms as at least 51%/);
    expect(e.sources?.some((s) => s.startsWith('https://www.sba.gov/'))).toBe(true);
  });

  it.each(ALL.map((e) => [e.id, e] as const))('%s: no em or en dashes, 3 to 6 steps (cancel: one step, no maze)', (_id, e) => {
    expect(e.answer).not.toMatch(/[–—]/);
    const n = (e.answer.match(/^\d+\. /gm) || []).length;
    if (e.id === 'cancel_subscription') { expect(n).toBe(0); expect(e.answer.length).toBeLessThan(400); return; }
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(6);
  });

  it('basics entries that state a rule cite an official source (SBA, eCFR, acquisition.gov)', () => {
    for (const id of ['set_asides', 'disadvantaged_meaning', 'certifications'] as const) {
      const src = HELP_ENTRIES[id].sources || [];
      expect(src.length).toBeGreaterThan(0);
      for (const s of src) expect(s).toMatch(/^https:\/\/(www\.sba\.gov|certifications\.sba\.gov|www\.ecfr\.gov|www\.acquisition\.gov)\//);
      expect(HELP_ENTRIES[id].answer).toMatch(/Sources?: /);
    }
  });

  it('the capability statement playbook ends with an offer to draft from the Vault (create_document)', () => {
    const e = HELP_ENTRIES.write_capability_statement;
    expect(e.offer).toEqual({ kind: 'tool', name: 'create_document' });
    expect(e.answer.trim().split('\n').pop()).toMatch(/Want me to draft it now\?$/);
  });

  it('the proposal entry offers draft_proposal; cancel names the real billing control', () => {
    expect(HELP_ENTRIES.write_proposal.offer?.name).toBe('draft_proposal');
    expect(HELP_ENTRIES.cancel_subscription.answer).toContain('**Manage / cancel**');
    expect(HELP_ENTRIES.cancel_subscription.answer).toContain('(https://getmindy.ai/account/cancel)');
    expect(HELP_ENTRIES.cancel_subscription.answer).toContain('**Manage or cancel subscription**');
  });
});

/** Turn an in-app path into the src/app directory that serves it. */
function appDirFor(path: string): string {
  const clean = path.split(/[?#]/)[0].replace(/^\//, '');
  return join(process.cwd(), 'src', 'app', clean);
}
const servesRoute = (dir: string) => ['page.tsx', 'page.ts', 'route.ts', 'route.tsx'].some((f) => existsSync(join(dir, f)));

describe('help-answers: every route exists', () => {
  const linked = ALL.flatMap((e) => [...e.routes, ...[...e.answer.matchAll(/\]\(https:\/\/getmindy\.ai([^)]+)\)/g)].map((m) => m[1])]);

  it.each([...new Set(linked)])('%s is served by src/app', (path) => {
    expect(servesRoute(appDirFor(path))).toBe(true);
  });

  it('every in-answer link is an absolute getmindy.ai link (safe-markdown renders only absolute http(s) links)', () => {
    for (const e of ALL) {
      for (const m of e.answer.matchAll(/\]\(([^)]+)\)/g)) expect(m[1]).toMatch(/^https:\/\/getmindy\.ai\//);
    }
  });

  it('/app panel links name panels the app renders', async () => {
    const { readFileSync } = await import('node:fs');
    const panels = readFileSync(join(process.cwd(), 'src/components/app/panels/index.tsx'), 'utf8');
    for (const e of ALL) {
      for (const m of e.answer.matchAll(/\/app\?panel=([a-z-]+)/g)) expect(panels).toContain(`'${m[1]}'`);
    }
  });
});

describe('helpAnswerFor + flag', () => {
  it('returns the entry with the beta note; the app action offer only when actions are enabled', () => {
    const off = helpAnswerFor('How can I pull bids off the map?');
    expect(off?.id).toBe('pull_bids_from_map');
    expect(off?.text.endsWith(HELP_BETA_NOTE)).toBe(true);
    expect(off?.text).not.toMatch(/Want me to do it\?/);
    expect(off?.offer).toBeUndefined();
    const on = helpAnswerFor('How can I pull bids off the map?', { actionsEnabled: true });
    expect(on?.text).toMatch(/Want me to do it\?/);
    expect(on?.offer?.name).toBe('map.apply_view');
  });

  it('a research question gets no help answer', () => {
    expect(helpAnswerFor('Find me cybersecurity work in Florida')).toBeNull();
  });

  it('flag: default off; on only for the allowlist or *', () => {
    expect(helpAnswersEnabledFor('a@example.com', {})).toBe(false);
    expect(helpAnswersEnabledFor('a@example.com', { ASK_MINDY_HELP_ANSWERS: 'true' })).toBe(false);
    expect(helpAnswersEnabledFor('A@example.com', { ASK_MINDY_HELP_ANSWERS: 'true', ASK_MINDY_HELP_ANSWERS_ALLOWLIST: 'a@example.com' })).toBe(true);
    expect(helpAnswersEnabledFor('b@example.com', { ASK_MINDY_HELP_ANSWERS: 'true', ASK_MINDY_HELP_ANSWERS_ALLOWLIST: '*' })).toBe(true);
    expect(helpAnswersEnabledFor(null, { ASK_MINDY_HELP_ANSWERS: 'true', ASK_MINDY_HELP_ANSWERS_ALLOWLIST: '*' })).toBe(false);
  });
});

describe('capability statement: one answer, always the draft offer', () => {
  // Five paraphrased ways of asking the same thing. Each must get the SAME playbook.
  const VARIANTS = [
    'How do I write a capability statement?',
    'What should my capability statement include?',
    'I need a capability statement',
    'Do you have a capability statement template?',
    'Can you help me create a cap statement?',
  ];

  it.each(VARIANTS)('"%s" routes to the capability statement playbook', (q) => {
    expect(matchHelpIntent(q)).toBe('write_capability_statement');
  });

  it('every variant gets the identical answer', () => {
    const texts = new Set(VARIANTS.map((q) => helpAnswerFor(q)?.text));
    expect(texts.size).toBe(1);
  });

  it('never says DUNS (retired; it is the UEI) and names the UEI', () => {
    expect(HELP_ENTRIES.write_capability_statement.answer).toContain('UEI');
    for (const e of ALL) expect(e.answer).not.toMatch(/\bduns\b/i);
  });

  it('always offers to draft it now from what Mindy already has, and never deflects to a solicitation', () => {
    const a = HELP_ENTRIES.write_capability_statement.answer;
    expect(a).toMatch(/I can draft yours now/);
    expect(a).toMatch(/SAM\.gov registration/);
    expect(a).toMatch(/You do not need a solicitation/);
    expect(a).not.toMatch(/give me (a|the) solicitation|solicitation (id|number)|I don.t have a (capability.statement )?template/i);
    expect(HELP_ENTRIES.write_capability_statement.offer?.name).toBe('create_document');
  });

  it('an imperative request goes straight to drafting, not to the playbook', () => {
    expect(matchHelpIntent('Write my capability statement')).toBeNull();
    expect(matchHelpIntent('Draft a capability statement from my uploaded resume')).toBeNull();
  });
});

describe('cancel: one step, any phrasing', () => {
  it.each(['cancel my subscription', 'Unsubscribe', 'Please stop billing me', 'I want to cancel my plan', 'How do I cancel my subscription?'])('"%s" routes to cancel', (q) => {
    expect(matchHelpIntent(q)).toBe('cancel_subscription');
  });

  it('unsubscribing from emails or alerts is not cancelling', () => {
    expect(matchHelpIntent('unsubscribe me from these emails')).not.toBe('cancel_subscription');
    expect(matchHelpIntent('how do I unsubscribe from alerts')).not.toBe('cancel_subscription');
  });
});
