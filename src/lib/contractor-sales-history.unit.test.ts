import { describe, expect, it } from 'vitest';
import {
  getQueryCandidates,
  normalizeCompanyName,
  scoreRecipientMatch,
} from './contractor-sales-history';

// Regression coverage for issue #279: get_contractor_award_history returned
// ANDURIL INDUSTRIES' $4.1B portfolio for "J & J MAINTENANCE INC".

describe('normalizeCompanyName', () => {
  it('rewrites & to the word "and"', () => {
    expect(normalizeCompanyName('J & J MAINTENANCE INC')).toBe('j and j maintenance');
  });
});

describe('getQueryCandidates', () => {
  it('never emits the stopword "and" as a bare candidate (issue #279)', () => {
    const candidates = getQueryCandidates('J & J MAINTENANCE INC');
    expect(candidates).not.toContain('and');
  });

  it('does not emit any candidate that would ilike-match ANDURIL', () => {
    const candidates = getQueryCandidates('J & J MAINTENANCE INC');
    const anduril = 'anduril industries, inc.';
    const overBroad = candidates.filter((c) => anduril.includes(c.toLowerCase()));
    expect(overBroad).toEqual([]);
  });

  it('drops a short leading word plucked out of a longer name', () => {
    // "jmt" survives the >2 length filter but is too short a fragment to query
    // on its own; the two-word candidate is still worth trying.
    const candidates = getQueryCandidates('JMT ENGINEERING SERVICES');
    expect(candidates).not.toContain('jmt');
    expect(candidates).toContain('jmt engineering');
  });

  it('keeps a short name when it IS the whole company, not a fragment', () => {
    // "abc" is the full normalized name of "ABC LLC" (the suffix is stripped),
    // so it must stay queryable. Over-broad hits are rejected downstream by
    // scoreRecipientMatch, not by suppressing the only candidate we have.
    expect(getQueryCandidates('ABC LLC')).toContain('abc');
  });

  it('still produces useful candidates for a normal multi-word name', () => {
    const candidates = getQueryCandidates('LOCKHEED MARTIN CORPORATION');
    expect(candidates).toContain('lockheed martin');
    expect(candidates).toContain('lockheed');
  });
});

describe('scoreRecipientMatch', () => {
  it('rejects the J&J -> Anduril match (issue #279)', () => {
    expect(scoreRecipientMatch('j and j maintenance', 'ANDURIL INDUSTRIES, INC.')).toBe('low');
  });

  it('scores an exact normalized match high', () => {
    expect(scoreRecipientMatch('j and j maintenance', 'J & J MAINTENANCE INC')).toBe('high');
  });

  it('scores a same-family superset medium', () => {
    expect(
      scoreRecipientMatch('j and j maintenance', 'J & J MAINTENANCE SERVICES OF TEXAS LLC')
    ).toBe('medium');
  });

  it('matches token-wise, not substring-wise', () => {
    // "ace" is a substring of "pace" but not a token of it.
    expect(scoreRecipientMatch('ace', 'PACE INDUSTRIES INC')).toBe('low');
  });

  it('treats an empty or null recipient as no match', () => {
    expect(scoreRecipientMatch('j and j maintenance', null)).toBe('low');
    expect(scoreRecipientMatch('j and j maintenance', '')).toBe('low');
  });

  it('treats an empty company as no match rather than matching everything', () => {
    expect(scoreRecipientMatch('', 'ANDURIL INDUSTRIES, INC.')).toBe('low');
  });
});
