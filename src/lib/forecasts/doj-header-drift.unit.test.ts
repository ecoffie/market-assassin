/**
 * DOJ workbook header drift.
 *
 * THE BUG (measured 2026-11-23 against "Forecasted Contracting Opportunities Data
 * _11-18-2026.xlsx", Sheet2): the sheet grew to 37 columns. DOJ inserted
 * `Component`, `Actual Award Date` and `Contract Canceled Date` at index 30-32 and
 * moved `Incumbent Contractor PIID` to index 33. The fixed-index parser kept reading
 * index 30, so incumbent_contract_number received the COMPONENT code ('BOP', 'FBI',
 * …) on every row — 452 of 452 rows carried a component code at index 30.
 *
 * Header rows below are copied verbatim from the real workbooks (no data rows
 * committed); data rows are synthetic.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { mapDojRow, resolveDojColumns, DOJ_REQUIRED_HEADERS } from './doj-parse';
import { runDojIngest } from './doj-ingest';

/** Sheet2 header of the 2026-11-18 edition (37 columns). */
const HEADERS_37 = [
  'Fiscal Year', 'Action Tracking Number', 'Bureau', 'OBD', 'Contracting Office',
  'DOJ Small Business POC - Name', 'DOJ Small Business POC - Email Address',
  'DOJ Requirement POC - Name', 'DOJ Requirement POC - Email Address', 'Contract Name',
  'Category', 'Description of Requirement', 'Subcategory', 'Contract Type (Pricing)',
  'Award Type', 'NAICS Code', 'Product Service Code', 'Competition Approach',
  'Small Business Approach', 'Contracting Solution', 'Contract Availability',
  'Length of Contract', 'Request for Information (RFI) Planned',
  'Estimated Total Contract Value (Range)', 'Target Solicitation Date', 'Target Award Date',
  'Place of Performance', 'Country', 'Acquisition History', 'Incumbent Contractor',
  'Component', 'Actual Award Date', 'Contract Canceled Date', 'Incumbent Contractor PIID',
  'Solicitation Link', 'Other Information', 'Last Modified Date',
];

/** Sheet2 header of the edition committed at tmp/forecasts/doj-forecast.xlsx (33 columns). */
const HEADERS_33 = [
  ...HEADERS_37.slice(0, 30),
  'Incumbent Contractor PIID', 'Solicitation Link', 'Other Information',
];
/** The 34-column layout the parser was written against (33 + Last Modified Date). */
const HEADERS_34 = [...HEADERS_33, 'Last Modified Date'];

type Rec = Record<string, unknown>;
const RECS: Rec[] = [
  {
    'Fiscal Year': '2026', 'Action Tracking Number': 'FY26-FBI-1549-21', 'Bureau': 'FBI-1549',
    'Contracting Office': '15F067--DIVISION 1200',
    'DOJ Small Business POC - Name': 'Doe, Jane', 'DOJ Small Business POC - Email Address': 'jdoe@example.gov',
    'Contract Name': 'Technical Resource Group', 'Description of Requirement': 'Knowledge management support',
    'Contract Type (Pricing)': 'Firm-Fixed-Price', 'NAICS Code': '541511--Custom Computer Programming Services',
    'Product Service Code': 'R425---SUPPORT- PROFESSIONAL: ENGINEERING/TECHNICAL',
    'Competition Approach': 'Full and Open', 'Small Business Approach': 'Full and Open/Unrestricted',
    'Estimated Total Contract Value (Range)': '$1  -  $25,000', 'Target Award Date': 'Q3, 2026',
    'Place of Performance': 'Fredericksburg, VA', 'Country': 'United States',
    'Acquisition History': 'Re-compete Award', 'Incumbent Contractor': 'Example LLC',
    'Component': 'FBI', 'Incumbent Contractor PIID': '15F06726F0000070',
  },
  {
    'Fiscal Year': '2026', 'Action Tracking Number': 'FY26-BOP-1540-32', 'Bureau': 'BOP-1540',
    'Contract Name': 'Subsistence', 'NAICS Code': '311999--All Other Miscellaneous Food Manufacturing',
    'Estimated Total Contract Value (Range)': '$350,001  -  $375,000', 'Target Award Date': 'Q1, 2027',
    'Place of Performance': 'Yazoo City, MS', 'Country': 'United States',
    'Acquisition History': 'New Award', 'Component': 'BOP', 'Incumbent Contractor PIID': '',
  },
];

const toRow = (headers: string[], rec: Rec) => headers.map((h) => (h in rec ? rec[h] : null));
const parseAll = (headers: string[]) => {
  const res = resolveDojColumns(headers);
  if (!res.ok) throw new Error(`unexpected drift ${JSON.stringify(res)}`);
  return RECS.map((r) => mapDojRow(toRow(headers, r), res.columns));
};

describe('DOJ columns are mapped by header name', () => {
  it('the 37-, 34- and 33-column layouts parse to IDENTICAL fields', () => {
    const p37 = parseAll(HEADERS_37);
    expect(parseAll(HEADERS_34)).toEqual(p37);
    expect(parseAll(HEADERS_33)).toEqual(p37);
  });

  it("incumbent_contract_number comes from 'Incumbent Contractor PIID', never the Component", () => {
    const [fbi, bop] = parseAll(HEADERS_37);
    expect(fbi!.fields.incumbent_contract_number).toBe('15F06726F0000070');
    expect(bop!.fields.incumbent_contract_number).toBeNull();   // blank PIID, NOT 'BOP'
    expect(fbi!.fields).toMatchObject({
      external_id: 'FY26-FBI-1549-21', title: 'Technical Resource Group', bureau: 'FBI-1549',
      naics_code: '541511', psc_code: 'R425', incumbent_name: 'Example LLC',
      pop_city: 'Fredericksburg', pop_state: 'VA', pop_country: 'USA', status: 'Re-compete Award',
    });
    expect(fbi!.derived).toEqual({ fiscal_year: 'FY2026', anticipated_quarter: 'Q3' });
  });

  it('tolerates added and reordered columns', () => {
    const shuffled = ['Brand New Column', ...[...HEADERS_37].reverse()];
    expect(parseAll(shuffled)).toEqual(parseAll(HEADERS_37));
  });

  it('header matching ignores case and whitespace runs only', () => {
    const noisy = HEADERS_37.map((h) => `  ${h.toUpperCase().replace(/ /g, '  ')} `);
    const res = resolveDojColumns(noisy);
    if (!res.ok) throw new Error('drift');
    expect(RECS.map((r) => mapDojRow(toRow(HEADERS_37, r), res.columns))).toEqual(parseAll(HEADERS_37));
  });

  it('a missing required header fails closed and is NAMED', () => {
    const res = resolveDojColumns(HEADERS_37.filter((h) => h !== 'Incumbent Contractor PIID' && h !== 'Contract Name'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.missing).toEqual(['Contract Name', 'Incumbent Contractor PIID']);
  });

  it('a duplicated required header is ambiguous and fails closed', () => {
    const res = resolveDojColumns([...HEADERS_37, 'Bureau']);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.duplicated).toEqual(['Bureau']);
  });

  it('every required header is present in the live 37-column edition', () => {
    for (const h of Object.values(DOJ_REQUIRED_HEADERS)) expect(HEADERS_37).toContain(h);
  });
});

// ── runDojIngest end to end, over a real XLSX byte stream ─────────────────────
function workbook(headers: string[], recs: Rec[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...recs.map((r) => toRow(headers, r))]), 'Sheet2');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** Read-only stub: the paged held read returns `held` once. Any write would throw. */
function heldClient(held: Rec[]) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ range: async (from: number) => ({ data: from === 0 ? held : [], error: null }) }) }),
    }),
  } as never;
}

describe('runDojIngest — header drift', () => {
  it('a workbook missing a required header fails as header_drift and never reads the corpus', async () => {
    const headers = HEADERS_37.filter((h) => h !== 'Incumbent Contractor PIID');
    const sb = { from: () => { throw new Error('held corpus must not be read'); } } as never;
    const r = await runDojIngest(sb, { workbook: workbook(headers, RECS) });
    expect(r.ok).toBe(false);
    expect(r.failure).toBe('header_drift: missing Incumbent Contractor PIID');
    expect(r.fingerprint).not.toBeNull();   // the source WAS reached
  });

  it('the 37-column edition reconciles against rows stored from the old layout with NO spurious change', async () => {
    const res = resolveDojColumns(HEADERS_33);
    if (!res.ok) throw new Error('drift');
    const held = RECS.map((r) => mapDojRow(toRow(HEADERS_33, r), res.columns)!.fields);
    const r = await runDojIngest(heldClient(held), { workbook: workbook(HEADERS_37, RECS) });
    expect(r.failure).toBeUndefined();
    expect(r).toMatchObject({ ok: true, matchedSafe: 2, unchangedSafe: 2, changedSafe: 0, newProven: 0 });
  });

  it('a held Component code in incumbent_contract_number is corrected from the PIID column', async () => {
    const res = resolveDojColumns(HEADERS_37);
    if (!res.ok) throw new Error('drift');
    const held = RECS.map((r) => ({ ...mapDojRow(toRow(HEADERS_37, r), res.columns)!.fields }));
    held[0].incumbent_contract_number = 'FBI';   // the corruption the index bug wrote
    const r = await runDojIngest(heldClient(held), { workbook: workbook(HEADERS_37, RECS) });
    expect(r).toMatchObject({ ok: true, changedSafe: 1, unchangedSafe: 1 });
  });
});
