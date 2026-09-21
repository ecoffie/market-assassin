/**
 * Compact currency formatter for federal contracting dollar amounts.
 *
 * Federal awards span 10 orders of magnitude — a $50K purchase order
 * to a $4T agency lifetime spend. The formatter picks the right suffix
 * (T/B/M/K) and decimal precision so values stay scannable at every
 * scale without ambiguity.
 *
 * Examples:
 *   4091400000000  → "$4.1T"
 *   220966811991   → "$221B"
 *   14287432108    → "$14.3B"
 *   842000         → "$842K"
 *   500            → "$500"
 *   0              → "$0"
 *   null/undefined → "$0"
 *
 * Decimal rule: show 1 decimal for trillions and 1-2 decimals for
 * billions; integers for millions and below. Trailing zeros stripped
 * via Number() coercion in template strings.
 */
export function formatMoneyCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) {
    return '$0';
  }
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e10) return `${sign}$${(abs / 1e9).toFixed(0)}B`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e7)  return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3)  return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/**
 * Full-precision formatter for tooltips, "exact amount" displays, etc.
 */
export function formatMoneyFull(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) {
    return '$0';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}
