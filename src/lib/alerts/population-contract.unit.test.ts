import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ctaContractViolations, scopesAgree, isNewnessClaimHonest, fallbackUnsafeClaim } from './population-contract';

/**
 * The three real incidents, replayed as fixtures. Each asserts the SEMANTIC contract —
 * which population was counted vs which one the link lands on — rather than copy strings,
 * so the wording can evolve without weakening the check.
 */
describe('the incidents this contract exists to catch', () => {
  it('C6 — counted the whole market, linked to a 3-strand slice', () => {
    const v = ctaContractViolations(
      { count: 830, label: 'Explore all 830 in this market', scope: { sources: ['contracts'], window: null } },
      { sources: ['contracts'], window: null, filters: ['set_aside', 'closes_soon', 'repeat_buyer'] },
    );
    expect(v.join(' ')).toMatch(/destination narrows by/);
  });

  it('C8 — counted a 24h window, landed somewhere with no time bound', () => {
    const v = ctaContractViolations(
      { count: 17, label: 'View all 17 new matches',
        scope: { sources: ['contracts'], window: { field: 'posted_date', days: 1 } } },
      { sources: ['contracts'], window: null },
    );
    expect(v.join(' ')).toMatch(/not time-bounded/);
  });

  it('C9 — counted grants the destination does not render', () => {
    const v = ctaContractViolations(
      { count: 10, label: 'View all 10 new matches',
        scope: { sources: ['contracts', 'grants'], window: { field: 'posted_date', days: 1 } } },
      { sources: ['contracts'], window: { field: 'posted_date', days: 1 } },
    );
    expect(v.join(' ')).toMatch(/counts grants the destination does not show/);
  });

  it('C9 fallback — nothing was new, so "new" is false regardless of scope', () => {
    // The substitution is fine. Calling the result "new" is not. Unknown is not new.
    const claim = { count: 12, label: '12 new opportunities',
      scope: { sources: ['contracts' as const], window: { field: 'posted_date' as const, days: 1 } } };
    expect(isNewnessClaimHonest(claim, { usingFallback: true })).toBe(false);
    expect(isNewnessClaimHonest(claim, { usingFallback: false })).toBe(true);
  });
});

describe('fallback data inherits fallback semantics', () => {
  it('flags words that depended on the original data path', () => {
    // "new" is caught by the window check; these are not, and they make the same claim.
    for (const w of ['latest', 'fresh', 'just posted']) {
      expect(fallbackUnsafeClaim(`The ${w} matches for you`), w).toBeTruthy();
    }
  });

  it('allows language that survives substitution', () => {
    for (const ok of ['Explore this market', 'Still open in your market', '12 matching contracts']) {
      expect(fallbackUnsafeClaim(ok), ok).toBeNull();
    }
  });

  it('reports the violation when a fallback surface keeps the claim', () => {
    const scope = { sources: ['contracts' as const], window: null };
    const v = ctaContractViolations(
      { count: 12, label: 'The latest matches for you', scope }, scope, { usingFallback: true },
    );
    expect(v.join(' ')).toMatch(/cannot survive fallback data/);
  });
});

describe('the contract holds when populations genuinely agree', () => {
  it('same sources, same window, same filters → no violation', () => {
    const scope = { sources: ['contracts' as const], window: { field: 'posted_date' as const, days: 1 } };
    expect(ctaContractViolations({ count: 17, label: 'View all 17 new matches', scope }, scope)).toEqual([]);
  });

  it('a label with no time claim does not need a window', () => {
    const scope = { sources: ['contracts' as const], window: null };
    expect(ctaContractViolations({ count: 830, label: 'Explore this market', scope }, scope)).toEqual([]);
  });

  it('filter order does not matter — this is set equality, not string equality', () => {
    expect(scopesAgree(
      { sources: ['contracts'], window: null, filters: ['a', 'b'] },
      { sources: ['contracts'], window: null, filters: ['b', 'a'] },
    )).toBe(true);
  });
});

describe('the shipped surfaces satisfy the contract', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  it('daily-alerts no longer prints a grants-inclusive count on a contracts-only CTA', () => {
    const SRC = read('src/app/api/cron/daily-alerts/route.ts');
    // totalCount = contracts + grants; moreCount and the panel are contracts-only.
    expect(SRC).not.toMatch(/View all \$\{totalCount\} new matches/);
    expect(SRC).toMatch(/ctaLabel = isUsingFallback/);
  });

  it('daily-alerts drops the "new" claim on the fallback path — subject and header', () => {
    const SRC = read('src/app/api/cron/daily-alerts/route.ts');
    expect(SRC).toMatch(/subject: isUsingFallback/);
    expect(SRC).toMatch(/isUsingFallback \? 'Still open in your market' : 'New today'/);
  });

  it('the fallback flag actually reaches the email — it was computed and ignored for months', () => {
    const SRC = read('src/app/api/cron/daily-alerts/route.ts');
    expect(SRC).toMatch(/todaysLens,\s*\n\s*isUsingFallback,/);
  });
});
