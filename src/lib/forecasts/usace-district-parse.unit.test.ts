/**
 * USACE district forecast parsing.
 *
 * These forecasts are a MANUAL DROP because every usace.army.mil host sits
 * behind an Akamai edge WAF that 403s unattended fetches (verified 2026-08-01),
 * and no official feed carries Army/USACE. So correctness here matters more
 * than usual: a human spends effort downloading each file, and a silent
 * mis-parse wastes that effort while looking like a thin district.
 */
import { describe, it, expect } from 'vitest';
import {
  parseMoney, parseMoneyRange, parseNaics, parseFiscalYear, parseQuarter,
  parseSetAside, parseDate, parseUsaceForecastText, usaceExternalId,
} from './usace-district-parse';

describe('parseMoney', () => {
  it('handles the shapes districts actually publish', () => {
    expect(parseMoney('$1,500,000')).toBe(1_500_000);
    expect(parseMoney('5,000,000.00')).toBe(5_000_000);
    expect(parseMoney('$1.5M')).toBe(1_500_000);
    expect(parseMoney('$250K')).toBe(250_000);
    expect(parseMoney('$2B')).toBe(2_000_000_000);
  });
  it('returns undefined rather than 0 for absent/garbage values', () => {
    // 0 would render as "$0" on a card — a wrong fact, not a missing one.
    expect(parseMoney('')).toBeUndefined();
    expect(parseMoney('TBD')).toBeUndefined();
    expect(parseMoney(null)).toBeUndefined();
  });
});

describe('parseMoneyRange', () => {
  it('keeps a range as a range', () => {
    // USACE quotes ranges far more often than point estimates; collapsing one
    // to a single number would overstate precision.
    expect(parseMoneyRange('$1M - $5M')).toEqual({ min: 1e6, max: 5e6 });
    expect(parseMoneyRange('Between $250,000 and $1,000,000')).toEqual({ min: 250_000, max: 1e6 });
    expect(parseMoneyRange('$10M to $25M')).toEqual({ min: 1e7, max: 2.5e7 });
  });
  it('treats a single figure as both bounds', () => {
    expect(parseMoneyRange('$750,000')).toEqual({ min: 750_000, max: 750_000 });
  });
  it('returns empty for no figure', () => {
    expect(parseMoneyRange('TBD')).toEqual({});
  });
});

describe('field parsers', () => {
  it('pulls a 6-digit NAICS', () => {
    expect(parseNaics('Dredging 237990 Q2')).toBe('237990');
    expect(parseNaics('no code here')).toBeUndefined();
  });

  it('normalises fiscal year and rejects stray 4-digit numbers', () => {
    expect(parseFiscalYear('FY26')).toBe('FY2026');
    expect(parseFiscalYear('FY 2027')).toBe('FY2027');
    expect(parseFiscalYear('2028')).toBe('FY2028');
    // A dollar amount or a project number must not become a fiscal year.
    expect(parseFiscalYear('contract 1234')).toBeUndefined();
    expect(parseFiscalYear('')).toBeUndefined();
  });

  it('normalises the quarter forms districts use', () => {
    expect(parseQuarter('Q3')).toBe('Q3');
    expect(parseQuarter('3rd Quarter')).toBe('Q3');
    expect(parseQuarter('Quarter 1')).toBe('Q1');
    expect(parseQuarter('none')).toBeUndefined();
  });

  it('maps set-asides to the app vocabulary, most specific first', () => {
    // "8(a)" and "SDVOSB" both contain "small business" in their long forms,
    // so ordering is load bearing.
    expect(parseSetAside('8(a) Set-Aside')).toBe('8(a)');
    expect(parseSetAside('Service-Disabled Veteran-Owned Small Business')).toBe('SDVOSB');
    expect(parseSetAside('HUBZone Small Business')).toBe('HUBZone');
    expect(parseSetAside('Women-Owned Small Business')).toBe('WOSB');
    expect(parseSetAside('Total Small Business Set-Aside')).toBe('Small Business');
    expect(parseSetAside('Full and Open')).toBe('Full and Open');
    expect(parseSetAside('')).toBeUndefined();
  });

  it('parses dates to ISO', () => {
    expect(parseDate('07/15/2026')).toBe('2026-07-15');
    expect(parseDate('7/1/26')).toBe('2026-07-01');
    expect(parseDate('2026-09-30')).toBe('2026-09-30');
    expect(parseDate('TBD')).toBeUndefined();
  });
});

describe('parseUsaceForecastText', () => {
  // Shaped like real district PDF text after extraction (table rows collapse
  // to single lines).
  const SAMPLE = [
    'USACE Louisville District FY2026-2028 Acquisition Forecast',
    'As of 01 July 2026',
    'Project / Requirement                NAICS    Value            FY   Qtr  Set-Aside',
    'Levee Rehabilitation Ohio River Mile 604   237990   $5,000,000 - $10,000,000   FY2026  Q2  Small Business',
    'Roof Replacement Building 210 Fort Knox    238160   $1,500,000   FY2026  Q3  8(a) Set-Aside',
    'Dredging Services Green River             237990   $750,000     FY2027  Q1  HUBZone',
    'Page 2 of 4',
    'This forecast is for informational purposes only and subject to change.',
  ].join('\n');

  it('extracts the real rows and ignores boilerplate', () => {
    const r = parseUsaceForecastText(SAMPLE);
    expect(r.rows.length).toBe(3);
    const titles = r.rows.map(x => x.title);
    expect(titles[0]).toContain('Levee Rehabilitation');
    expect(titles[1]).toContain('Roof Replacement');
    // Page furniture and disclaimers must not become forecasts.
    expect(titles.join(' ')).not.toMatch(/Page 2|informational purposes|As of/);
  });

  it('pulls the structured fields off each row', () => {
    const [levee, roof, dredge] = parseUsaceForecastText(SAMPLE).rows;
    expect(levee.naicsCode).toBe('237990');
    expect(levee.estimatedValueMin).toBe(5e6);
    expect(levee.estimatedValueMax).toBe(1e7);
    expect(levee.fiscalYear).toBe('FY2026');
    expect(levee.anticipatedQuarter).toBe('Q2');
    expect(levee.setAside).toBe('Small Business');
    expect(roof.setAside).toBe('8(a)');
    expect(dredge.setAside).toBe('HUBZone');
  });

  it('strips the structured bits out of the title', () => {
    const [levee] = parseUsaceForecastText(SAMPLE).rows;
    expect(levee.title).not.toMatch(/237990|\$|FY2026|Q2/);
  });

  it('leaves no stray punctuation from a stripped set-aside', () => {
    // REGRESSION (caught on a real PDF run): stripping "8(a)" via a \b-prefixed
    // pattern left the closing paren behind, so the title read
    // "Roof Replacement Building 210 Fort Knox ) Set-Aside".
    const [, roof] = parseUsaceForecastText(SAMPLE).rows;
    expect(roof.title).toBe('Roof Replacement Building 210 Fort Knox');
    expect(roof.title).not.toMatch(/[()]|set[-\s]?aside/i);
  });

  it('keeps the raw source line so a wrong parse is auditable', () => {
    const [levee] = parseUsaceForecastText(SAMPLE).rows;
    expect(levee.raw).toContain('237990');
  });

  it('reports an unparseable document instead of returning silence', () => {
    // The failure mode worth surfacing: a new district layout yields 0 rows,
    // which must read as "parser needs work", not "thin district".
    const r = parseUsaceForecastText('Some prose with no forecast data at all.');
    expect(r.rows.length).toBe(0);
    expect(r.layout).toBe('unknown');
  });

  it('does not emit a row whose title is only a fragment', () => {
    // A line with signals but no project name is skipped and COUNTED.
    const r = parseUsaceForecastText('237990  $5,000,000  FY2026  Q2');
    expect(r.rows.length).toBe(0);
    expect(r.skipped).toBeGreaterThan(0);
  });
});

describe('usaceExternalId', () => {
  it('is deterministic so a re-drop updates instead of duplicating', () => {
    const a = usaceExternalId('ENDIST LOUISVILLE', 'Levee Rehabilitation Ohio River');
    const b = usaceExternalId('ENDIST LOUISVILLE', 'Levee Rehabilitation Ohio River');
    expect(a).toBe(b);
    expect(a.startsWith('USACE-')).toBe(true);
  });

  it('separates districts that share a project name', () => {
    expect(usaceExternalId('ENDIST LOUISVILLE', 'Roof Replacement'))
      .not.toBe(usaceExternalId('ENDIST GALVESTON', 'Roof Replacement'));
  });
});
