/**
 * Government-wide statutory small-business goals (15 U.S.C. 644(g)), by fiscal year.
 *
 * The SDVOSB goal rose from 3% to 5% with Pub. L. 118-31 (FY2024 NDAA) §863, starting in FY2025. Any fiscal year
 * before FY2025 is still scored against 3%, so a historical read stays correct. Every other goal is unchanged:
 * small business 23%, SDB 5%, WOSB 5%, HUBZone 3%.
 */
export type StatutoryGoalKey = 'small_business' | 'sdb_8a' | 'sdvosb' | 'wosb' | 'hubzone';

/** The first fiscal year scored against the 5% SDVOSB goal. */
export const SDVOSB_5PCT_FROM_FY = 2025;

export const STATUTORY_GOAL_SOURCE =
  '15 U.S.C. 644(g). The SDVOSB goal is 3% through FY2024 and 5% from FY2025 (Pub. L. 118-31, FY2024 NDAA, §863).';

export function statutoryGoalPct(key: StatutoryGoalKey, fiscalYear: number): number {
  switch (key) {
    case 'small_business': return 23;
    case 'sdb_8a': return 5;
    case 'wosb': return 5;
    case 'hubzone': return 3;
    case 'sdvosb': return fiscalYear >= SDVOSB_5PCT_FROM_FY ? 5 : 3;
  }
}

/** The federal fiscal year a date falls in (FY starts 1 October). */
export function fiscalYearOf(d: Date = new Date()): number {
  return d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}
