import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/halvik-register-2026-01-21.json';
import halvikFacts from '../../../../scripts/diligence/fixtures/halvik-deal-facts.json';
import type { RegisterRow } from '../register';
import { assertPermittedWording, reviewRecertification, type DealFacts, type RecertReview } from './engine';
import { G_THRESHOLD, POLICY_LEGAL_REVIEW_STATUS, RULES, gCite, type FactId } from './policy';
import golden from './__fixtures__/halvik-recert-review.golden.json';
import { projectReview } from './regression';

const ROWS = fixture.rows as unknown as RegisterRow[];
const UEI = 'VMRTJLWMQRH7';
const AS_OF = '2026-01-21';
const BASE: DealFacts = halvikFacts as DealFacts;
const est = <T,>(value: T, known_as_of = '2026-01-01') => ({ status: 'established' as const, value, source: 'test', known_as_of });

const run = (facts: Partial<DealFacts> = {}, asOf = AS_OF, mode?: 'knowable_at_as_of' | 'all_established') =>
  reviewRecertification({ rows: ROWS, facts: { ...BASE, ...facts }, asOf, mode });
const inst = (r: RecertReview, piid: string) => r.instruments.find((i) => i.federal_fact.piid === piid)!;
const rule = (r: RecertReview, piid: string, id: string) => inst(r, piid).rules.find((x) => x.rule_id === id)!;
const summary = (r: RecertReview, id: string) => r.summary.filter((s) => s.rule_id === id);

describe('Halvik regression (all deal facts unknown, as of 2026-01-21)', () => {
  const r = run();

  it('reviews 46 active awards and the 12 vehicles whose ordering period was open', () => {
    expect(r.instruments.filter((i) => i.federal_fact.kind === 'award')).toHaveLength(46);
    expect(r.instruments.filter((i) => i.federal_fact.kind === 'idv')).toHaveLength(12);
    // all four OASIS SB pools closed 2024-12-19 — no future orders, so out of R5/R6 scope
    for (const p of ['47QRAD20D1046', '47QRAD20D3010', '47QRAD20D4016', '47QRAD20D8115']) {
      expect(r.instruments.find((i) => i.federal_fact.piid === p)).toBeUndefined();
    }
  });

  it('public values for the reviewed awards match the register', () => {
    const r2 = summary(r, 'R2')[0];
    expect(r2.awards).toBe(46);
    expect(Math.round(r2.public_obligated)).toBe(547168054);
    expect(Math.round(r2.public_ceiling)).toBe(795503576);
    expect(Math.round(r2.ceiling_not_yet_obligated)).toBe(248335523);
  });

  it('the only FLAG is R11 (a federal-fact-only rule); everything transaction-dependent is NEEDS_REVIEW', () => {
    const flags = r.summary.filter((s) => s.status === 'FLAG').map((s) => s.rule_id);
    expect(flags).toEqual(['R11']);
    for (const id of ['R1', 'R3', 'R5', 'R6', 'R7', 'R8', 'R9', 'R13']) {
      expect(summary(r, id).map((s) => s.status)).toEqual(['NEEDS_REVIEW']);
    }
    expect(summary(r, 'R5')[0].vehicles).toBe(6);
    expect(summary(r, 'R13')[0]).toMatchObject({ awards: 8, vehicles: 2 });
    expect(Math.round(summary(r, 'R13')[0].public_obligated)).toBe(173715900);
  });

  it('NASA SITSS is an existing order under a set-aside MAC with an 8(a) basis', () => {
    const f = inst(r, '80TECH22FA001').federal_fact;
    expect(f).toMatchObject({ class: 'order_under_set_aside_mac', eight_a_basis: true, parent_piid: '47QRAD20D8115' });
    expect(rule(r, '80TECH22FA001', 'R13').review.depends_on.sort()).toEqual(['T5a_8a_ownership_or_control_relinquished', 'T5b_8a_waiver_status']);
  });

  it('every NEEDS_REVIEW enumerates what it depends on', () => {
    for (const i of r.instruments) for (const x of i.rules) if (x.review.status === 'NEEDS_REVIEW') {
      expect(x.review.depends_on.length).toBeGreaterThan(0);
    }
  });

  it('generates a diligence request for every missing decisive fact', () => {
    const facts = r.diligence_requests.map((q) => q.fact);
    for (const f of ['T1_change_of_controlling_interest', 'T2_transaction_date', 'T3_acquirer_size_under_naics', 'T4_recertification_outcome',
      'T5a_8a_ownership_or_control_relinquished', 'T5b_8a_waiver_status', 'F_partial_set_aside_portion', 'F_g2_option_conditions',
      'F_pending_offers', 'I_options_on_existing_orders', 'I_g1_scope_unrestricted_mac'] as FactId[]) expect(facts).toContain(f);
    const t3 = r.diligence_requests.find((q) => q.fact === 'T3_acquirer_size_under_naics')!;
    expect(t3.scope_detail.every((s) => /^NAICS \d{6}$/.test(s))).toBe(true);
    expect(r.diligence_requests.find((q) => q.fact === 'F_partial_set_aside_portion')!.instruments).toEqual(['1333BJ21D00280002']);
  });
});

describe('Halvik regression result is frozen', () => {
  it('the minimized fixture reproduces the golden three-layer output and Diligence Request List exactly', () => {
    expect(JSON.parse(JSON.stringify(projectReview(run())))).toEqual(golden);
  });

  it('the fixture is public federal data only, carries provenance, and holds only whitelisted fields', () => {
    const meta = (fixture as { _meta: Record<string, any> })._meta;
    expect(meta.public_federal_data_only).toBe(true);
    expect(meta.as_of).toBe(AS_OF);
    expect(meta.source.file_name).toMatch(/^PrimeTransactionsAndSubawards_/);
    expect(meta.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const allowed = new Set(meta.fields);
    for (const row of fixture.rows) for (const k of Object.keys(row)) expect(allowed.has(k), k).toBe(true);
    expect(meta.counts).toEqual({ awards: 46, vehicles: 30 });
  });

  it('an award ended at as-of is not reviewed', () => {
    const award = ROWS.find((r) => r.kind === 'award')!;
    const ended = { ...award, award_key: 'CONT_AWD_ENDED_TEST', piid: 'ENDEDTEST', status_as_of: 'ended' } as RegisterRow;
    const r = reviewRecertification({ rows: [...ROWS, ended], facts: BASE, asOf: AS_OF });
    expect(r.instruments.find((i) => i.federal_fact.piid === 'ENDEDTEST')).toBeUndefined();
  });
});

describe('legal review status', () => {
  it('every output states the policy has not been reviewed by counsel', () => {
    const r = run();
    expect(POLICY_LEGAL_REVIEW_STATUS).toBe('NOT_REVIEWED_BY_COUNSEL');
    expect(r.policy_legal_review_status).toBe('NOT_REVIEWED_BY_COUNSEL');
    expect(r.boundary).toMatch(/NOT been reviewed by counsel/);
  });

  it('the wording guard rejects any claim of legal approval', () => {
    const bad = structuredClone(run());
    bad.instruments[0].rules[0].review.review_flag = 'This rule is legally approved.';
    expect(() => assertPermittedWording(bad)).toThrow(/reviewed by counsel/);
  });
});

describe('never infer, never assume', () => {
  it('the announcement date is never used as the transaction date', () => {
    const r = run({ informational: { announcement_date: '2026-01-10', reported_acquisition_window: { from: '2025-12-29', to: '2026-03-29' } } });
    const r5 = r.instruments.find((i) => i.federal_fact.class === 'vehicle_set_aside_mac')!.rules.find((x) => x.rule_id === 'R5')!;
    expect(r5.review.status).toBe('NEEDS_REVIEW');
    expect(r5.review.facts_missing).toContain('T2_transaction_date');
  });

  it('an established transaction date before the threshold selects 125.12(g)(1)', () => {
    const veh = run().instruments.find((i) => i.federal_fact.class === 'vehicle_set_aside_mac')!.federal_fact;
    const r = run({
      change_of_controlling_interest: est(true),
      transaction_date: est('2026-01-10'),
      recertification_outcome_by_award: { [veh.award_key]: est('disqualifying' as const) },
    });
    const r5 = rule(r, veh.piid, 'R5');
    expect(r5.review).toMatchObject({ status: 'FLAG', citation: '13 CFR 125.12(g)(1)' });
  });

  it('acquirer size is never assumed: on/after threshold without size stays NEEDS_REVIEW; size for another NAICS does not count', () => {
    const veh = run().instruments.find((i) => i.federal_fact.class === 'vehicle_set_aside_mac')!.federal_fact;
    const facts = {
      change_of_controlling_interest: est(true),
      transaction_date: est(G_THRESHOLD),
      recertification_outcome_by_award: { [veh.award_key]: est('disqualifying' as const) },
    };
    const open = rule(run(facts), veh.piid, 'R5').review;
    expect(open.status).toBe('NEEDS_REVIEW');
    expect(open.depends_on).toEqual(['T3_acquirer_size_under_naics']);
    expect(open.possible_outcomes.map((o) => o.citation).sort()).toEqual(['13 CFR 125.12(e)(2)(ii)(B)(1)', '13 CFR 125.12(e)(2)(ii)(B)(2)']);
    const wrongNaics = rule(run({ ...facts, acquirer_size_by_naics: { '999999': est('other_than_small' as const) } }), veh.piid, 'R5').review;
    expect(wrongNaics.status).toBe('NEEDS_REVIEW');
    const decided = rule(run({ ...facts, acquirer_size_by_naics: { [veh.mac_naics!]: est('other_than_small' as const) } }), veh.piid, 'R5').review;
    expect(decided).toMatchObject({ status: 'FLAG', citation: '13 CFR 125.12(e)(2)(ii)(B)(1)' });
  });

  it('an 8(a) waiver is never assumed in either direction', () => {
    const relinquished = { eight_a_ownership_or_control_relinquished: est(true) };
    const open = rule(run(relinquished), '80TECH22FA001', 'R13').review;
    expect(open.status).toBe('NEEDS_REVIEW');
    expect(open.depends_on).toEqual(['T5b_8a_waiver_status']);
    expect(open.possible_outcomes.map((o) => o.status).sort()).toEqual(['FLAG', 'FLAG', 'NEEDS_REVIEW', 'NO_FLAG']);
    const granted = rule(run({ ...relinquished, eight_a_waiver_status: est('granted' as const) }), '80TECH22FA001', 'R13').review;
    expect(granted.status).toBe('NO_FLAG');
    const none = rule(run({ ...relinquished, eight_a_waiver_status: est('not_requested' as const) }), '80TECH22FA001', 'R13').review;
    expect(none.status).toBe('FLAG');
    expect(none.review_flag).toMatch(/termination-for-convenience requirement applies/);
    expect(none.review_flag).not.toMatch(/will be terminated/);
  });

  it('options on existing orders are never interpreted, even with every deal fact established', () => {
    const order = run().instruments.find((i) => i.rules.some((x) => x.rule_id === 'R7'))!.federal_fact;
    const r = run({
      change_of_controlling_interest: est(true),
      transaction_date: est('2026-02-01'),
      acquirer_size_by_naics: { [order.mac_naics!]: est('other_than_small' as const) },
      recertification_outcome_by_award: { [order.award_key]: est('disqualifying' as const) },
    });
    const r7 = rule(r, order.piid, 'R7').review;
    expect(r7.status).toBe('NEEDS_REVIEW');
    expect(r7.possible_outcomes).toEqual([]);
    expect(r7.depends_on).toEqual(['I_options_on_existing_orders']);
  });

  it('knowable mode ignores a fact established after as_of; all_established mode uses it', () => {
    const late = { change_of_controlling_interest: est(true, '2026-05-01') };
    const knowable = run(late);
    const all = run(late, AS_OF, 'all_established');
    const piid = knowable.instruments.find((i) => i.rules.some((x) => x.rule_id === 'R1'))!.federal_fact.piid;
    expect(rule(knowable, piid, 'R1').review.status).toBe('NEEDS_REVIEW');
    expect(rule(all, piid, 'R1').review.status).toBe('FLAG');
  });
});

describe('historical as_of', () => {
  it('before 2025-01-16 the 125.12 rules are NOT_IN_EFFECT; 124.515 (text from 2023-05-30) still applies', () => {
    const r = reviewRecertification({ rows: ROWS, facts: BASE, asOf: '2024-06-01' });
    const r1 = r.instruments.flatMap((i) => i.rules).filter((x) => x.rule_id === 'R1');
    expect(r1.length).toBeGreaterThan(0);
    expect(new Set(r1.map((x) => x.review.status))).toEqual(new Set(['NOT_IN_EFFECT']));
    expect(r.diligence_requests.some((q) => q.fact === 'T2_transaction_date')).toBe(false);
    const eightA = r.instruments.flatMap((i) => i.rules).filter((x) => x.rule_id === 'R13');
    expect(eightA.length).toBeGreaterThan(0);
    expect(eightA.every((x) => x.review.status !== 'NOT_IN_EFFECT')).toBe(true);
  });

  it('cites 125.12(g)(i)/(ii) before the 2025-06-04 correction and (g)(1)/(2) after', () => {
    expect(gCite('2025-03-01', 1)).toBe('13 CFR 125.12(g)(i)');
    expect(gCite('2025-06-04', 2)).toBe('13 CFR 125.12(g)(2)');
    const r = reviewRecertification({ rows: ROWS, facts: BASE, asOf: '2025-03-01' });
    const r5 = r.instruments.flatMap((i) => i.rules).find((x) => x.rule_id === 'R5');
    if (r5) expect(r5.regulatory_fact.citations.map((c) => c.cite)).toContain('13 CFR 125.12(g)(i)');
  });
});

describe('wording guard', () => {
  it('passes on the Halvik output and never says backlog', () => {
    const r = run();
    expect(() => assertPermittedWording(r)).not.toThrow();
    const strings = JSON.stringify({ ...r, boundary: '' });
    expect(strings).not.toMatch(/backlog/i);
  });

  it('throws when a prohibited phrase reaches the output', () => {
    const r = run();
    const bad = structuredClone(r);
    bad.instruments[0].rules[0].review.review_flag = 'this backlog will be terminated';
    expect(() => assertPermittedWording(bad)).toThrow(/prohibited wording/);
  });
});

describe('policy integrity', () => {
  it('every rule carries citation, effective period, required facts, permitted and prohibited wording', () => {
    for (const r of RULES) {
      expect(r.citations('2026-01-21').length).toBeGreaterThan(0);
      expect(r.effective.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.effective.basis.length).toBeGreaterThan(10);
      expect(Array.isArray(r.permitted_wording) && Array.isArray(r.prohibited_wording)).toBe(true);
      for (const b of r.branches) for (const f of Object.keys(b.when)) expect(r.required_facts).toContain(f);
      if (r.branches.length) for (const f of r.required_facts) expect(r.branches.some((b) => f in b.when), `${r.id} never reads ${f}`).toBe(true);
    }
    expect(RULES.map((r) => r.id)).toEqual(Array.from({ length: 15 }, (_, i) => `R${i + 1}`));
  });

  it('no two branches of a rule can be satisfied by the same fully-known facts (exhaustive)', () => {
    const domain: Record<string, string[]> = {
      T1_change_of_controlling_interest: ['yes', 'no'], T2_transaction_date: ['before_threshold', 'on_or_after_threshold'],
      T3_acquirer_size_under_naics: ['small', 'other_than_small'], T4_recertification_outcome: ['qualifying', 'disqualifying'],
      T5a_8a_ownership_or_control_relinquished: ['yes', 'no'], T5b_8a_waiver_status: ['granted', 'denied', 'pending', 'not_requested'],
      F_partial_set_aside_portion: ['reserved_portion', 'unrestricted_portion'], F_g2_option_conditions: ['met', 'not_met'],
      F_pending_offers: ['none', 'present'], I_options_on_existing_orders: ['resolved'], I_g1_scope_unrestricted_mac: ['resolved'],
    };
    for (const r of RULES) {
      if (!r.branches.length) continue;
      const facts = r.required_facts;
      const combos: Record<string, string>[] = [{}];
      for (const f of facts) {
        const next: Record<string, string>[] = [];
        for (const c of combos) for (const v of domain[f]) next.push({ ...c, [f]: v });
        combos.splice(0, combos.length, ...next);
      }
      for (const c of combos) {
        const hits = r.branches.filter((b) => Object.entries(b.when).every(([f, v]) => c[f] === v));
        expect(hits.length, `${r.id} ${JSON.stringify(c)}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
