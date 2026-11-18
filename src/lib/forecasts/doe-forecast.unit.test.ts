/**
 * DOE's living forecast is the dated CSV on the OSDBU page.
 * The July 2026 XLSX still returns HTTP 200, so a parser that only knows that
 * file misses the 2026-11-16 edition (869 rows, measured that day).
 */
import { describe, expect, it } from 'vitest';
import { parseMoneyRange, parseNaics, parseSetAside } from './usace-district-parse';
import {
  absoluteDoeUrl,
  extractDoeForecastDocuments,
  parseDoeCsv,
  doeExternalId,
} from './doe-forecast';

const HELPERS = { parseMoneyRange, parseSetAside, parseNaics };

const PAGE = `
<a href="/documents/acquisition-forecast-readme">readme</a>
<a href="/documents/osbp-acquisition-forecast-public-2026-07-01csv">old</a>
<a href="/documents/osbp-acquisition-forecast-public-2026-11-16csv">current</a>
`;

const CSV = [
  'CURRENT_DATE,Performance End Date,Award Ultimate Completion Date,NAICS Code,NAICS Description,Program Office,Current Incumbent,DOE Master Award?,Master Award Number,Current Contract Number,Current Contract Number,Acquisition Description,Estimated Dollar Value,Contracting Officers Business Size Selection,IDV Type of Set Aside,Type of Set Aside,Type of Set Aside,Contract Type,Principal Place of Performance State,Small Business Program Manager,Originating Office Code,Originating Office Name,Buyer,Estimated Value Range',
  '11/16/2026,1/15/2027,1/15/2027,238320,Painting and Wall Covering Contractors,Office of Management,"JB CONTRACTING, INC.",No,N/A,89303025DMA000037,89303025DMA000037,"Painting services for the Forrestal building, option year 1.",2053499.2,Small Business,Unavailable,8(a) Sole Source,8(a) Sole Source,Contract,DC,naomi.robinson@hq.doe.gov,138,Management,sirron.scott@hq.doe.gov,R2 – $250K–$7.5M',
  '11/16/2026,3/1/2027,3/1/2027,541512,Custom Computer Programming,Office of the CIO,Unavailable,No,N/A,Unavailable,Unavailable,"New cloud hosting requirement for the science network.",,Small Business,Unavailable,Small Business Set-Aside,Small Business Set-Aside,Contract,Unavailable,sb@hq.doe.gov,100,CIO,buyer@hq.doe.gov,$1M to $5M',
].join('\r\n');

describe('extractDoeForecastDocuments', () => {
  it('picks the newest dated CSV and ignores the readme', () => {
    const docs = extractDoeForecastDocuments(PAGE);
    expect(docs[0]).toEqual({
      edition: '2026-11-16',
      href: '/documents/osbp-acquisition-forecast-public-2026-11-16csv',
    });
    expect(docs.map((d) => d.edition)).toEqual(['2026-11-16', '2026-07-01']);
    expect(absoluteDoeUrl(docs[0].href)).toBe(
      'https://www.energy.gov/documents/osbp-acquisition-forecast-public-2026-11-16csv',
    );
  });

  it('returns nothing when the page has no dated file', () => {
    expect(extractDoeForecastDocuments('<a href="/documents/acquisition-forecast-readme">x</a>')).toEqual([]);
  });
});

describe('parseDoeCsv — Nov 2026 public layout', () => {
  const parsed = parseDoeCsv(CSV, HELPERS);

  it('keeps both rows and does not treat the IDV column as the set-aside', () => {
    expect(parsed.headerRow).toBe(0);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].setAside).toBe('8(a)');
    expect(parsed.rows[1].setAside).toBe('Small Business');
  });

  it('reads M/D/YYYY performance dates, the precise dollar, and drops Unavailable', () => {
    const row = parsed.rows[0];
    expect(row.performanceEndDate).toBe('2027-01-15');
    expect(row.editionDate).toBe('2026-11-16');
    expect(row.estimatedValueMin).toBe(2053499.2);
    expect(row.estimatedValueMax).toBe(2053499.2);
    expect(row.estimatedValueRange).toMatch(/\$250K/);
    expect(row.incumbentContractNumber).toBe('89303025DMA000037');
    expect(row.popState).toBe('DC');
    expect(doeExternalId(row)).toBe('DOE-C:89303025DMA000037');
  });

  it('a new requirement with no contract number still gets a stable id and a parsed range', () => {
    const row = parsed.rows[1];
    expect(row.incumbentName).toBeUndefined();
    expect(row.incumbentContractNumber).toBeUndefined();
    expect(row.popState).toBeUndefined();
    expect(row.estimatedValueMin).toBe(1_000_000);
    expect(row.estimatedValueMax).toBe(5_000_000);
    expect(doeExternalId(row)).toMatch(/^DOE-T:OFFICE-OF-THE-CIO/);
  });
});
