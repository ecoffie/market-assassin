/** Client-safe formatting for the public member-proof line (no KV import). */
export type MemberProof = {
  /** Lifetime federal dollars won by member companies (real companies only; staff/demo excluded). */
  lifetimeDollars: number;
  companiesWithWins: number;
  contracts: number;
  /** Real (non-staff) accounts with Mindy alert settings. */
  members: number;
  computedAt: string;
  /**
   * Added for the public /customers page (2026-11-13). Optional so a snapshot written before this
   * shipped still reads; /api/public/customer-stats reports `available:false` until it has them.
   * Aggregates only: nothing here names or identifies a company.
   */
  sinceJoining?: { dollars: number; contracts: number; companiesWithWins: number };
  /** Distinct member companies with a valid SAM UEI saved: the population every number is about. */
  companiesWithUei?: number;
  breakdowns?: {
    agencies: StatBucketSet;
    naics: StatBucketSet;
    fiscalYears: StatBucket[];
    /** Smallest number of companies any shown bucket may hold. */
    minCompaniesPerBucket: number;
  };
};

export type StatBucket = { key: string; label: string; dollars: number; contracts: number; companies: number };
export type StatBucketSet = {
  buckets: StatBucket[];
  /** Everything not shown as its own bucket (unlabelled). null when nothing was folded. */
  other: { dollars: number; contracts: number; companies: number } | null;
};

/** What /api/public/customer-stats returns when the snapshot is complete and fresh. */
export type CustomerStats = {
  members: number;
  computedAt: string;
  companiesWithUei: number;
  lifetime: { dollars: number; contracts: number; companiesWithWins: number };
  sinceJoining: { dollars: number; contracts: number; companiesWithWins: number };
  breakdowns: NonNullable<MemberProof['breakdowns']>;
};

/** Public projection of a snapshot: aggregates only, or null when the snapshot lacks the new fields. */
export function toCustomerStats(p: MemberProof | null | undefined): CustomerStats | null {
  if (!p || !p.sinceJoining || !p.breakdowns || !(Number(p.companiesWithUei) > 0)) return null;
  const set = (s: StatBucketSet): StatBucketSet => ({
    buckets: s.buckets.map(({ key, label, dollars, contracts, companies }) => ({ key, label, dollars, contracts, companies })),
    other: s.other ? { dollars: s.other.dollars, contracts: s.other.contracts, companies: s.other.companies } : null,
  });
  return {
    members: p.members,
    computedAt: p.computedAt,
    companiesWithUei: Number(p.companiesWithUei),
    lifetime: { dollars: p.lifetimeDollars, contracts: p.contracts, companiesWithWins: p.companiesWithWins },
    sinceJoining: {
      dollars: p.sinceJoining.dollars, contracts: p.sinceJoining.contracts, companiesWithWins: p.sinceJoining.companiesWithWins,
    },
    breakdowns: {
      agencies: set(p.breakdowns.agencies),
      naics: set(p.breakdowns.naics),
      fiscalYears: p.breakdowns.fiscalYears.map(({ key, label, dollars, contracts, companies }) => ({ key, label, dollars, contracts, companies })),
      minCompaniesPerBucket: p.breakdowns.minCompaniesPerBucket,
    },
  };
}

/** "$1.3B" — rounded DOWN so the claim never overstates. */
export function proofDollars(n: number): string {
  if (n >= 1e9) return `$${(Math.floor(n / 1e8) / 10).toFixed(1)}B`;
  if (n >= 1e6) return `$${Math.floor(n / 1e6)}M`;
  if (n >= 1e3) return `$${Math.floor(n / 1e3)}K`;
  return `$${Math.max(0, Math.floor(n))}`;
}

/** "1,700+" — rounded DOWN to the hundred. */
export function proofCount(n: number): string {
  return n >= 100 ? `${(Math.floor(n / 100) * 100).toLocaleString('en-US')}+` : String(n);
}
