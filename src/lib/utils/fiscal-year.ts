/**
 * Federal fiscal-year helpers (Eric: "how do we know which year you're pulling
 * data from?"). The US federal FY runs Oct 1 → Sep 30 and is labeled by the year
 * it ENDS in (FY2025 = Oct 1 2024 → Sep 30 2025).
 *
 * USASpending only has COMPLETE data for a FY once it has ended. So our queries
 * should target the most recent ENDED fiscal year — and auto-roll forward each
 * October without a code change (no more stale hardcoded FY2024).
 */

/** The latest fiscal year that has fully ended (complete award data). */
export function latestCompleteFiscalYear(now: Date = new Date()): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0 = Jan, 9 = Oct
  // Current FY = y if before Oct, else y+1. The latest COMPLETE FY is the one
  // before the current one — i.e. the FY that ended last Sep 30.
  // Jan–Sep of year Y → current FY is Y → latest complete is Y-1.
  // Oct–Dec of year Y → current FY is Y+1 → latest complete is Y.
  return m >= 9 ? y : y - 1;
}

/** USASpending time_period filter for a given fiscal year (defaults to latest complete). */
export function fiscalYearTimePeriod(fy: number = latestCompleteFiscalYear()): { start_date: string; end_date: string } {
  return { start_date: `${fy - 1}-10-01`, end_date: `${fy}-09-30` };
}

/** Display label, e.g. "FY2025". */
export function fiscalYearLabel(fy: number = latestCompleteFiscalYear()): string {
  return `FY${fy}`;
}
