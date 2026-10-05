/**
 * I/O for the production completeness gate (completeness-gate.ts is the pure part). Used by the
 * weekly ingest before it publishes, and by `scripts/awards-completeness-gate.ts` (read-only).
 *
 * Every read here is a SELECT or a USASpending count. A read that fails is UNMEASURED (null), never
 * 0 — the gate then fails closed rather than calling the warehouse complete.
 */
import { bqQuery } from '@/lib/bigquery/client';
import {
  buildGateWarehouseCountsSql,
  buildStagedMalformedSql,
  classifyCompletenessGate,
  settledCohortMonths,
  type CompletenessGateResult,
  type WarehouseMonthRow,
} from './completeness-gate';
import { sourceCohortCounts } from './source-counts';

export async function runCompletenessGate(input: {
  awardsTable: string;
  /** Fully-qualified staging table this run loaded; omit for a warehouse-only (read-only) check. */
  stagingFq?: string;
  asOf?: string;
  log?: (...m: unknown[]) => void;
}): Promise<CompletenessGateResult> {
  const log = input.log ?? (() => {});
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
  const rows = await bqQuery<{ month: string; dod: number | string; civilian: number | string; malformed: number | string }>({
    query: buildGateWarehouseCountsSql(input.awardsTable, asOf),
    bulkJob: 'awards-ingest-completeness-gate',
  });
  const warehouse: WarehouseMonthRow[] = rows.map((r) => ({
    month: String(r.month), dod: Number(r.dod), civilian: Number(r.civilian), malformed: Number(r.malformed),
  }));
  const source = new Map<string, number | null>();
  const settled = settledCohortMonths(asOf);
  for (const month of [...new Set(settled.map((m) => m.month))]) {
    const counts = await sourceCohortCounts(month);
    for (const { cohort } of settled.filter((m) => m.month === month)) source.set(`${cohort}|${month}`, counts[cohort]);
  }
  // No staging (read-only check): nothing was staged, so there is nothing to validate — 0, by definition.
  let stagedMalformed: number | null = input.stagingFq ? null : 0;
  if (input.stagingFq) {
    try {
      const [m] = await bqQuery<{ malformed: number | string }>({ query: buildStagedMalformedSql(input.stagingFq), bulkJob: 'awards-ingest-completeness-gate' });
      stagedMalformed = m ? Number(m.malformed) : null;
    } catch (e) {
      log(`completeness: staged agency-code check unmeasured: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    }
  }
  return classifyCompletenessGate({ asOf, warehouse, source, stagedMalformed });
}
