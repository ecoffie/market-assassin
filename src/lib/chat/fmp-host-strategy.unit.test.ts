/**
 * The FMP host fallback document on an Ask Mindy strategy-plan turn (ASK_MINDY_STRATEGY_PLAN). When the planner's
 * write-up fails the gate twice, the host builds the document from this turn's evidence. On a strategy turn for a
 * non-construction company it must be that company's plan: no civil/highway wording, no 8(a) wording for a firm
 * that is not 8(a), no defense construction-oversight section, plus an "About the company" standing section and a
 * "Next 90 days" moves table built only from the pathways this turn returned.
 * Synthetic company; the pathway rows mirror the public records used in the Ridgeline benchmark plan.
 */
import { describe, expect, it } from 'vitest';
import { accumulateFmpEvidence, buildFmpHostDocModel, type FmpHostStrategy } from './fmp-writeup-grounding';
import { validateFmpWriteup } from './fmp-writeup-validate';
import { strategyPlanCheck } from '@/lib/ask-mindy/strategy-plan';
import { flattenDocModelText } from './fmp-writeup-grounding';

const FIND = {
  horizons: {
    open_now: { status: 'grounded', items: [
      { horizon: 'open_now', title: 'Francis Marion Ranger District Office Janitorial Services', buyer: 'AGRICULTURE, DEPARTMENT OF', solicitation_number: '12444127Q0002', notice_id: 'a5d3706f07644fa88780fe9af4e07e70', response_deadline: '2026-12-17T22:00:00+00:00', notice_type: 'Combined Synopsis/Solicitation', naics_code: '561720', set_aside: 'Small Business Set Aside - Total' },
    ] },
    coming_back: { status: 'grounded', items: [
      { horizon: 'coming_back', title: 'RESIDENTIAL ENHANCEMENTS, INC.', buyer: 'Department of Defense Education Activity', piid: 'HE125425CE002', current_end: '2027-01-31', naics_code: '561720', description: 'CUSTODIAL SERVICES AT FORT STEWART.' },
    ] },
    coming_soon: { status: 'grounded', items: [
      { horizon: 'coming_soon', title: 'Chattooga River Ranger District Recreational Janitorial and garbage services', buyer: 'USDA', fiscal_year: 'FY2027', naics_code: '561720' },
    ] },
  },
};

const evidence = () => accumulateFmpEvidence([
  { tool: 'get_contractor_award_history', content: JSON.stringify({ history: null, _meta: { grounded: false, resolution: 'none_in_award_corpus' } }) },
  { tool: 'find_opportunities', content: JSON.stringify(FIND) },
], 'Write a federal strategy plan for us');

const STRATEGY: FmpHostStrategy = { companyName: 'Ridgeline Test Facilities LLC', construction: false, is8a: false, workTerms: ['janitorial', 'custodial', 'HVAC maintenance', 'grounds maintenance'] };
const TODAY = () => '2026-11-22';

describe('host fallback document on a strategy turn (non-construction company)', () => {
  const model = buildFmpHostDocModel(evidence(), { customerText: 'Write a federal strategy plan for us', defenseBuyersAppear: true, strategy: STRATEGY, today: TODAY });
  const text = flattenDocModelText(model);

  it('is the company\'s plan: its name, a standing section and a 90-day moves table', () => {
    expect(model.title).toBe('Ridgeline Test Facilities LLC: Federal Strategy Plan');
    expect(model.sections.map((s) => s.heading)).toEqual(expect.arrayContaining([
      'About the company: where Ridgeline Test Facilities LLC stands',
      'Next 90 days',
    ]));
    const ninety = model.sections.find((s) => s.heading === 'Next 90 days')!.blocks[0] as { rows: Array<Record<string, string>> };
    expect(ninety.rows.length).toBeGreaterThanOrEqual(2);
    expect(ninety.rows[ninety.rows.length - 1].move).toBe('Fix SAM and DSBS');
  });

  it('carries no RBA benchmark wording: no civil or highway lines, no 8(a), no defense construction section', () => {
    expect(text).not.toMatch(/highway|bridge|heavy civil|design-build|deferred maintenance/i);
    expect(text).not.toMatch(/8\(a\)/);
    expect(model.sections.some((s) => /PAE/.test(s.heading))).toBe(false);
    expect(text).toMatch(/DSBS keywords[^.]*janitorial, custodial, HVAC maintenance, grounds maintenance/);
  });

  it('passes the existing FMP write-up gate and the strategy argument check', () => {
    expect(validateFmpWriteup(model, { defenseBuyersAppear: false, requiredSnippets: [] }).issues.filter((i) => i.severity === 'error')).toEqual([]);
    const check = strategyPlanCheck(model as never);
    expect(check.missing).toEqual([]);
    expect(check.pass).toBe(true);
  });
});

describe('without a strategy context the benchmark FMP host model is unchanged', () => {
  it('keeps its title and benchmark wording', () => {
    const model = buildFmpHostDocModel(evidence(), { customerText: 'Build a federal market profile for RBA Construction', today: TODAY });
    expect(model.title).toMatch(/Federal Market Profile$/);
    expect(model.sections[0].heading).toBe('The read');
    expect(model.sections.some((s) => s.heading === 'Next 90 days')).toBe(false);
  });

  it('a construction company on a strategy turn keeps the construction framing and the 8(a) wording when it is 8(a)', () => {
    const model = buildFmpHostDocModel(evidence(), { customerText: 'Write a federal strategy plan for us', defenseBuyersAppear: true, strategy: { ...STRATEGY, construction: true, is8a: true, workTerms: ['bridge'] }, today: TODAY });
    expect(model.sections.some((s) => /PAE/.test(s.heading))).toBe(true);
    expect(flattenDocModelText(model)).toMatch(/8\(a\)/);
  });
});
