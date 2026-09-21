/**
 * Append-only change log for recompete_opportunities. Issue #288.
 *
 * The sync upserts on contract_id, so each run overwrites the prior row.
 * USASpending serves only current state, so a change we fail to record while
 * it happens is gone permanently -- it cannot be backfilled later. This module
 * captures the diff at the one moment both versions exist: upsert time.
 */
import type { SyncedContract } from './usaspending-sync';

/**
 * Fields worth a history. Deliberately small: each one answers a question the
 * current-state table cannot.
 *
 *   period_of_performance_current_end -- slips predict slips
 *   potential_total_value             -- a raised ceiling means growing scope
 *   incumbent_uei                     -- a changed UEI means novation/acquisition
 *
 * Not tracked: last_synced_at (churns every run), description/naics_description
 * (upstream text edits, high volume, no signal).
 */
export const TRACKED_FIELDS = [
  'period_of_performance_current_end',
  'potential_total_value',
  'incumbent_uei',
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

export interface RecompeteChange {
  contract_id: string;
  piid: string | null;
  naics_code: string | null;
  field: TrackedField;
  old_value: string | null;
  new_value: string | null;
  observed_at: string;
}

/**
 * The stored copy of a contract, as the diff needs it.
 *
 * Every tracked field is REQUIRED. A partial row is indistinguishable from one
 * whose columns are genuinely NULL, and the difference is not cosmetic: a
 * missing column reads as "absent -> present" and logs a phantom transition
 * into an append-only table. Required here, and enforced at runtime in
 * diffContracts, because the rows arrive from Supabase as `any`.
 */
export type ExistingRow = { contract_id: string } & Record<
  TrackedField,
  string | number | null
>;

/**
 * One log column holds dates, money, and ids, so everything normalises to TEXT.
 * Numbers get special care: 1000 and 1000.0 and "1000" are the same value, and
 * logging them as a change would fill the table with noise that looks like
 * signal.
 */
function normalise(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    // Numeric strings compare as numbers ("1000.00" === 1000), not as text.
    const asNumber = Number(trimmed);
    if (trimmed !== '' && Number.isFinite(asNumber) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
      return String(asNumber);
    }
    return trimmed;
  }
  return String(value);
}

/**
 * Diff incoming contracts against what is already stored.
 *
 * Only rows that ALREADY EXIST produce changes. A brand-new contract is not a
 * "change" -- logging null -> value for every field on first sight would bury
 * the real transitions under the initial load (129k rows x 3 fields).
 */
export function diffContracts(
  existing: ExistingRow[],
  incoming: SyncedContract[],
  observedAt: string,
): RecompeteChange[] {
  const before = new Map(existing.map((row) => [row.contract_id, row]));
  const changes: RecompeteChange[] = [];

  for (const next of incoming) {
    const prev = before.get(next.contract_id);
    if (!prev) continue; // new contract, not a change

    for (const field of TRACKED_FIELDS) {
      // An absent key means the caller didn't SELECT this column -- it does not
      // mean the stored value is NULL. Guessing would log "null -> value" for
      // every contract on every run: permanent fiction, at 129k-row scale, in a
      // table whose whole purpose is being trustworthy about the past.
      if (!(field in prev)) {
        throw new Error(
          `change-log: existing row ${prev.contract_id} is missing "${field}" — ` +
            `callers must SELECT every field in TRACKED_FIELDS`,
        );
      }

      const oldValue = normalise(prev[field]);
      const newValue = normalise(next[field]);
      if (oldValue === newValue) continue;

      changes.push({
        contract_id: next.contract_id,
        piid: next.piid ?? null,
        naics_code: next.naics_code ?? null,
        field,
        old_value: oldValue,
        new_value: newValue,
        observed_at: observedAt,
      });
    }
  }

  return changes;
}
