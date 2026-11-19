/** Client-safe ranking helpers (no server imports). */

/** Top percent, rounded so it never claims a better tier than the rank earns ("top 2%", "top 0.1%"). */
export function topPercent(rank: number, count: number): string {
  if (!(rank > 0) || !(count > 0)) return '';
  const pct = (rank / count) * 100;
  if (pct < 0.1) return 'top 0.1%';
  if (pct < 1) return `top ${(Math.ceil(pct * 10) / 10).toFixed(1)}%`;
  return `top ${Math.ceil(pct)}%`;
}
