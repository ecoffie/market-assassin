import { afterEach, describe, expect, it } from 'vitest';
import {
  askMindyStrategyPlanEnabledFor, isStrategyPlanRequest, STRATEGY_PLAN_CHAT_CONTRACT, strategyPlanCheck, strategyProfileNote, strategyCompanyContext,
  STRATEGY_PLAN_ENV, STRATEGY_PLAN_ALLOWLIST_ENV,
} from './strategy-plan';
import { GENERIC_MARKET_REPORT, LIST_AND_GENERIC_PLAN, STRONG_PLAN } from './__fixtures__/strategy-plan/docs';
import { buildFmpNextMarketReportArgs, buildFmpPathwayFindArgs, filterToolsForTurn } from '@/lib/chat/tool-selection';
import { initialFmpPhaseState } from '@/lib/chat/fmp-phase-machine';

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

describe('the contract: the existing research workflow, for any company', () => {
  it('follows the RBA research order and Eric\'s reporting doctrine', () => {
    const c = STRATEGY_PLAN_CHAT_CONTRACT;
    expect(c).toContain('where the company stands -> where it should focus -> why -> which pathways and buyers matter -> what to do over the next 90 days');
    expect(c).toContain('identity -> awards -> pathways -> vehicles -> market_size -> contacts -> web -> writeup');
    expect(c).toContain('Award NAICS outrank the registered NAICS list');
    expect(c).toContain('Pathways before open bids');
    expect(c).toContain('Market size supports the choice; it is never the deliverable');
    expect(c).toContain('named contact, why approach them, and the question to ask');
    expect(c).toContain('DSBS keywords');
    expect(c).toContain('"Next 90 days": Move -> First step -> Why first -> By when');
    expect(c).toContain('"Pathways in priority order: where to focus"');
    expect(c).toContain('"Buyer pain points"');
    expect(c).toContain('no grades or scores for the company; no Mindy plans, prices or upsells');
    expect(c).toContain('every table carries an interpretation column');
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

describe('tool selection: a strategy-plan turn runs the Federal Market Profile pipeline', () => {
  const defs = ['generate_market_report', 'create_document', 'find_opportunities', 'get_contractor_award_history', 'get_expiring_contracts'].map((name) => ({ type: 'function', function: { name } }));
  it('treated as FMP: nothing stripped up front, no forced packaged report (the phase machine owns order)', () => {
    const r = filterToolsForTurn(defs, 'Write a federal strategy plan and comprehensive market research report for us', null, { strategyPlan: true });
    expect(r.federalMarketProfile).toBe(true);
    expect(r.marketResearch).toBe(false);
    expect(r.removed).toEqual([]);
  });
  it('flag off (no option): unchanged behavior, the market report is still forced for a report ask', () => {
    const r = filterToolsForTurn(defs, 'Build a comprehensive market research report for janitorial services', null);
    expect(r.marketResearch).toBe(true);
    expect(r.federalMarketProfile).toBe(false);
  });
});

describe('company context: the RBA civil defaults never reach another company', () => {
  const company = { legalName: 'Ridgeline Test Facilities LLC', workPhrase: 'janitorial custodial HVAC maintenance', naics: '561720', states: ['GA', 'SC'] };
  it('pathway FIND uses the planner query, else the company work phrase, and the company states', () => {
    expect(buildFmpPathwayFindArgs('Write a federal strategy plan for us', { company })).toMatchObject({ query: 'janitorial custodial HVAC maintenance', location: 'GA,SC' });
    expect(buildFmpPathwayFindArgs('Write a federal strategy plan for us', { company, plannerQuery: 'custodial services federal buildings' })).toMatchObject({ query: 'custodial services federal buildings' });
    expect(JSON.stringify(buildFmpPathwayFindArgs('plan for us', { company }))).not.toMatch(/highway|bridge|heavy civil/);
  });
  it('without company context the benchmark FMP behavior is unchanged', () => {
    expect(buildFmpPathwayFindArgs('Build a federal market profile for RBA')).toMatchObject({ query: 'highway bridge heavy civil' });
    expect(buildFmpNextMarketReportArgs('Build a federal market profile for RBA', 0)).toMatchObject({ naics: '237310' });
  });
  it('market report: award NAICS first, then the company code, never 237310; states rotate over the company states', () => {
    expect(buildFmpNextMarketReportArgs('plan for us', 0, { company })).toEqual({ state: 'GA', naics: '561720', client_name: 'Ridgeline Test Facilities LLC' });
    expect(buildFmpNextMarketReportArgs('plan for us', 1, { company, awardNaics: '561210' })).toEqual({ state: 'SC', naics: '561210', client_name: 'Ridgeline Test Facilities LLC' });
    expect(buildFmpNextMarketReportArgs('plan for us', 0, { company: { legalName: 'X LLC' } })).toEqual({ client_name: 'X LLC' });
  });
  it('phase state: one market report per company state (max 3), one national report with none', () => {
    expect(initialFmpPhaseState('plan for us', { companyStates: ['GA', 'SC'] }).marketReportTarget).toBe(2);
    expect(initialFmpPhaseState('plan for us', { companyStates: [] }).marketReportTarget).toBe(1);
    expect(initialFmpPhaseState('Build a federal market profile for RBA').marketReportTarget).toBe(3);
  });
});

describe('step 1: the saved company profile opens the research', () => {
  const profile = {
    companyName: 'Ridgeline Test Facilities LLC', uei: 'TESTUEI00001', naicsCodes: ['561720', '238220'], states: ['GA'],
    certifications: [{ name: 'WOSB', source: 'self_reported' as const }], keywords: ['janitorial', 'custodial', 'HVAC maintenance'],
    pastPerformance: { buyerAgencies: ['General Services Administration'], buyerOffices: [], naicsCodes: ['561720'], primeCount: 0, subCount: 2, otherRoleCount: 0 },
    unknown: ['vehiclesHeld' as const],
  };
  it('names the company, marks self-reported facts, and keeps unknown as unknown', () => {
    const note = strategyProfileNote({ status: 'ok', profile });
    expect(note).toContain('- Legal name: Ridgeline Test Facilities LLC');
    expect(note).toContain('- UEI: TESTUEI00001');
    expect(note).toContain('award history decides what they actually win');
    expect(note).toContain('- Certifications (self-reported, not verified): WOSB');
    expect(note).toContain('0 as prime, 2 as sub');
    expect(note).toContain('- Not in the profile (unknown, not zero): vehiclesHeld');
    expect(strategyCompanyContext({ status: 'ok', profile })).toEqual({ legalName: 'Ridgeline Test Facilities LLC', workPhrase: 'janitorial custodial HVAC maintenance', naics: '561720', states: ['GA'] });
  });
  it('a refused or unreadable profile is said so, never treated as an empty company', () => {
    expect(strategyProfileNote({ status: 'refused' })).toMatch(/acting workspace could not be confirmed/);
    expect(strategyProfileNote({ status: 'unavailable' })).toMatch(/could not be read; it is not empty/);
    expect(strategyCompanyContext({ status: 'unavailable' })).toEqual({});
  });
});

describe('the synthetic Ridgeline plan (built through the workflow, 2026-11-22) passes both checks', () => {
  it('existing FMP write-up validator (pathways first, pain, who to talk to, DSBS) and the strategy argument check', async () => {
    const { validateDocModel } = await import('@/lib/documents/validate');
    const { validateFmpWriteup } = await import('@/lib/chat/fmp-writeup-validate');
    const raw = (await import('./__fixtures__/strategy-plan/ridgeline-plan.json')).default;
    const v = validateDocModel(raw);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(validateFmpWriteup(v.model, { defenseBuyersAppear: false, requiredSnippets: [] }).issues).toEqual([]);
    expect(strategyPlanCheck(v.model as never)).toEqual({ pass: true, missing: [], warnings: [] });
    // the doctrine shows in the plan itself
    const text = JSON.stringify(v.model);
    expect(text).toContain('Next 90 days');
    expect(text).toContain('Why these and not others');
    expect(text).toContain('DSBS');
    expect(text).not.toMatch(/\$\d+\s*\/\s*mo|subscription|upgrade|Mindy Pro/i);
  });
});
