import { afterEach, describe, expect, it } from 'vitest';
import {
  askMindyStrategyPlanEnabledFor, isStrategyPlanRequest, STRATEGY_PLAN_CHAT_CONTRACT, strategyPlanCheck,
  STRATEGY_PLAN_ENV, STRATEGY_PLAN_ALLOWLIST_ENV,
} from './strategy-plan';
import { GENERIC_MARKET_REPORT, LIST_AND_GENERIC_PLAN, STRONG_PLAN } from './__fixtures__/strategy-plan/docs';
import { filterToolsForTurn } from '@/lib/chat/tool-selection';

const saved = { a: process.env[STRATEGY_PLAN_ENV], b: process.env[STRATEGY_PLAN_ALLOWLIST_ENV] };
afterEach(() => {
  for (const [k, v] of [[STRATEGY_PLAN_ENV, saved.a], [STRATEGY_PLAN_ALLOWLIST_ENV, saved.b]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe('isStrategyPlanRequest: a plan for this company, not a market-size report', () => {
  it.each([
    'Build a federal growth strategy for Ridgeline Test Facilities',
    'Can you write a federal strategy plan for us?',
    'We need a 90-day plan to win our first federal contract',
    'Where should we focus first in federal?',
    'What should we do first to break into VA work?',
    'Put together a go-to-market plan for our janitorial company',
    'Make an action plan for the expo next week',
  ])('matches: %s', (q) => expect(isStrategyPlanRequest(q)).toBe(true));

  it.each([
    'Build a comprehensive market research report for janitorial services',
    'How much does the VA spend on janitorial services?',
    'Find open HVAC opportunities in Georgia',
    'Who is the incumbent on 36C24825C0020?',
  ])('does not match: %s', (q) => expect(isStrategyPlanRequest(q)).toBe(false));
});

describe('flag: default off, allowlist by verified email', () => {
  it('off unless set', () => {
    delete process.env[STRATEGY_PLAN_ENV];
    expect(askMindyStrategyPlanEnabledFor('a@b.com')).toBe(false);
  });
  it('allowlist mode is per email', () => {
    process.env[STRATEGY_PLAN_ENV] = 'allowlist';
    process.env[STRATEGY_PLAN_ALLOWLIST_ENV] = 'tester@example.com';
    expect(askMindyStrategyPlanEnabledFor('Tester@Example.com')).toBe(true);
    expect(askMindyStrategyPlanEnabledFor('other@example.com')).toBe(false);
  });
});

describe('the contract: one argument, the existing tools, no market report', () => {
  it('states the argument and the rules that separate a plan from a report', () => {
    expect(STRATEGY_PLAN_CHAT_CONTRACT).toContain('where the company stands -> where it should focus -> why those choices -> what to do next');
    expect(STRATEGY_PLAN_CHAT_CONTRACT).toContain('Do not call generate_market_report for this plan');
    expect(STRATEGY_PLAN_CHAT_CONTRACT).toContain('Every table carries an interpretation column');
    expect(STRATEGY_PLAN_CHAT_CONTRACT).toContain('Move -> First step -> Why first');
    expect(STRATEGY_PLAN_CHAT_CONTRACT).toContain('What it says now -> Why it matters -> Change to');
    expect(STRATEGY_PLAN_CHAT_CONTRACT).toContain('Why these and not others');
    expect(STRATEGY_PLAN_CHAT_CONTRACT).toContain('Do not repeat the chat answer as the document');
  });
  it('is generic: no benchmark company, agency program or em dash baked in', () => {
    expect(STRATEGY_PLAN_CHAT_CONTRACT).not.toMatch(/Bresa|Revo|Gold Coast|TextClock|Superb|RBA|bridge|NAVSEA|—/i);
  });
});

describe('strategyPlanCheck: reads the argument, not the formatting', () => {
  it('a plan with standing, reasoned focus, what was set aside and first moves passes', () => {
    const r = strategyPlanCheck(STRONG_PLAN);
    expect(r).toEqual({ pass: true, missing: [], warnings: [] });
  });

  it('the packaged market report fails: no standing, no focus, no moves, tables without interpretation', () => {
    const r = strategyPlanCheck(GENERIC_MARKET_REPORT);
    expect(r.pass).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining([
      'a "where the company stands" section from its own records',
      'a "first moves" section',
      'an interpretation for the table in "Market size" (a "why it matters / what it means" column or a recommendation)',
      'an interpretation for the table in "Top agencies" (a "why it matters / what it means" column or a recommendation)',
      'labeled recommendations (at least two) tied to the evidence',
    ]));
    expect(r.warnings).toContain('mostly tables: check that the plan argues, not just lists');
  });

  it('an opportunity list with a generic action plan fails: no reasons, no first steps', () => {
    const r = strategyPlanCheck(LIST_AND_GENERIC_PLAN);
    expect(r.pass).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining([
      'a reason for each choice in "Top opportunities"',
      'a concrete first step for each move in "Next steps"',
    ]));
  });

  it('a focus table interpreted by a recommendation in the same section is accepted', () => {
    const doc = structuredClone(STRONG_PLAN);
    doc.sections[2].blocks[0].columns = [{ key: 'buyer', label: 'Buyer' }, { key: 'amt', label: 'Spend' }];
    const r = strategyPlanCheck(doc);
    expect(r.missing.some((m) => m.startsWith('an interpretation for the table'))).toBe(false);
    // ...but the focus still needs its reasons
    expect(r.missing).toContain('a reason for each choice in "Where to focus"');
  });

  it('warns, without failing, when nothing says what was set aside', () => {
    const doc = structuredClone(STRONG_PLAN);
    doc.sections.splice(3, 1);
    const r = strategyPlanCheck(doc);
    expect(r.pass).toBe(true);
    expect(r.warnings).toContain('nothing says what was set aside or what not to do, so the choices may read as unexplained');
  });
});

describe('tool selection: a strategy-plan turn never gets the packaged market report', () => {
  const defs = ['generate_market_report', 'create_document', 'find_opportunities', 'get_contractor_award_history'].map((name) => ({ type: 'function', function: { name } }));
  it('market report removed, create_document kept, nothing forced', () => {
    const r = filterToolsForTurn(defs, 'Write a federal strategy plan and comprehensive market research report for us', null, { strategyPlan: true });
    expect(r.marketResearch).toBe(false);
    expect(r.defs.map((d) => d.function.name)).not.toContain('generate_market_report');
    expect(r.defs.map((d) => d.function.name)).toContain('create_document');
    expect(r.removed).toContain('generate_market_report');
  });
  it('flag off (no option): unchanged behavior, the market report is still forced for a report ask', () => {
    const r = filterToolsForTurn(defs, 'Build a comprehensive market research report for janitorial services', null);
    expect(r.marketResearch).toBe(true);
    expect(r.defs.map((d) => d.function.name)).toContain('generate_market_report');
  });
});
