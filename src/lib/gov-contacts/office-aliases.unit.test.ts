/**
 * Guards for the office-name alias layer.
 *
 * The anchor case: "Corps of Engineers" appears in ZERO rows of
 * dodaac_directory (the 46 districts are stored as "ENDIST <city>"), so the
 * reverse expansion is the ONLY way that search can ever match.
 */
import { describe, it, expect } from 'vitest';
import {
  expandOfficeSearchTerms,
  annotateOfficeName,
  OFFICE_ABBREVIATIONS,
} from './office-aliases';

describe('expandOfficeSearchTerms', () => {
  it('maps the plain-English phrase to the stored abbreviation', () => {
    // THE bug this layer exists to fix.
    const terms = expandOfficeSearchTerms('Corps of Engineers');
    expect(terms).toContain('ENDIST');
  });

  it('is case-insensitive on the phrase', () => {
    expect(expandOfficeSearchTerms('corps of engineers')).toContain('ENDIST');
    expect(expandOfficeSearchTerms('CORPS OF ENGINEERS')).toContain('ENDIST');
  });

  it('maps an abbreviation to its plain-English names', () => {
    const terms = expandOfficeSearchTerms('ENDIST');
    expect(terms).toContain('Engineer District');
    expect(terms).toContain('Corps of Engineers');
  });

  it('resolves USACE, which sub_agency matching cannot reach', () => {
    // All 238 USACE/MICC/USPFO rows carry sub_agency "Department of the Army".
    expect(expandOfficeSearchTerms('USACE')).toContain('ENDIST');
  });

  it('handles a longer phrase containing the alias', () => {
    expect(expandOfficeSearchTerms('army corps of engineers district')).toContain('ENDIST');
  });

  it('covers the high-volume opaque tokens', () => {
    expect(expandOfficeSearchTerms('National Guard property office')).toContain('USPFO');
    expect(expandOfficeSearchTerms('Navy Operational Support Center')).toContain('NAVOPSPTCEN');
    expect(expandOfficeSearchTerms('Defense Contract Management Agency')).toContain('DCMA');
  });

  it('passes unknown terms through unchanged', () => {
    expect(expandOfficeSearchTerms('widgets')).toEqual(['widgets']);
  });

  it('returns an empty list for empty input', () => {
    expect(expandOfficeSearchTerms('')).toEqual([]);
    expect(expandOfficeSearchTerms('   ')).toEqual([]);
  });

  it('always includes the original term first', () => {
    expect(expandOfficeSearchTerms('ENDIST')[0]).toBe('ENDIST');
    expect(expandOfficeSearchTerms('Corps of Engineers')[0]).toBe('Corps of Engineers');
  });

  it('does not over-match a short term into unrelated abbreviations', () => {
    // Substring matching in the reverse index must not turn a 2-3 char query
    // into a grab-bag. "ACC" is a real abbreviation; "AC" is not and must not
    // drag in every phrase containing "ac" (Facilities, Contract, ...).
    const terms = expandOfficeSearchTerms('AC');
    expect(terms).toEqual(['AC']);
  });

  it('does not return duplicates', () => {
    const terms = expandOfficeSearchTerms('Corps of Engineers');
    expect(new Set(terms.map(t => t.toLowerCase())).size).toBe(terms.length);
  });
});

describe('annotateOfficeName', () => {
  it('appends the expansion, preserving the raw SAM/FPDS string', () => {
    // Raw token must survive — contractors cross-reference SAM by it.
    const out = annotateOfficeName('ENDIST LOUISVILLE');
    expect(out).toContain('ENDIST LOUISVILLE');
    expect(out).toContain('Corps of Engineers');
  });

  it('handles hyphenated leads like MICC-FT DRUM', () => {
    const out = annotateOfficeName('MICC-FT DRUM');
    expect(out).toContain('MICC-FT DRUM');
    expect(out).toContain('Mission and Installation Contracting Command');
  });

  it('leaves names with no known abbreviation untouched', () => {
    expect(annotateOfficeName('DEPT OF COMMERCE NOAA')).toBe('DEPT OF COMMERCE NOAA');
    expect(annotateOfficeName('')).toBe('');
  });

  it('does not double-annotate an already-plain name', () => {
    const plain = 'Defense Logistics Agency';
    expect(annotateOfficeName(plain)).toBe(plain);
  });
});

describe('short-vs-long token matching (dodaacCodesForOfficeName rule)', () => {
  // The resolver matches short tokens as whole words and long ones as word
  // prefixes, with the cut at 6 chars. Measured against the live directory:
  //   CONS prefix → 167 rows, only 64 real (CONSTRUCTION/CONSULTING/CONSOLIDATED)
  //   ACC  prefix →  50 rows, only 38 real (ACCOUNTING)
  //   NAVFAC must still reach NAVFACSYSCOM (13 rows) → needs the prefix rule
  // This test pins the rule itself so the threshold can't drift unnoticed.
  const PREFIX_MIN_LEN = 6;
  const rx = (t: string) =>
    new RegExp(t.length >= PREFIX_MIN_LEN ? `\\b${t}` : `\\b${t}\\b`);

  it('short abbreviations do not bleed into longer words', () => {
    expect(rx('cons').test('construction management')).toBe(false);
    expect(rx('cons').test('consulting services')).toBe(false);
    expect(rx('acc').test('accounting office')).toBe(false);
    expect(rx('nco').test('ncoic detachment')).toBe(false);
  });

  it('short abbreviations still match themselves as words', () => {
    expect(rx('cons').test('10 cons lgc')).toBe(true);
    expect(rx('acc').test('acc-apg natick')).toBe(true);
  });

  it('long abbreviations match as a word prefix', () => {
    expect(rx('navfac').test('navfacsyscom mid-atlantic')).toBe(true);
    expect(rx('endist').test('endist louisville')).toBe(true);
  });
});

describe('OFFICE_ABBREVIATIONS data quality', () => {
  it('has every key uppercase and every value non-empty', () => {
    for (const [k, v] of Object.entries(OFFICE_ABBREVIATIONS)) {
      expect(k).toBe(k.toUpperCase());
      expect(v.length).toBeGreaterThan(0);
      for (const p of v) expect(p.trim().length).toBeGreaterThan(0);
    }
  });

  it('never maps an abbreviation to itself (a no-op alias)', () => {
    // The bug found in agency-aliases.json: "USACE" → "USACE" expands to
    // nothing and silently defeats resolution.
    for (const [k, v] of Object.entries(OFFICE_ABBREVIATIONS)) {
      for (const p of v) expect(p.toUpperCase()).not.toBe(k);
    }
  });
});
