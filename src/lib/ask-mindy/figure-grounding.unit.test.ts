import { describe, it, expect } from 'vitest';
import { ungroundedFigures, plainNumbersIn } from './figure-grounding';
import { evaluateDecision } from './evaluator';
import type { AnalystDecision } from './analyst';

const EVIDENCE = [
  'MARKET: janitorial services; $426.0M per year nationally (FY2026)',
  '- contract_id A: COMING BACK · FAA · Janitorial, West Palm Beach · place of performance FL · obligated $1.2M · current period ends 2027-03-31 · set-aside SBA',
  '- contract_id notice:x: OPEN NOW · Navy · Custodial services · responses due 2026-12-04',
].join('\n');
const dec = (headline: string, extra: Partial<AnalystDecision> = {}): AnalystDecision => ({
  headline, ruled_out: '', gaps: [], also_consider: [], next_question: 'Are you small?',
  pursuits: [{ contract_id: 'A', title: 'FAA West Palm Beach', why: ['in Florida'], barrier: null, next_move: 'Check SAM.gov this week' }],
  ...extra,
});

describe('ungroundedFigures', () => {
  it('an invented dollar figure is named', () => {
    expect(ungroundedFigures(dec('Go after the $4.2M West Palm Beach contract'), EVIDENCE)).toEqual(['$4.2M']);
  });
  it('a figure copied from the evidence passes, in any spelling or coarser precision', () => {
    expect(ungroundedFigures(dec('Go after the $1.2M West Palm Beach contract'), EVIDENCE)).toEqual([]);
    expect(ungroundedFigures(dec('Go after the $1.2 million contract in a $426M market ($0.4B)'), EVIDENCE)).toEqual([]);
  });
  it('a total the answer added up itself is not in the evidence', () => {
    expect(ungroundedFigures(dec('Together these are worth $427.2M'), EVIDENCE)).toEqual(['$427.2M']);
  });
  it('dates: copied ones pass in any common format; an invented one is named', () => {
    expect(ungroundedFigures(dec('Responses are due December 4, 2026; the contract ends 2027-03-31 (March 2027).'), EVIDENCE)).toEqual([]);
    expect(ungroundedFigures(dec('Responses are due 12/4/2026.'), EVIDENCE)).toEqual([]);
    expect(ungroundedFigures(dec('The next contract should be posted by June 1, 2027.'), EVIDENCE)).toEqual(['June 1, 2027']);
    expect(ungroundedFigures(dec('Due Dec 5.'), EVIDENCE)).toEqual(['Dec 5']);
  });
  it('every free-text field is checked, not just the headline', () => {
    const d = dec('Go after West Palm Beach', { also_consider: ['A $9.9M Navy bid'], ruled_out: 'Two bids due 2026-01-15 were in Texas.' });
    expect(ungroundedFigures(d, EVIDENCE).sort()).toEqual(['$9.9M', '2026-01-15'].sort());
  });
  it('counts and fiscal years are left alone (the evaluator judges those)', () => {
    expect(ungroundedFigures(dec('3 of the 12 open bids fit; plan for FY2028'), EVIDENCE)).toEqual([]);
  });
});

describe('the review fails `reasoned` on an untraceable figure, even when the model passed it', () => {
  const client = (seen: string[] = []) => ({ messages: { create: async (b: { messages: Array<{ content: string }> }) => { seen.push(b.messages[0].content); const ok = { pass: true, reason: 'ok' }; return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ reasoned: ok, actionable: ok, clear: ok, fix: [] }) }], usage: { input_tokens: 1, output_tokens: 1 } }; } } }) as never;
  const checks = [{ contract_id: 'A', verdict: 'pursue' as const, exclusions: [], barriers: [], actions: [] }];
  it('an invented $4.2M fails and is named in the reason and the fix', async () => {
    const e = await evaluateDecision({ question: 'q', evidence: EVIDENCE, decision: dec('Go after the $4.2M West Palm Beach contract'), checks }, { client: client() });
    expect(e.pass).toBe(false);
    const r = e.results.find((x) => x.criterion === 'reasoned')!;
    expect(r.pass).toBe(false);
    expect(r.reason).toContain('$4.2M');
    expect(e.fix.join(' ')).toContain('$4.2M');
  });
  it('a figure copied from the evidence passes', async () => {
    const e = await evaluateDecision({ question: 'q', evidence: EVIDENCE, decision: dec('Go after the $1.2M West Palm Beach contract'), checks }, { client: client() });
    expect(e.pass).toBe(true);
  });
});

describe('ordinary words are not dates', () => {
  it('a lowercase month word followed by a number is not a date', () => {
    expect(ungroundedFigures(dec('You may 3 times ask the buyer; march 2 crews to the site.'), EVIDENCE)).toEqual([]);
  });
  it('a capitalised month or an abbreviation with a period still counts', () => {
    expect(ungroundedFigures(dec('Due May 3.'), EVIDENCE)).toEqual(['May 3']);
    expect(ungroundedFigures(dec('Due dec. 5.'), EVIDENCE)).toEqual(['dec. 5']);
    expect(ungroundedFigures(dec('Due Dec 4.'), EVIDENCE)).toEqual([]);
  });
});

describe('the review returns the untraceable figures (figure text only)', () => {
  const client = () => ({ messages: { create: async () => { const ok = { pass: true, reason: 'ok' }; return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ reasoned: ok, actionable: ok, clear: ok, fix: [] }) }], usage: { input_tokens: 1, output_tokens: 1 } }; } } }) as never;
  const checks = [{ contract_id: 'A', verdict: 'pursue' as const, exclusions: [], barriers: [], actions: [] }];
  it('names exactly the figures, nothing around them', async () => {
    const e = await evaluateDecision({ question: 'q', evidence: EVIDENCE, decision: dec('Go after the $4.2M contract, due June 1, 2027, in a $426M market'), checks }, { client: client() });
    expect(e.untraceableFigures).toEqual(['$4.2M', 'June 1, 2027']);
  });
  it('an answer with only traceable figures returns none', async () => {
    const e = await evaluateDecision({ question: 'q', evidence: EVIDENCE, decision: dec('Go after the $1.2M contract'), checks }, { client: client() });
    expect(e.untraceableFigures).toEqual([]);
  });
});

describe('Mindy\'s own contract values (plain JSON numbers in tool results) are evidence', () => {
  const TOOL = JSON.stringify({ awards: [{ piid: 'W912PL26C4200', total_obligation: 1234567.89, potential_total_value: 18500000, naics_code: '541810', action_date: '2026-11-20', notice_id: '6ba812a7e0284f79bc44c4932777c340', uei: 'ABC123DEF456' }] });
  it('a real value is kept however the answer rounds it', () => {
    expect(ungroundedFigures(dec('The award is worth $1.2M.'), TOOL)).toEqual([]);
    expect(ungroundedFigures(dec('The award is worth $1.23M.'), TOOL)).toEqual([]);
    expect(ungroundedFigures(dec('The award is worth $1,234,567.'), TOOL)).toEqual([]);
    expect(ungroundedFigures(dec('Ceiling of $18.5M.'), TOOL)).toEqual([]);
    expect(ungroundedFigures(dec('Ceiling of $19M.'), TOOL)).toEqual([]);
  });
  it('an invented value is still stripped, even when identifiers and dates contain similar digits', () => {
    expect(ungroundedFigures(dec('The award is worth $4.2M.'), TOOL)).toEqual(['$4.2M']);
    expect(ungroundedFigures(dec('Worth $541,810.'), TOOL)).toEqual(['$541,810']);
    expect(ungroundedFigures(dec('Worth $2.6M.'), TOOL)).toEqual(['$2.6M']);
  });
  it('plain numbers inside identifiers and dates are not values', () => {
    expect(plainNumbersIn('piid W912PL26C4200 date 2026-11-20 uei ABC123DEF456 value 25000')).toEqual([25000]);
    expect(plainNumbersIn('{"naics_code":"541810","zip":"20001","amount":"1,234,567","obligated":"98765.5"}')).toEqual([1234567, 98765.5]);
  });
});
