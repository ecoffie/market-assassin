/**
 * Award / research history vs open opportunities — ONE rule for `aggregated_opportunities` rows.
 *
 * NIH RePORTER (`source='nih_reporter'`) indexes projects NIH has already FUNDED. Every such row is a
 * `reporter.nih.gov/project-details/<id>` page, its `close_date` is the funded project's budget/project
 * END (the writer maps `budget_end` → closeDate, src/lib/scrapers/apis/nih-reporter.ts), and its
 * `status='active'` means "project is active", not "open for proposals". Measured 2026-09-26:
 * 1,516 nih_reporter rows (1,474 grant + 42 sbir_sttr), 1,487 of them active with a future close_date —
 * i.e. 1,487 funded projects that looked like open opportunities with deadlines.
 *
 * Rule: an award-history row is labeled `award_history`, never carries a deadline, and is never
 * presented as an open opportunity. Stored data and the scraper are unchanged — this is a READ-side rule.
 */

/** Sources whose rows are funded/awarded projects, never solicitations. */
export const AWARD_HISTORY_SOURCES: readonly string[] = ['nih_reporter'];

const PROJECT_DETAIL_URL = /reporter\.nih\.gov\/project-details\//i;

export type RecordKind = 'award_history' | 'opportunity';

export function isAwardHistoryRow(row: { source?: string | null; source_url?: string | null; sourceUrl?: string | null }): boolean {
  if (row.source && AWARD_HISTORY_SOURCES.includes(row.source)) return true;
  const url = row.source_url ?? row.sourceUrl ?? '';
  return PROJECT_DETAIL_URL.test(url);
}

export function recordKindFor(row: Parameters<typeof isAwardHistoryRow>[0]): RecordKind {
  return isAwardHistoryRow(row) ? 'award_history' : 'opportunity';
}
