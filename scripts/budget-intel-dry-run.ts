/**
 * One live USASpending slice. Prints the rows a run would upsert.
 * Does not open a database connection and does not write.
 *
 *   npx tsx scripts/budget-intel-dry-run.ts
 */
import { fetchBudgetSlice } from '../src/lib/budget-intel/fetch';

async function main() {
const slice = await fetchBudgetSlice({ agencyIndex: 0, page: 1 });
const summary = {
  dry_run: true,
  wrote: false,
  agency: slice.agency.agency,
  toptier_code: slice.agency.toptierCode,
  cursor: slice.cursor,
  nextCursor: slice.nextCursor,
  fiscalYears: slice.fiscalYears,
  authority_rows: slice.authority.length,
  program_rows: slice.programs.length,
  priority_rows: slice.priorities.length,
  prioritiesOutcome: slice.prioritiesOutcome,
  authoritySourceUrl: slice.authoritySourceUrl,
  programSourceUrl: slice.programSourceUrl,
  prioritiesSourceUrl: slice.prioritiesSourceUrl,
  skippedDuplicateToptier: slice.skippedDuplicateToptier,
  authority: slice.authority.map((row) => ({
    fiscal_year: row.fiscal_year,
    budget_authority: row.budget_authority,
    obligated: row.obligated,
    trend: row.trend,
    change_percent: row.change_percent,
    source_url: row.source_url,
    fetched_at: row.fetched_at,
    source_key: row.source_key,
  })),
  programs: slice.programs.map((row) => ({
    program_code: row.program_code,
    program_name: row.program_name,
    fiscal_year: row.fiscal_year,
    obligated_amount: row.obligated_amount,
    funding_trend: row.funding_trend,
    category: row.category,
    source_url: row.source_url,
    fetched_at: row.fetched_at,
    source_key: row.source_key,
  })),
  priorities: slice.priorities,
};
console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
