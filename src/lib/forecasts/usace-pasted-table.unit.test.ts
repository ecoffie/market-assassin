/**
 * Guards the PASTED-TABLE path: districts that publish their forecast as an
 * HTML table on the page rather than as a downloadable PDF/XLSX.
 *
 * Omaha, Seattle and Portland all do this. The operator copies the table into a
 * tab-delimited .txt, which is BETTER structured than PDF text — so it goes to
 * the column mapper, not the PDF line-scanner. Sending it to the line-scanner
 * glued the location and set-aside into the title:
 *   "SW WA<tab>Mt St Helens Fish Collection Facility 27 - F&O"
 *
 * Every fixture below is a VERBATIM row from the three live district pages
 * (fetched 2026-08-02), not an invented example.
 */
import { describe, it, expect } from 'vitest';
import { parseFiscalYear, parseQuarter } from './usace-district-parse';
import { parseUsaceSheet } from './usace-workbook-parse';

const tsv = (s: string) =>
  s.trim().split('\n').map(l => l.split('\t').map(c => c.trim()));

describe('fiscal year / quarter across the three district dialects', () => {
  it('reads Seattle "Q4FY26" — no separator between quarter and FY', () => {
    // The original regexes were \bFY(\d+)\b and \bQ([1-4])\b. The junction
    // between "4" and "F" is NOT a word boundary, so both missed entirely and
    // 30 of Seattle's 45 rows silently lost their fiscal year.
    expect(parseFiscalYear('Q4FY26')).toBe('FY2026');
    expect(parseQuarter('Q4FY26')).toBe('Q4');
    expect(parseFiscalYear('Q1FY27')).toBe('FY2027');
    expect(parseQuarter('Q3FY26')).toBe('Q3');
  });

  it('reads a bare FY with no quarter', () => {
    expect(parseFiscalYear('FY28')).toBe('FY2028');
    expect(parseFiscalYear('FY30')).toBe('FY2030');
  });

  it('reads a bare year alone in a cell headed "Fiscal Year" (Omaha)', () => {
    expect(parseFiscalYear('23')).toBe('FY2023');
  });

  it('does NOT assert a fiscal year for a bare quarter under an ambiguous header (Eric, 2026-08-02)', () => {
    // Portland heads this column "Advertise Date" and never says whether the
    // quarter is fiscal or calendar — and the two differ by a full quarter
    // (FY Q1 = Oct-Dec, CY Q1 = Jan-Mar). An earlier version stamped FY2027 on
    // it, which invented timing the source never published across 24 rows.
    // The quarter is real and survives; the year does not.
    expect(parseQuarter('Q1 27')).toBe('Q1');
    expect(parseFiscalYear('Q1 27', false)).toBeUndefined();
    expect(parseFiscalYear('Q4 22', false)).toBeUndefined();

    // ...but when the publisher's own header says "Fiscal Year" (Omaha), the
    // reading is theirs and the year is real data, not an assumption.
    expect(parseFiscalYear('Q4 22', true)).toBe('FY2022');
  });

  it('keeps an EXPLICIT FY marker even under an ambiguous header', () => {
    // Seattle's "Q4FY26" sits under "Solicitation Date", but it says FY outright
    // — the guard is about bare years, not about distrusting the source.
    expect(parseFiscalYear('Q4FY26', false)).toBe('FY2026');
  });

  it('does NOT invent a year from prose, money, or a split range', () => {
    // The bare-2-digit rule is deliberately narrow: only next to a quarter
    // marker or alone in the cell. A loose \b(\d{2})\b would read the "9" in
    // "Transformer 9-11" or a dollar figure as a fiscal year.
    expect(parseFiscalYear('Transformer 9-11 Interim Repair')).toBeUndefined();
    expect(parseFiscalYear('$1M-$5M')).toBeUndefined();
    expect(parseFiscalYear('ON HOLD')).toBeUndefined();
    expect(parseFiscalYear('TBD')).toBeUndefined();
    expect(parseFiscalYear('23/24')).toBeUndefined();  // ambiguous span, not one year
  });
});

describe('parseUsaceSheet on a single-district pasted table', () => {
  it('maps Portland columns without a district column present', () => {
    // The header detector used to REQUIRE a "district" column, which only the
    // multi-district DIVISION workbooks carry. A district publishing its own
    // table has none — the district IS the page — so all three were rejected.
    const res = parseUsaceSheet('ENDIST PORTLAND', tsv(`
Anticipated NAICS\tProject Location\tProject Title\tAdvertise Date\tEstimated Dollar/Ceiling\tAc Plan (Set Aside)
237990\tSW WA\tMt St Helens Fish Collection Facility\tQ1 27\t$25M - $100M\tF&O
238210\tThe Dalles, OR\tTransformer 9-11 Interim Repair\tTBD\t$1M-$5M\tTBD
`));
    expect(res.rows).toHaveLength(2);
    const [a, b] = res.rows;
    // The title must be the title alone — not location + title + set-aside.
    expect(a.title).toBe('Mt St Helens Fish Collection Facility');
    expect(a.location).toBe('SW WA');
    expect(a.naicsCode).toBe('237990');
    // "Q1 27" under an "Advertise Date" header: quarter yes, fiscal year NO —
    // the source never states which quarter convention it means.
    expect(a.anticipatedQuarter).toBe('Q1');
    expect(a.fiscalYear).toBeUndefined();
    expect(a.estimatedValueRange).toBe('$25M - $100M');
    // "TBD" is not data — it must not survive as a literal on a card.
    expect(b.fiscalYear).toBeUndefined();
    expect(b.setAside).toBeUndefined();
    expect(b.popState).toBe('OR');
  });

  it('captures Seattle solicitation numbers — the field that joins to SAM', () => {
    const res = parseUsaceSheet('ENDIST SEATTLE', tsv(`
NAICS\tSolicitation Number\tPCF Cabinet Description\tSet-Aside\tValue\tSolicitation Date
236220\tW912DW26R0YF0\tArmy - JBLM, WA - SOF TEMF\tTBD\tUnder $40M\tFY30
237310\tW912DW26RA002\tFY26 Duckabush Estuary Restoration PSNER\tUR\tUnder $100M\tQ4FY26
`));
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].solicitationNumber).toBe('W912DW26R0YF0');
    expect(res.rows[0].fiscalYear).toBe('FY2030');
    expect(res.rows[1].fiscalYear).toBe('FY2026');
    expect(res.rows[1].anticipatedQuarter).toBe('Q4');
  });

  it('maps Omaha, whose title column also carries the description', () => {
    const res = parseUsaceSheet('ENDIST OMAHA', tsv(`
NAICS/PSC\tLocation\tProject Title and Description/Location\tFiscal Year\t* Value\t* Set-Aside
236220\tEllsworth AFB, SD\tB-21 Weapons Generation Facility, Ellsworth AFB, SD\tQ4 23\t$100M - $250M\tF&O
`));
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].title).toBe('B-21 Weapons Generation Facility, Ellsworth AFB, SD');
    expect(res.rows[0].fiscalYear).toBe('FY2023');
    expect(res.rows[0].popState).toBe('SD');
    expect(res.rows[0].estimatedValueMax).toBe(250_000_000);
  });

  it('returns nothing rather than guessing when there is no title column', () => {
    const res = parseUsaceSheet('X', tsv(`
Foo\tBar
1\t2
`));
    expect(res.rows).toHaveLength(0);
  });
});
