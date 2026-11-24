import { describe, it, expect } from 'vitest';
import { buildAnalystPrompt, enforceDecision, type AnalystDecision } from './analyst';
import { checkRecords, type CandidateRecord } from './evidence-checks';
import type { CompetitionFacts } from '@/lib/opportunities/competition-facts';
import fixture from './__fixtures__/fl-janitorial-recompetes-2026-11-24.json';

const records = fixture.records as CandidateRecord[];
const checks = checkRecords(records, fixture.scope, undefined, new Map(Object.entries(fixture.competition as Record<string, CompetitionFacts>)));
const passing = checks.filter((c) => c.verdict === 'pursue').map((c) => c.contract_id);
const excluded = checks.filter((c) => c.verdict !== 'pursue').map((c) => c.contract_id);

const input = {
  question: 'What open opportunities are there for janitorial services in Florida?',
  profile: null,
  market: { subject: 'janitorial services', sizeLine: null, topAgencies: [], topCompetitors: [], forecastsLine: '0 matched' },
  records,
  checks,
};

describe('buildAnalystPrompt', () => {
  const prompt = buildAnalystPrompt(input);
  it('offers every passing record by contract_id', () => {
    for (const id of passing) expect(prompt).toContain(`contract_id ${id}`);
  });
  it('never offers an excluded record by contract_id, only its reason', () => {
    for (const id of excluded) expect(prompt).not.toContain(id);
    expect(prompt).toMatch(/Gulfport|names MS/);
  });
  it('states unknown profile and carries barriers and actions', () => {
    expect(prompt).toContain('COMPANY PROFILE: not provided');
    expect(prompt).toContain('barrier:');
    expect(prompt).toContain('action:');
  });
});

describe('enforceDecision', () => {
  const base: AnalystDecision = { headline: 'h', ruled_out: 'r', gaps: [], next_question: 'q', pursuits: [] };
  const p = (contract_id: string) => ({ contract_id, title: 't', why: ['w'], barrier: null, next_move: 'm' });

  it('drops a pursuit that cites an excluded record', () => {
    const { decision, dropped } = enforceDecision({ ...base, pursuits: [p(excluded[0]), p(passing[0])] }, checks);
    expect(decision.pursuits.map((x) => x.contract_id)).toEqual([passing[0]]);
    expect(dropped).toEqual([excluded[0]]);
  });
  it('drops an invented contract id', () => {
    expect(enforceDecision({ ...base, pursuits: [p('CONT_AWD_INVENTED')] }, checks).decision.pursuits).toEqual([]);
  });
  it('caps at 3 pursuits', () => {
    const many = [...passing, ...passing].map(p);
    expect(enforceDecision({ ...base, pursuits: many }, checks).decision.pursuits).toHaveLength(3);
  });
});

describe('identity marker and group counts in the analyst prompt', () => {
  const rec = { contract_id: 'A', incumbent_name: 'RBA ENGINEERING INTERNATIONAL, PLLC', incumbent_uei: 'C9K6EE9JVDK7', description: 'Bridge' };
  const chk = [{ contract_id: 'A', verdict: 'pursue' as const, exclusions: [], barriers: [], actions: [] }];
  const base = { question: 'q', profile: null, market: { subject: 's', sizeLine: null, topAgencies: [], topCompetitors: [], forecastsLine: 'f' }, records: [rec], checks: chk };
  it('marks YOUR COMPANY only on a UEI match', () => {
    expect(buildAnalystPrompt({ ...base, customerUei: 'C9K6EE9JVDK7' })).toContain('YOUR COMPANY (UEI match)');
    const noUei = buildAnalystPrompt(base);
    expect(noUei).not.toContain('YOUR COMPANY');
    expect(noUei).toContain('incumbent RBA ENGINEERING INTERNATIONAL, PLLC');
  });
  it('gives exact group counts', () => {
    expect(buildAnalystPrompt(base)).toContain('GROUP COUNTS (use exactly): Coming back: 1 checked, 1 passing, 0 excluded');
  });
});
