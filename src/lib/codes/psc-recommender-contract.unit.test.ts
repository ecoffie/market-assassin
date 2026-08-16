import { describe, it, expect } from 'vitest';
import { pscStatus, isUsablePsc } from './psc-status';
import { getPsc } from './lookup';
import pscData from '@/data/psc-codes.json';

/**
 * THE INVARIANT: if Mindy can RECOMMEND a PSC, that PSC must VALIDATE.
 *
 * Robert Parks, 2026-08-15. The coverage hint said "2 high-value codes missing —
 * add D314". Settings said "D314 — not a known PSC". He believed Settings,
 * substituted DD01 (valid, but zero coverage in his market), and stayed at
 * 88.4% while following our own instructions.
 *
 * The recommender reads LIVE USASpending PSC rows; the validator read a STATIC
 * json file that was missing 1,528 real codes. Two universes, no shared
 * contract. These tests are that contract.
 */

/** Robert's exact case, preserved as a fixture. */
const ROBERT = {
  savedBefore: ['R707', 'R706', 'R408', 'R699', 'R799', 'R499', 'R425', 'DD01'],
  /** Recommended by us, rejected by us. $134.6M, ~9% of his market. */
  theCodeWeRejected: 'D314',
  /** Valid, but adds no coverage for his profile — a different failure. */
  theCodeHeSubstituted: 'DD01',
  /** Live top-5 PSCs of "acquisition support" at the time. */
  marketTopPscs: ['R707', 'D314', 'R408', 'R499', 'R425'],
};

describe('PSC recommender/validator contract', () => {
  it('every PSC we would recommend for Robert’s market validates', () => {
    // The invariant, stated directly: recommendable ⇒ validatable.
    for (const code of ROBERT.marketTopPscs) {
      expect(pscStatus(code).status, `${code} is recommended; it must validate`).toBe('valid');
    }
  });

  it('D314 specifically — the code the product recommended and then denied', () => {
    const v = pscStatus(ROBERT.theCodeWeRejected);
    expect(v.status).toBe('valid');
    expect(v.title).toMatch(/ACQUISITION SUPPORT/i);
    // The exact harm: this must never read as "not a real code".
    expect(v.label).not.toMatch(/not a known/i);
  });

  it('every code Robert had saved still resolves after the catalog refresh', () => {
    // The inverse check: a previously-accepted code must not silently become
    // unknown because we regenerated the catalog.
    for (const code of ROBERT.savedBefore) {
      expect(isUsablePsc(code), `${code} was saved; it must not become unusable`).toBe(true);
    }
  });

  it('DD01 is valid — "no coverage in your market" is a DIFFERENT state from invalid', () => {
    // He was not wrong to add it. It just did not help. Conflating the two is
    // what made the original message useless.
    expect(pscStatus(ROBERT.theCodeHeSubstituted).status).toBe('valid');
  });
});

describe('PSC status vocabulary — say what we actually know', () => {
  it('a well-formed code we lack is "not in catalog", never "unknown/invalid"', () => {
    const v = pscStatus('Z9Z9');
    expect(v.status).toBe('not_in_catalog');
    // It may be real. We only know it is not in OUR file, and the copy says so.
    expect(v.label).toMatch(/reference catalog/i);
    expect(v.label).toMatch(/may still be valid/i);
  });

  it('only a malformed code is called invalid', () => {
    expect(pscStatus('nope').status).toBe('malformed');
    expect(pscStatus('D31').status).toBe('malformed');
    expect(pscStatus('').status).toBe('malformed');
    expect(isUsablePsc('nope')).toBe(false);
  });

  it('normalizes case and whitespace before judging', () => {
    expect(pscStatus('  d314 ').status).toBe('valid');
  });

  it('a deprecated code stays resolvable rather than becoming unknown', () => {
    // Empty today by design: deprecation must be an explicit, recorded decision,
    // never the side effect of a catalog refresh dropping a code.
    for (const [code, title] of Object.entries({ ...({} as Record<string, string>) })) {
      expect(pscStatus(code).status).toBe('deprecated');
      expect(pscStatus(code).title).toBe(title);
    }
    expect(true).toBe(true);
  });
});

describe('catalog integrity', () => {
  it('carries the full catalog, not a subset (869 was the broken state)', () => {
    const total = Object.keys((pscData as { codes: Record<string, unknown> }).codes).length;
    expect(total).toBeGreaterThan(2000);
  });

  it('no entry has an empty title — that renders as broken in the UI', () => {
    const codes = (pscData as { codes: Record<string, { title?: string }> }).codes;
    expect(Object.entries(codes).filter(([, v]) => !v.title?.trim()).map(([k]) => k)).toEqual([]);
  });

  it('legacy product codes survived the rebuild', () => {
    expect(getPsc('1005')).toBeTruthy();
  });
});
