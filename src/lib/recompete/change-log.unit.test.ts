import { describe, expect, it } from 'vitest';
import { diffContracts, TRACKED_FIELDS, type ExistingRow } from './change-log';
import type { SyncedContract } from './usaspending-sync';

const OBSERVED = '2026-07-16T20:00:00.000Z';

function contract(overrides: Partial<SyncedContract> = {}): SyncedContract {
  return {
    contract_id: 'CONT_AWD_1',
    award_id: 'CONT_AWD_1',
    piid: 'PIID-1',
    incumbent_name: 'ACME CONSTRUCTION LLC',
    incumbent_uei: 'ABC123DEF456',
    awarding_agency: 'Department of Defense',
    awarding_sub_agency: null,
    awarding_office: null,
    funding_agency: null,
    naics_code: '236220',
    naics_description: null,
    psc_code: null,
    description: null,
    total_obligation: 1_000_000,
    potential_total_value: 5_000_000,
    period_of_performance_start: '2024-01-01',
    period_of_performance_current_end: '2027-01-15',
    place_of_performance_state: null,
    place_of_performance_city: null,
    contract_type: null,
    data_source: 'usaspending-sync',
    source_url: 'https://example.test/1',
    last_synced_at: OBSERVED,
    ...overrides,
  };
}

/**
 * A complete stored row. Every tracked field is present, matching what
 * loadExisting SELECTs — a partial row is a caller bug the diff now rejects.
 */
function existingRow(overrides: Partial<ExistingRow> = {}): ExistingRow {
  return {
    contract_id: 'CONT_AWD_1',
    period_of_performance_current_end: '2027-01-15',
    potential_total_value: 5_000_000,
    incumbent_uei: 'ABC123DEF456',
    ...overrides,
  };
}

describe('diffContracts', () => {
  it('records an expiry slip — the signal the log exists for', () => {
    const changes = diffContracts(
      [existingRow({ period_of_performance_current_end: '2027-01-15' })],
      [contract({ period_of_performance_current_end: '2027-06-30' })],
      OBSERVED,
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      contract_id: 'CONT_AWD_1',
      field: 'period_of_performance_current_end',
      old_value: '2027-01-15',
      new_value: '2027-06-30',
      observed_at: OBSERVED,
    });
  });

  it('records a raised ceiling and a changed UEI independently', () => {
    const changes = diffContracts(
      [existingRow({ potential_total_value: 5_000_000, incumbent_uei: 'OLDUEI000001' })],
      [contract({ potential_total_value: 9_000_000, incumbent_uei: 'NEWUEI000002' })],
      OBSERVED,
    );

    expect(changes.map((c) => c.field).sort()).toEqual(['incumbent_uei', 'potential_total_value']);
  });

  it('does NOT log a brand-new contract — first sight is not a change', () => {
    // Logging null -> value on first sight would bury real transitions under
    // the 129k-row initial load.
    expect(diffContracts([], [contract()], OBSERVED)).toEqual([]);
  });

  it('does not log when nothing moved', () => {
    expect(diffContracts([existingRow()], [contract()], OBSERVED)).toEqual([]);
  });

  it('treats numerically-equal values as unchanged, whatever their type', () => {
    // Postgres hands back numerics as strings; the API sends numbers. Logging
    // "5000000.00" -> 5000000 every run would fill the table with noise that
    // reads as signal.
    expect(
      diffContracts(
        [existingRow({ potential_total_value: '5000000.00' })],
        [contract({ potential_total_value: 5_000_000 })],
        OBSERVED,
      ),
    ).toEqual([]);
  });

  it('treats null, undefined and empty string as the same absence', () => {
    expect(
      diffContracts([existingRow({ incumbent_uei: '' })], [contract({ incumbent_uei: null })], OBSERVED),
    ).toEqual([]);
  });

  it('records a value appearing where there was none', () => {
    const changes = diffContracts(
      [existingRow({ incumbent_uei: null })],
      [contract({ incumbent_uei: 'ABC123DEF456' })],
      OBSERVED,
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ old_value: null, new_value: 'ABC123DEF456' });
  });

  it('only diffs rows it was given a "before" for', () => {
    // A contract absent from `existing` is unknown, not unchanged — guessing
    // either way would write fiction into an append-only table.
    const changes = diffContracts(
      [existingRow({ period_of_performance_current_end: '2027-01-15' })],
      [
        contract({ period_of_performance_current_end: '2027-06-30' }),
        contract({ contract_id: 'CONT_AWD_2', period_of_performance_current_end: '2028-01-01' }),
      ],
      OBSERVED,
    );

    expect(changes).toHaveLength(1);
    expect(changes[0].contract_id).toBe('CONT_AWD_1');
  });

  it('throws on a "before" row missing a tracked column, rather than inventing history', () => {
    // The bug this guard exists for: if loadExisting's SELECT ever drops a
    // column, the absent key reads as null and every contract logs a phantom
    // "null -> value" on every run — permanent fiction, at 129k-row scale, in
    // the one table whose value is being trustworthy about the past. Loud
    // failure beats a corrupt log nobody notices.
    const partial = { contract_id: 'CONT_AWD_1', period_of_performance_current_end: '2027-01-15' };

    expect(() =>
      diffContracts([partial as ExistingRow], [contract()], OBSERVED),
    ).toThrow(/missing "potential_total_value"/);
  });

  it('keeps the tracked-field list small and intentional', () => {
    // A guard on scope: adding a churny field (last_synced_at, description)
    // would drown the log. Widen this deliberately, not by accident.
    expect([...TRACKED_FIELDS]).toEqual([
      'period_of_performance_current_end',
      'potential_total_value',
      'incumbent_uei',
    ]);
  });
});
