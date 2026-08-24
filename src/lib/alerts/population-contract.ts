/**
 * POPULATION CONTRACT — message → count → CTA → destination must agree.
 *
 * Three separate incidents in one day, all the same shape: a number that was correct for the
 * query that produced it, attached to a link that lands somewhere else.
 *
 *   C6  "Explore all 830 in this market"  ->  ?strategy=<3 strands>, which is 77 rows.  10.8x
 *   C8  "View all 17 new matches"         ->  /app?panel=alerts, which has NO date filter,
 *                                             so the destination is every open opp of any age
 *   C9  "View all 10 new matches"         ->  a panel that renders no grants, while the 10
 *                                             counted 6 contracts + 4 grants
 *
 * None of those were arithmetic errors. Each number was right. The CTA was the lie, because
 * it asserted that the number and the link described ONE population.
 *
 * This module makes the contract explicit so it can be asserted rather than re-litigated.
 * It deliberately holds no query logic: the point is to describe populations, not fetch them.
 */

/** What a population is scoped by. Two populations are the same only if these all match. */
export interface PopulationScope {
  /** Which corpora are counted. A count over contracts+grants cannot land on a contracts-only page. */
  sources: ('contracts' | 'grants' | 'forecasts' | 'recompetes')[];
  /**
   * Is membership bounded by time, and by which field?
   * `null` = not time-bounded. "new" claims REQUIRE a window — see isNewnessClaimHonest.
   */
  window: { field: 'posted_date' | 'response_deadline'; days: number } | null;
  /** Extra narrowing the destination must also apply (e.g. genome strands). */
  filters?: string[];
}

export interface PopulationClaim {
  /** The number shown to the user. */
  count: number;
  /** The words around it, e.g. "new matches". */
  label: string;
  /** What the number actually measured. */
  scope: PopulationScope;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** Do two scopes describe the same population? */
export function scopesAgree(a: PopulationScope, b: PopulationScope): boolean {
  if (!sameSet(a.sources, b.sources)) return false;
  if (!sameSet(a.filters ?? [], b.filters ?? [])) return false;
  if (a.window === null || b.window === null) return a.window === b.window;
  return a.window.field === b.window.field && a.window.days === b.window.days;
}

/**
 * The words "new" / "today" / "since yesterday" are a TIME claim. A destination with no time
 * bound cannot honour one, and a fallback that substituted existing rows never established
 * newness at all.
 *
 * Unknown is not new.
 */
export function isNewnessClaimHonest(claim: PopulationClaim, opts?: { usingFallback?: boolean }): boolean {
  const claimsNewness = /\b(new|today|since yesterday|just (posted|added))\b/i.test(claim.label);
  if (!claimsNewness) return true;
  if (opts?.usingFallback) return false;   // nothing was new; we substituted
  return claim.scope.window !== null;
}

/**
 * The one check worth running on every distribution surface.
 *
 * Returns the reasons a CTA misdescribes its destination — empty means the contract holds.
 * A count MAY legitimately differ from its destination (C6's 830 vs 77 was real), but then
 * the copy has to name both populations rather than implying one.
 */
export function ctaContractViolations(
  claim: PopulationClaim,
  destination: PopulationScope,
  opts?: { usingFallback?: boolean },
): string[] {
  const out: string[] = [];

  if (!isNewnessClaimHonest(claim, opts)) {
    out.push(
      opts?.usingFallback
        ? `"${claim.label}" claims newness, but these are fallback rows — nothing was new`
        : `"${claim.label}" claims newness, but the population has no time window`,
    );
  }

  if (!scopesAgree(claim.scope, destination)) {
    const missing = claim.scope.sources.filter((x) => !destination.sources.includes(x));
    if (missing.length) {
      out.push(`counts ${missing.join(' + ')} the destination does not show`);
    }
    if (claim.scope.window && !destination.window) {
      out.push(`counted a ${claim.scope.window.days}-day window; the destination is not time-bounded`);
    }
    const extra = (destination.filters ?? []).filter((f) => !(claim.scope.filters ?? []).includes(f));
    if (extra.length) {
      out.push(`the destination narrows by ${extra.join(', ')}, which the count did not`);
    }
  }

  return out;
}
