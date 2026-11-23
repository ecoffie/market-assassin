import { afterEach, describe, expect, it } from 'vitest';
import {
  askMindyStrategyPlanEnabledFor, isStrategyPlanRequest, STRATEGY_PLAN_CHAT_CONTRACT, strategyPlanCheck, strategyProfileNote, strategyCompanyContext, strategyFitNote,
  STRATEGY_PLAN_ENV, STRATEGY_PLAN_ALLOWLIST_ENV,
} from './strategy-plan';
import { fitRankingNote, rankFindResult } from './compose';
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
  it('without company context there is no default trade, code or region either', () => {
    const find = buildFmpPathwayFindArgs('Build a federal market profile for RBA');
    expect(find.query).toBe('Build a federal market profile for RBA');
    expect(JSON.stringify(find)).not.toMatch(/highway|bridge|heavy civil/);
    const report = buildFmpNextMarketReportArgs('Build a federal market profile for RBA', 0);
    expect(report.naics).toBeUndefined();
    expect(JSON.stringify(report)).not.toMatch(/237310/);
  });
  it('market report: award NAICS first, then the company code, never 237310; states rotate over the company states', () => {
    expect(buildFmpNextMarketReportArgs('plan for us', 0, { company })).toEqual({ state: 'GA', naics: '561720', client_name: 'Ridgeline Test Facilities LLC' });
    expect(buildFmpNextMarketReportArgs('plan for us', 1, { company, awardNaics: '561210' })).toEqual({ state: 'SC', naics: '561210', client_name: 'Ridgeline Test Facilities LLC' });
    expect(buildFmpNextMarketReportArgs('plan for us', 0, { company: { legalName: 'X LLC' } })).toEqual({ client_name: 'X LLC' });
  });
  it('phase state: one market report per company state (max 3), one national report with none', () => {
    expect(initialFmpPhaseState('plan for us', { companyStates: ['GA', 'SC'] }).marketReportTarget).toBe(2);
    expect(initialFmpPhaseState('plan for us', { companyStates: [] }).marketReportTarget).toBe(1);
    expect(initialFmpPhaseState('Build a federal market profile for RBA').marketReportTarget).toBe(1);
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

describe('PR 2: "where to focus" is ranked by the shared fit scorer', () => {
  const NOW = Date.parse('2026-11-22T12:00:00Z');
  const profile = {
    companyName: 'Ridgeline Test Facilities LLC', naicsCodes: ['561720'], states: ['SC', 'GA'], certifications: [],
    keywords: ['janitorial'], unknown: [],
  };
  const FIND = {
    horizons: {
      open_now: { status: 'grounded', matched_count: 2, items: [
        { horizon: 'open_now', title: 'Francis Marion Ranger District Office Janitorial Services', buyer: 'AGRICULTURE, DEPARTMENT OF', naics_code: '561720', place_of_performance_state: 'SC', set_aside_description: 'Small Business Set Aside - Total', response_deadline: '2026-12-17T22:00:00+00:00', relevant_date: '2026-12-17', relevant_date_label: 'response_deadline' },
        { horizon: 'open_now', title: 'Tractor Purchase', buyer: 'DEPT OF DEFENSE', naics_code: '336120', place_of_performance_state: 'GA', set_aside_description: 'No Set aside used', response_deadline: '2026-11-23T21:00:00+00:00' },
      ] },
      coming_back: { status: 'grounded', matched_count: 0, items: [] },
      coming_soon: { status: 'unavailable', items: [] },
    },
  };
  const r = (tool: string, value: unknown, status = 'success') => ({ record: { tool, status }, content: JSON.stringify(value) });

  it('ranks the FIND result for this company: the matching janitorial notice, not the tractor', () => {
    const fit = strategyFitNote([r('find_opportunities', FIND)], { status: 'ok', profile }, NOW);
    expect(fit.reason).toBe('ok');
    expect(fit.note).toMatch(/^FIT SIGNAL/);
    expect(fit.note).toContain('Francis Marion Ranger District Office Janitorial Services');
    expect(fit.note).not.toContain('Tractor Purchase');
    expect(fit.note).toMatch(/Never print or cite a score/);
  });

  it('the strategy note is one input to prioritization, never the final order (no "do not re-rank", no "in this order")', () => {
    const note = strategyFitNote([r('find_opportunities', FIND)], { status: 'ok', profile }, NOW).note!;
    expect(note).toContain('one input to prioritization, not the final order');
    expect(note).not.toMatch(/do not re-rank/i);
    expect(note).not.toMatch(/in this order/i);
    expect(note).not.toMatch(/TOP PICKS/);
    // same picks and fit reasons as the answer-mode note: one scorer, not a second scoring system
    const answer = fitRankingNote(rankFindResult(FIND as Parameters<typeof rankFindResult>[0], profile, { nowMs: NOW }))!;
    const picks = (s: string) => s.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(picks(note)).toEqual(picks(answer));
    expect(picks(note).length).toBeGreaterThan(0);
  });

  it('default (answer) mode is byte-identical to the live #2285 note', () => {
    const ctx = rankFindResult(FIND as Parameters<typeof rankFindResult>[0], profile, { nowMs: NOW });
    const live = fitRankingNote(ctx)!;
    expect(fitRankingNote(ctx, {})).toBe(live);
    expect(fitRankingNote(ctx, { mode: 'answer' })).toBe(live);
    const lines = live.split('\n');
    expect(lines[0]).toBe("FIT RANKING (computed for this company by Mindy's shared fit scorer from the find_opportunities result above; use it, do not re-rank):");
    expect(lines[1]).toBe('TOP PICKS, best first. Present these as the top picks in this order, each with its "why" in plain words. Never print a score.');
    expect(lines.slice(2)).toEqual(fitRankingNote(ctx, { mode: 'strategy_input' })!.split('\n').slice(2));
  });

  it('no note without a profile, without a successful FIND, or with an unreadable result', () => {
    expect(strategyFitNote([r('find_opportunities', FIND)], { status: 'unavailable' }, NOW)).toEqual({ note: null, reason: 'no_profile' });
    expect(strategyFitNote([r('find_opportunities', FIND)], null, NOW).reason).toBe('no_profile');
    expect(strategyFitNote([r('get_contractor_award_history', {})], { status: 'ok', profile }, NOW)).toEqual({ note: null, reason: 'no_find' });
    expect(strategyFitNote([r('find_opportunities', FIND, 'failed')], { status: 'ok', profile }, NOW).reason).toBe('no_find');
    expect(strategyFitNote([{ record: { tool: 'find_opportunities', status: 'success' }, content: 'not json' }], { status: 'ok', profile }, NOW)).toEqual({ note: null, reason: 'unreadable' });
  });

  it('the contract treats fit as one input and REQUIRES an evidence-named why whenever the order departs from it', () => {
    const line = STRATEGY_PLAN_CHAT_CONTRACT.split('\n').find((l) => l.startsWith('- Prioritization:'))!;
    expect(line).toContain('when a FIT SIGNAL note is present');
    expect(line).toContain('one input to prioritization, not the final order');
    // the evidence it must weigh alongside fit
    for (const w of ['award history', 'vehicles held', 'competitive position', 'incumbents', 'buyer relationships', 'timing', 'objective', 'trade-offs']) expect(line).toContain(w);
    // a departure is not merely permitted: the explanation is required
    expect(line).toContain('Every pathway states why it is recommended');
    expect(line).toMatch(/When your order differs from the FIT SIGNAL order, that pathway's why MUST name the evidence that moved it/);
    expect(line).toContain('never depart from the fit order without saying why');
    expect(line).toContain('Never print or cite a fit score');
    // the old "follow its order" instruction is gone
    expect(line).not.toMatch(/follows its order/);
    expect(STRATEGY_PLAN_CHAT_CONTRACT).not.toContain('do not re-rank');
  });
});
