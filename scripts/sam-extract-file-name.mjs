// Newest SAM public monthly entity extract name: SAM publishes it on the FIRST SUNDAY of each month
// (SAM_PUBLIC_MONTHLY_V2_20260503 = Sun May 3 2026). Before (or on) this month's first Sunday, the newest is last month's.
// Usage: node scripts/sam-extract-file-name.mjs [YYYY-MM-DD]   (default: today, UTC)
export function firstSunday(year, month0) {
  const d = new Date(Date.UTC(year, month0, 1));
  d.setUTCDate(1 + ((7 - d.getUTCDay()) % 7));
  return d;
}
export function newestMonthlyExtractName(today) {
  let fs = firstSunday(today.getUTCFullYear(), today.getUTCMonth());
  // Published on the first Sunday; use it from the next day on, so a same-day run never races the publication.
  if (today.getTime() <= fs.getTime() + 86_399_999) fs = firstSunday(today.getUTCFullYear(), today.getUTCMonth() - 1);
  const ymd = fs.toISOString().slice(0, 10).replace(/-/g, '');
  return `SAM_PUBLIC_MONTHLY_V2_${ymd}.ZIP`;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  const today = arg ? new Date(`${arg}T12:00:00Z`) : new Date();
  console.log(newestMonthlyExtractName(today));
}
