/**
 * MEASURED dataset population — the live count, not the catalogue's memory.
 *
 * WHY
 * data_sources.record_count is a hand-typed column. forecast_intelligence has
 * read 7764 since April while the canonical store holds a different number
 * entirely. Every value in that column was typed by a human and none of them
 * self-heal, so a reader that renders record_count is rendering a claim the
 * system cannot defend ("a number is a product feature").
 *
 * The fix is at the READER, not by typing a fresher number into the column:
 * a new hand-entered figure rots exactly like the old one. We measure the
 * canonical physical store instead and expose the stored value as advisory.
 *
 * ⚠️ EXACT COUNT, HEAD ONLY. `select('*')` would silently cap at PostgREST's
 * 1,000 rows and under-report by orders of magnitude — the bug that made a
 * 33,687-row corpus look like 383. And a null count is UNKNOWN, never 0
 * (Bug Prevention Rule #11): returning 0 for an unreadable table would report
 * an empty dataset as fact.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Canonical physical store for each logical dataset we can measure. */
const CANONICAL_TABLE: Record<string, string> = {
  forecast_intelligence: 'agency_forecasts',
};

export interface MeasuredPopulation {
  /** The live count. NULL = could not measure — never coerced to 0. */
  measuredRecordCount: number | null;
  /** What the catalogue column claims. Advisory only. */
  storedRecordCount: number | null;
  /** Which physical table was counted; null when the dataset has no mapping. */
  measuredFrom: string | null;
}

export async function measureDatasetPopulation(
  sb: SupabaseClient,
  datasetKey: string,
  storedRecordCount: number | null,
): Promise<MeasuredPopulation> {
  const table = CANONICAL_TABLE[datasetKey];
  if (!table) return { measuredRecordCount: null, storedRecordCount, measuredFrom: null };

  const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true });
  // Surface unknown as unknown. A missing table returns count=null with NO error
  // (HTTP 204), so the null check must stand on its own.
  if (error || count === null || count === undefined) {
    return { measuredRecordCount: null, storedRecordCount, measuredFrom: table };
  }
  return { measuredRecordCount: count, storedRecordCount, measuredFrom: table };
}
