import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertNoPostAsOfLeakage, buildRegister, deriveInstrument, type RegisterResult } from './register';
import { CURRENT_STATE_COLUMNS, parseTxnRow, type DiligenceTxn } from './transactions';
import { findReportedSubsidiaries, measureCompleteness } from './completeness';

const T = 'TARGETUEI001';
const AS_OF = '2026-01-21';

function txn(over: Partial<DiligenceTxn>): DiligenceTxn {
  return {
    txn_key: 'K1', award_key: 'CONT_AWD_A1', piid: 'A1', mod_number: '0', transaction_number: '0',
    kind: 'award', award_type: 'DELIVERY ORDER', idv_type: null, idv_single_or_multiple: null, type_of_idc: null,
    parent_piid: null, parent_award_type: null, parent_single_or_multiple: null,
    action_date: '2025-01-01', initial_report_date: '2025-01-02',
    federal_action_obligation: 100, base_and_exercised_options_value: 100, base_and_all_options_value: 300,
    pop_start: '2025-01-01', pop_current_end: '2026-06-30', pop_potential_end: '2028-06-30', ordering_period_end: null,
    recipient_uei: T, recipient_name: 'TARGET LLC', recipient_parent_uei: T, recipient_parent_name: 'TARGET LLC', cage_code: null,
    awarding_agency: 'Department of Transportation', awarding_sub_agency: null, awarding_office: null,
    set_aside: 'SMALL BUSINESS SET ASIDE - TOTAL', extent_competed: null, naics: '541512', psc: null, pricing: null,
    description: 'IT SUPPORT', solicitation_identifier: null, co_business_size: 'SMALL BUSINESS', c8a_participant: null,
    ...over,
  };
}

describe('buildRegister — as-of freeze', () => {
  it('excludes actions dated after the cutoff and never sums them', () => {
    const r = buildRegister([
      txn({ txn_key: 'a' }),
      txn({ txn_key: 'b', mod_number: 'P00001', action_date: '2026-03-01', initial_report_date: '2026-03-02', federal_action_obligation: 999, pop_current_end: '2027-12-31' }),
    ], { targetUei: T, asOf: AS_OF });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].obligated.value).toBe(100);
    expect(r.rows[0].pop_current_end).toBe('2026-06-30'); // the POST-cutoff extension is invisible
    expect(r.leakage.excluded_actions_after_as_of).toBe(1);
    assertNoPostAsOfLeakage(r);
  });

  it('excludes an award whose first action is after the cutoff, and counts it', () => {
    const r = buildRegister([txn({ action_date: '2026-02-02', initial_report_date: '2026-02-03' })], { targetUei: T, asOf: AS_OF });
    expect(r.rows).toHaveLength(0);
    expect(r.leakage.excluded_awards_entirely_after_as_of).toBe(1);
  });

  it('strict mode excludes an action dated before the cutoff but reported after it', () => {
    const late = txn({ txn_key: 'late', mod_number: 'P00002', action_date: '2026-01-10', initial_report_date: '2026-03-02', federal_action_obligation: 50 });
    const strict = buildRegister([txn({ txn_key: 'a' }), late], { targetUei: T, asOf: AS_OF });
    const economic = buildRegister([txn({ txn_key: 'a' }), late], { targetUei: T, asOf: AS_OF, mode: 'action_dated_by_as_of' });
    expect(strict.rows[0].obligated.value).toBe(100);
    expect(strict.leakage.excluded_actions_reported_after_as_of).toBe(1);
    expect(economic.rows[0].obligated.value).toBe(150);
  });

  it('includes an action with no report date but discloses it', () => {
    const r = buildRegister([txn({ initial_report_date: null })], { targetUei: T, asOf: AS_OF });
    expect(r.rows[0].actions_without_report_date).toBe(1);
    expect(r.leakage.included_actions_without_report_date).toBe(1);
  });

  it('assertNoPostAsOfLeakage throws on a tampered register', () => {
    const r = buildRegister([txn({})], { targetUei: T, asOf: AS_OF });
    const tampered: RegisterResult = { ...r, rows: [{ ...r.rows[0], last_action_date: '2026-05-01' }] };
    expect(() => assertNoPostAsOfLeakage(tampered)).toThrow(/leakage/);
  });
});

describe('buildRegister — values', () => {
  it('keeps obligated and option values as separate sums', () => {
    const r = buildRegister([
      txn({ txn_key: 'a' }),
      txn({ txn_key: 'b', mod_number: 'P00001', action_date: '2025-06-01', federal_action_obligation: 50, base_and_exercised_options_value: 0, base_and_all_options_value: 0 }),
    ], { targetUei: T, asOf: AS_OF });
    const row = r.rows[0];
    expect(row.obligated.value).toBe(150);
    expect(row.base_and_exercised_options.value).toBe(100);
    expect(row.base_and_all_options.value).toBe(300);
  });

  it('unknown stays unknown: all-null actions sum to null, not 0', () => {
    const r = buildRegister([txn({ base_and_all_options_value: null })], { targetUei: T, asOf: AS_OF });
    expect(r.rows[0].base_and_all_options.value).toBeNull();
    expect(r.rows[0].base_and_all_options.null_actions).toBe(1);
  });

  it('a partial sum reports how many actions were null', () => {
    const r = buildRegister([
      txn({ txn_key: 'a' }),
      txn({ txn_key: 'b', mod_number: 'P00001', base_and_all_options_value: null }),
    ], { targetUei: T, asOf: AS_OF });
    expect(r.rows[0].base_and_all_options).toEqual({ value: 300, null_actions: 1 });
  });

  it('status is unknown, not ended, when no POP end is reported', () => {
    const r = buildRegister([txn({ pop_current_end: null })], { targetUei: T, asOf: AS_OF });
    expect(r.rows[0].status_as_of).toBe('unknown');
  });
});

describe('dedupe and scope', () => {
  it('drops identical duplicates and counts them', () => {
    const r = buildRegister([txn({}), txn({})], { targetUei: T, asOf: AS_OF });
    expect(r.rows[0].action_count).toBe(1);
    expect(r.dedupe.identical_duplicates_dropped).toBe(1);
  });

  it('fails closed on a conflicting duplicate transaction key', () => {
    expect(() => buildRegister([txn({}), txn({ federal_action_obligation: 7 })], { targetUei: T, asOf: AS_OF })).toThrow(/conflicting duplicate/);
  });

  it('keeps affiliates out unless named, and tags them when named', () => {
    const aff = txn({ txn_key: 'z', award_key: 'CONT_AWD_Z', recipient_uei: 'AFFILIATE001', recipient_parent_uei: T });
    expect(buildRegister([txn({}), aff], { targetUei: T, asOf: AS_OF }).rows).toHaveLength(1);
    const withAff = buildRegister([txn({}), aff], { targetUei: T, asOf: AS_OF, affiliateUeis: ['AFFILIATE001'] });
    expect(withAff.rows.map((r) => r.relationship).sort()).toEqual(['affiliate', 'target']);
    expect(findReportedSubsidiaries([txn({}), aff], T)).toEqual([
      expect.objectContaining({ uei: 'AFFILIATE001', actions_reporting_target_as_parent: 1 }),
    ]);
  });
});

describe('instrument', () => {
  it('derives from FPDS fields and returns null when they do not establish it', () => {
    expect(deriveInstrument({ kind: 'award', award_type: 'DELIVERY ORDER', idv_type: null, parent_piid: 'X', parent_award_type: 'IDC', parent_single_or_multiple: 'SINGLE AWARD' })).toBe('order under a single award IDIQ');
    expect(deriveInstrument({ kind: 'award', award_type: 'BPA CALL', idv_type: null, parent_piid: 'X', parent_award_type: 'BPA', parent_single_or_multiple: 'MULTIPLE AWARD' })).toBe('call under a multiple award BPA');
    expect(deriveInstrument({ kind: 'award', award_type: 'DELIVERY ORDER', idv_type: null, parent_piid: 'X', parent_award_type: null, parent_single_or_multiple: null })).toBeNull();
    expect(deriveInstrument({ kind: 'award', award_type: null, idv_type: null, parent_piid: null, parent_award_type: null, parent_single_or_multiple: null })).toBeNull();
  });
});

describe('parser — leakage by construction', () => {
  it('never reads the current-state award columns', () => {
    const src = readFileSync(resolve(__dirname, 'transactions.ts'), 'utf8');
    const body = src.slice(src.indexOf('export function parseTxnRow'));
    for (const c of CURRENT_STATE_COLUMNS) expect(body).not.toContain(`r.${c}`);
  });

  it('fails closed on an undatable row and on a non-numeric amount', () => {
    expect(() => parseTxnRow({ contract_transaction_unique_key: 'k', contract_award_unique_key: 'a', recipient_uei: 'U' })).toThrow(/unidentifiable/);
    expect(() => parseTxnRow({ contract_transaction_unique_key: 'k', contract_award_unique_key: 'a', recipient_uei: 'U', action_date: '2025-01-01', federal_action_obligation: 'abc' })).toThrow(/non-numeric/);
  });

  it('empty amount is null, zero is zero', () => {
    const base = { contract_transaction_unique_key: 'k', contract_award_unique_key: 'a', recipient_uei: 'U', action_date: '2025-01-01' };
    expect(parseTxnRow({ ...base, federal_action_obligation: '' }).federal_action_obligation).toBeNull();
    expect(parseTxnRow({ ...base, federal_action_obligation: '0' }).federal_action_obligation).toBe(0);
  });
});

describe('measureCompleteness', () => {
  it('is incomplete when a listed award was not downloaded', () => {
    const t = [txn({})];
    const reg = buildRegister(t, { targetUei: T, asOf: AS_OF });
    const rep = measureCompleteness({
      uei: T, txns: t, register: reg,
      live: [
        { generated_internal_id: 'CONT_AWD_A1', award_id: 'A1', group: 'contracts', recipient_uei: T, recipient_name: null, start_date: null },
        { generated_internal_id: 'CONT_AWD_A2', award_id: 'A2', group: 'contracts', recipient_uei: T, recipient_name: null, start_date: '2014-01-01' },
      ],
    });
    expect(rep.verdict).toBe('incomplete');
    expect(rep.listed_not_downloaded).toEqual([{ award_key: 'CONT_AWD_A2', start_date: '2014-01-01' }]);
    expect(rep.register_coverage_pct).toBe(100);
  });
});
