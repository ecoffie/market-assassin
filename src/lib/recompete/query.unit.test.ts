import { describe, it, expect } from 'vitest';
import { parseNaicsCodes, naicsOrExpression } from './query';

/**
 * Multi-NAICS semantics for the SHARED recompete query (issue #301).
 *
 * This lib is used by /api/recompete (the Recompetes panel), the briefings
 * fpds-recompete pipeline, and the MCP `get_expiring_contracts` tool — one fix,
 * every surface. A user profile carries 3-5 NAICS codes; `naics?: string` could
 * only ever express the first one.
 */
describe('parseNaicsCodes', () => {
  it('splits a comma-separated list (what /api/recompete?naics= now accepts)', () => {
    expect(parseNaicsCodes('236220,541512')).toEqual(['236220', '541512']);
  });

  it('accepts spaces and mixed separators (the panel joins with ", ")', () => {
    expect(parseNaicsCodes('236220, 541512 541611')).toEqual(['236220', '541512', '541611']);
  });

  it('accepts an array', () => {
    expect(parseNaicsCodes(['236220', '541512'])).toEqual(['236220', '541512']);
  });

  it('keeps prefix-length codes (a 3-digit subsector is a legitimate filter)', () => {
    expect(parseNaicsCodes('236,237,238')).toEqual(['236', '237', '238']);
  });

  it('dedupes and preserves order', () => {
    expect(parseNaicsCodes('541512,236220,541512')).toEqual(['541512', '236220']);
  });

  it('drops non-numeric junk — these values are interpolated into a PostgREST .or()', () => {
    expect(parseNaicsCodes('541512,DROP TABLE,naics_code.eq.1')).toEqual(['541512']);
    expect(parseNaicsCodes('*')).toEqual([]);
    expect(parseNaicsCodes('%')).toEqual([]);
  });

  it('drops codes outside 2-6 digits', () => {
    expect(parseNaicsCodes('1,5415123,236220')).toEqual(['236220']);
  });

  it('returns [] for empty/nullish input (callers fall back to legacy `naics`)', () => {
    expect(parseNaicsCodes(undefined)).toEqual([]);
    expect(parseNaicsCodes(null)).toEqual([]);
    expect(parseNaicsCodes('')).toEqual([]);
    expect(parseNaicsCodes([])).toEqual([]);
  });
});

describe('naicsOrExpression', () => {
  it('ORs 6-digit codes as EXACT matches', () => {
    expect(naicsOrExpression(['236220', '541512'])).toBe(
      'naics_code.eq.236220,naics_code.eq.541512',
    );
  });

  it('treats a <6-char code as a PREFIX match, preserving single-code semantics', () => {
    expect(naicsOrExpression(['236'])).toBe('naics_code.like.236%');
  });

  it('mixes prefix and exact codes in one OR group', () => {
    expect(naicsOrExpression(['236', '541512'])).toBe(
      'naics_code.like.236%,naics_code.eq.541512',
    );
  });

  it('uses % (not *) as the LIKE wildcard — * silently returns 0 rows in PostgREST', () => {
    expect(naicsOrExpression(['238'])).toContain('238%');
    expect(naicsOrExpression(['238'])).not.toContain('*');
  });

  it('is empty for no codes (callers must not attach an empty .or())', () => {
    expect(naicsOrExpression([])).toBe('');
  });
});
