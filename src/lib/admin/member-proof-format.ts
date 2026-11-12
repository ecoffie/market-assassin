/** Client-safe formatting for the public member-proof line (no KV import). */
export type MemberProof = {
  /** Lifetime federal dollars won by member companies (real companies only; staff/demo excluded). */
  lifetimeDollars: number;
  companiesWithWins: number;
  contracts: number;
  /** Real (non-staff) accounts with Mindy alert settings. */
  members: number;
  computedAt: string;
};

/** "$1.3B" — rounded DOWN so the claim never overstates. */
export function proofDollars(n: number): string {
  if (n >= 1e9) return `$${(Math.floor(n / 1e8) / 10).toFixed(1)}B`;
  if (n >= 1e6) return `$${Math.floor(n / 1e6)}M`;
  return `$${Math.floor(n / 1e3)}K`;
}

/** "1,700+" — rounded DOWN to the hundred. */
export function proofCount(n: number): string {
  return n >= 100 ? `${(Math.floor(n / 100) * 100).toLocaleString('en-US')}+` : String(n);
}
