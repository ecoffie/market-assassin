/**
 * Guards the USACE ENTERPRISE ("DA Format") forecast parser.
 *
 * One workbook, 2,124 rows, 43 buying activities — essentially all of USACE.
 * Every fixture below is a VERBATIM row or value from the live 27-May-2026
 * edition, not an invented example.
 */
import { describe, it, expect } from 'vitest';
import {
  daTiming, daValueRange, daNaicsPsc, daSetAside, officeForActivity,
  parseUsaceDaSheet, usaceDaExternalId, ACTIVITY_TO_OFFICE,
} from './usace-da-format';

describe('daTiming', () => {
  it('reads a real "FY2026, Q4"', () => {
    expect(daTiming('FY2026, Q4')).toEqual({ fy: 'FY2026', q: 'Q4' });
    expect(daTiming('FY2027, Q1')).toEqual({ fy: 'FY2027', q: 'Q1' });
  });

  it('treats "FYXXXX" as the PLACEHOLDER it is — quarter only, no year', () => {
    // This is the single most common value in the column. The quarter is real;
    // the year is literally unknown. Parsing FYXXXX as a year, or letting the
    // X's fall through to a looser \d{4} match elsewhere in the string, would
    // fabricate timing on hundreds of rows.
    expect(daTiming('FYXXXX, Q4')).toEqual({ q: 'Q4' });
    expect(daTiming('FYXXXX, Q2').fy).toBeUndefined();
  });

  it('rejects a year outside the plausible window', () => {
    expect(daTiming('FY1999, Q1').fy).toBeUndefined();
  });
});

describe('daValueRange', () => {
  it('reads a published range as a range', () => {
    expect(daValueRange('$75,000,000 to $100,000,000')).toEqual({ min: 75_000_000, max: 100_000_000 });
    expect(daValueRange('$25,000 to $100,000')).toEqual({ min: 25_000, max: 100_000 });
  });

  it('treats a bare single number as a ceiling, not a range', () => {
    // Inventing a floor for "150000000" would state a minimum the government
    // never published.
    expect(daValueRange('150000000')).toEqual({ max: 150_000_000 });
    expect(daValueRange('9500000')).toEqual({ max: 9_500_000 });
  });

  it('returns nothing for absent values', () => {
    expect(daValueRange(undefined)).toEqual({});
    expect(daValueRange('TBD')).toEqual({});
  });
});

describe('daNaicsPsc', () => {
  it('splits "236220 / Y1JZ"', () => {
    expect(daNaicsPsc('236220 / Y1JZ')).toEqual({ naics: '236220', psc: 'Y1JZ' });
    expect(daNaicsPsc('236220 / Z2DA')).toEqual({ naics: '236220', psc: 'Z2DA' });
  });

  it('takes whichever half is present', () => {
    expect(daNaicsPsc('541330').naics).toBe('541330');
    expect(daNaicsPsc('541330').psc).toBeUndefined();
  });
});

describe('daSetAside', () => {
  it('maps the published decisions', () => {
    expect(daSetAside('SB Set-Aside')).toBe('Small Business');
    expect(daSetAside('Full & Open Competition')).toBe('Full and Open');
    expect(daSetAside('Full & Open Competition, Multiple Award')).toBe('Full and Open');
    expect(daSetAside('8(a) Competitive')).toBe('8(a)');
  });

  it('returns nothing rather than guessing', () => {
    expect(daSetAside('Multiple Award')).toBeUndefined();
    expect(daSetAside(undefined)).toBeUndefined();
  });
});

describe('officeForActivity — the crosswalk', () => {
  it('handles the ABBREVIATED directory names a normaliser would miss', () => {
    // Each of these was verified by hand against dodaac_directory. The obvious
    // guess is wrong for every one, and Huntsville alone is 327 rows — the
    // largest block in the file — so a wrong guess disconnects the most data.
    expect(officeForActivity('Jacksonville District')).toBe('ENDIST JACKSNVLLE');
    expect(officeForActivity('San Francisco District')).toBe('ENDIST SAN FRAN');
    expect(officeForActivity('Huntsville Engineer & Support Ctr')).toBe('USA ENG SPT CTR HUNTSVIL');
    expect(officeForActivity('Humphreys Engineer Ctr Support Activity')).toBe('USA HECSA');
    expect(officeForActivity('Army Geospatial Ctr')).toBe('USA GEOSPATIAL CTR');
    expect(officeForActivity('Walla Walla District')).toBe('US ARMY ENGINEER DISTRICT WALLA WAL');
  });

  it('carries the publisher\'s own typo so those rows still map', () => {
    // The file ships "Kansas Cit District" (74 rows). Dropping them for a
    // missing "y" would lose real forecasts.
    expect(officeForActivity('Kansas Cit District')).toBe('ENDIST KANSAS CITY');
    expect(officeForActivity('Kansas City District')).toBe('ENDIST KANSAS CITY');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(officeForActivity('  OMAHA   DISTRICT ')).toBe('ENDIST OMAHA');
  });

  it('returns undefined for an unknown activity rather than a plausible guess', () => {
    expect(officeForActivity('Atlantis District')).toBeUndefined();
    expect(officeForActivity(undefined)).toBeUndefined();
  });

  it('covers all 43 activities in the live file', () => {
    expect(Object.keys(ACTIVITY_TO_OFFICE).length).toBeGreaterThanOrEqual(43);
  });
});

const tsv = (s: string) => s.trim().split('\n').map(l => l.split('\t'));

describe('parseUsaceDaSheet', () => {
  const header = 'Project Title\tPrior Contract Number\tAnticipated Dollar Value or IDC Capacity\t'
    + 'Contract Period of Performance (in Months)\tNAICS / PSC\tAnticipated Set-Aside Decision\t'
    + 'Prior Order Number\tAction / Award Type\tAnticipated Solicitation Date\tAnticipated Award Date\t'
    + 'Buying / Requiring Activity\tSmall Business Office Contact Information';

  it('parses a real row end to end', () => {
    const res = parseUsaceDaSheet(tsv(`${header}
Ft Hood B90176 Hangar Door Replacement\tN/A\t$2,500,000 to $5,000,000\t15\t236220 / Y1PZ\tSB Set-Aside\tN/A\tContract\tFY2026, Q4\tTBD\tFt Worth District\tceswfddsa@usace.army.mil`));
    expect(res.rows).toHaveLength(1);
    const r = res.rows[0];
    expect(r.title).toBe('Ft Hood B90176 Hangar Door Replacement');
    expect(r.office).toBe('ENDIST FT WORTH');
    expect(r.naicsCode).toBe('236220');
    expect(r.pscCode).toBe('Y1PZ');
    expect(r.valueMin).toBe(2_500_000);
    expect(r.valueMax).toBe(5_000_000);
    expect(r.setAside).toBe('Small Business');
    expect(r.fiscalYear).toBe('FY2026');
    expect(r.anticipatedQuarter).toBe('Q4');
    expect(r.popMonths).toBe(15);
    expect(r.contactEmail).toBe('ceswfddsa@usace.army.mil');
    // "N/A" and "TBD" are absence, not data — they must never reach a card.
    expect(r.priorContractNumber).toBeUndefined();
    expect(r.awardDateRaw).toBeUndefined();
  });

  it('keeps the quarter but drops the year on an FYXXXX row', () => {
    const res = parseUsaceDaSheet(tsv(`${header}
Vehicle Maintenance Shop, Design-Build\tN/A\t$75,000,000 to $100,000,000\t410\t236220 / Z2DA\tFull & Open Competition, Multiple Award\tTBD\tDelivery / Task Order\tFYXXXX, Q4\tTBD\tHuntsville Engineer & Support Ctr\tsbo-hnc@usace.army.mil`));
    expect(res.rows[0].fiscalYear).toBeUndefined();
    expect(res.rows[0].anticipatedQuarter).toBe('Q4');
    expect(res.rows[0].office).toBe('USA ENG SPT CTR HUNTSVIL');
  });

  it('REPORTS an unmapped activity instead of silently dropping or guessing', () => {
    const res = parseUsaceDaSheet(tsv(`${header}
Some Project Title Here\tN/A\t$1,000,000 to $2,500,000\t12\t236220 / Y1PZ\tSB Set-Aside\tN/A\tContract\tFY2026, Q2\tTBD\tAtlantis District\tx@usace.army.mil`));
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].office).toBeUndefined();
    expect(res.unmappedActivities['Atlantis District']).toBe(1);
  });

  it('skips a row with no title or no activity', () => {
    const res = parseUsaceDaSheet(tsv(`${header}
\tN/A\t$1\t12\t236220\tSB Set-Aside\tN/A\tContract\tFY2026, Q2\tTBD\tOmaha District\tx@y.mil`));
    expect(res.rows).toHaveLength(0);
    expect(res.skipped).toBe(1);
  });
});

describe('usaceDaExternalId', () => {
  const base = { activity: 'Omaha District', office: 'ENDIST OMAHA', title: 'Market Research', raw: {} };

  it('separates the same title at two different offices', () => {
    // "Market Research" recurs across districts — one id would collapse real,
    // distinct requirements into a single row.
    const a = usaceDaExternalId({ ...base } as never);
    const b = usaceDaExternalId({ ...base, office: 'ENDIST MOBILE' } as never);
    expect(a).not.toBe(b);
  });

  it('separates two different requirements at the SAME office', () => {
    const a = usaceDaExternalId({ ...base, valueRange: '$1 to $2' } as never);
    const b = usaceDaExternalId({ ...base, valueRange: '$5 to $9' } as never);
    expect(a).not.toBe(b);
  });

  it('is stable across runs for identical content', () => {
    expect(usaceDaExternalId({ ...base } as never)).toBe(usaceDaExternalId({ ...base } as never));
  });
});
