/**
 * Deterministic BigQuery staging schema for USASpending bulk CSVs.
 */

import type { BqStringField } from './staging-schema-types';
import { parseCsvHeaderColumns } from './split-member-lead';

export type { BqStringField };

export function buildStringStagingSchema(headerRecord: string): BqStringField[] {
  return parseCsvHeaderColumns(headerRecord).map((name) => ({
    name,
    type: 'STRING',
    mode: 'NULLABLE',
  }));
}
