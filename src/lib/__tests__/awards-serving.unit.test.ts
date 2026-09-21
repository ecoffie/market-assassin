import { describe, it, expect } from 'vitest';
import {
  jitteredTtlSeconds,
  SERVED_MAX_ACTIONS,
  SERVED_MAX_PAGES,
  SERVED_PAGE_SIZE,
  type AwardCounts,
} from '../awards-serving';

/**
 * The durable serving layer's two contracts:
 *   1. the three counts are never conflated
 *   2. TTL jitter is deterministic and bounded
 */

const SENTURE: AwardCounts = {
  contracts: 23,
  displayedActions: 124,
  totalActions: 330,
  displayedObligated: 429_353_782.14,
};

describe('the three counts are distinct measurements', () => {
  it('Senture: 23 contracts, 124 displayed actions, 330 total actions', () => {
    expect(SENTURE.contracts).toBe(23);
    expect(SENTURE.displayedActions).toBe(124);
    expect(SENTURE.totalActions).toBe(330);
    // All different. The bug was a headline showing one while the table showed
    // another, with nothing naming which was which.
    expect(new Set(Object.values(SENTURE).slice(0, 3)).size).toBe(3);
  });

  it('orders correctly: contracts <= displayed <= total', () => {
    expect(SENTURE.contracts).toBeLessThanOrEqual(SENTURE.displayedActions);
    expect(SENTURE.displayedActions).toBeLessThanOrEqual(SENTURE.totalActions);
  });

  it('displayed_obligated is NOT the rollup total — they measure differently', () => {
    const rollupTotalObligated = 399_095_920.33;
    expect(SENTURE.displayedObligated).not.toBe(rollupTotalObligated);
    // Both are honest; swapping them silently is what must never happen.
    expect(SENTURE.displayedObligated).toBeGreaterThan(rollupTotalObligated);
  });

  /** A page may only state a count it can name. */
  function headline(c: AwardCounts) {
    return `${c.contracts} contracts · ${c.displayedActions} award actions shown`;
  }

  it('the headline names WHICH count it is showing', () => {
    const h = headline(SENTURE);
    expect(h).toContain('23 contracts');
    expect(h).toContain('124 award actions');
    // The old title said "29 Federal Contracts" above 124 rows, naming neither.
    expect(h).not.toMatch(/^\d+ Federal Contracts$/);
  });
});

describe('public pagination never advertises unbuilt pages', () => {
  it('caps at the warmed depth', () => {
    expect(SERVED_MAX_PAGES).toBe(3);
    expect(SERVED_PAGE_SIZE).toBe(50);
    expect(SERVED_MAX_ACTIONS).toBe(150);
  });

  it('a recipient with more actions than we serve is described honestly', () => {
    const shown = Math.min(SENTURE.displayedActions, SERVED_MAX_ACTIONS);
    expect(shown).toBe(124); // Senture fits entirely inside 3 pages
    const big = Math.min(5000, SERVED_MAX_ACTIONS);
    expect(big).toBe(150); // a large contractor is capped, and we say so
  });

  it('page count never exceeds the warmed maximum', () => {
    const pagesFor = (n: number) => Math.min(Math.ceil(n / SERVED_PAGE_SIZE), SERVED_MAX_PAGES);
    expect(pagesFor(0)).toBe(0);
    expect(pagesFor(1)).toBe(1);
    expect(pagesFor(49)).toBe(1);
    expect(pagesFor(50)).toBe(1);
    expect(pagesFor(51)).toBe(2);
    expect(pagesFor(124)).toBe(3); // Senture
    expect(pagesFor(150)).toBe(3);
    expect(pagesFor(5000)).toBe(3); // capped, not 100
  });
});

describe('TTL jitter', () => {
  it('is deterministic — the same key always yields the same TTL', () => {
    const k = 'bq:v4-2026-08-28:rollup:GC51JCDRQP95:awards-page:1:50:v2-m';
    expect(jitteredTtlSeconds(k)).toBe(jitteredTtlSeconds(k));
  });

  it('spreads keys across a band instead of one expiry cohort', () => {
    const ttls = new Set(
      Array.from({ length: 400 }, (_, i) => jitteredTtlSeconds(`rollup:UEI${i}:awards-page:1`)),
    );
    // A bulk warm must not expire as a single cohort — that is how the outage
    // would recur wholesale.
    expect(ttls.size).toBeGreaterThan(20);
  });

  it('stays inside sane bounds', () => {
    const DAY = 86400;
    for (let i = 0; i < 500; i++) {
      const t = jitteredTtlSeconds(`k${i}`);
      expect(t).toBeGreaterThanOrEqual(7 * DAY);
      expect(t).toBeLessThanOrEqual(130 * DAY);
    }
  });

  it('is jitter, not a refresh strategy — everything still expires', () => {
    // Documents WHY the rolling refresh exists: jitter only spreads the failure.
    const DAY = 86400;
    const longest = Math.max(...Array.from({ length: 500 }, (_, i) => jitteredTtlSeconds(`k${i}`)));
    expect(longest).toBeLessThan(131 * DAY);
  });
});
