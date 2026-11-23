/**
 * DOJ ingest — an untitled NEW row must not poison the insert batch.
 *
 * THE BUG (measured 2026-11-23, "Forecasted Contracting Opportunities Data
 * _11-18-2026.xlsx"): new row FY27-ATF-1560-4 has Contract Name 'TBD'. dojCell maps
 * that placeholder to null, agency_forecasts.title is NOT NULL, and every new row
 * went into ONE insert batch — so the whole insert failed, the database's error
 * text was thrown away, and the run ended ok=false 'partial_mutation' (HTTP 500)
 * every day.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { runDojIngest, dojHasUsableTitle } from './doj-ingest';

/**
 * The real 34-column Sheet2 header. Real names AND real positions, so the
 * fixture parses under both a positional and a header-name parser.
 */
const HEADER = [
  'Fiscal Year', 'Action Tracking Number', 'Bureau', 'OBD', 'Contracting Office',
  'DOJ Small Business POC - Name', 'DOJ Small Business POC - Email Address',
  'DOJ Requirement POC - Name', 'DOJ Requirement POC - Email Address', 'Contract Name',
  'Category', 'Description of Requirement', 'Subcategory', 'Contract Type (Pricing)',
  'Award Type', 'NAICS Code', 'Product Service Code', 'Competition Approach',
  'Small Business Approach', 'Contracting Solution', 'Contract Availability',
  'Length of Contract', 'Request for Information (RFI) Planned',
  'Estimated Total Contract Value (Range)', 'Target Solicitation Date', 'Target Award Date',
  'Place of Performance', 'Country', 'Acquisition History', 'Incumbent Contractor',
  'Incumbent Contractor PIID', 'Solicitation Link', 'Other Information', 'Last Modified Date',
];
const WIDTH = HEADER.length;
function sheetRow(v: { atn: string; title: string | null }): unknown[] {
  const r: unknown[] = Array(WIDTH).fill(null);
  r[0] = '2027'; r[1] = v.atn; r[2] = 'ATF-1560'; r[9] = v.title;
  r[15] = '541511--Custom Computer Programming Services'; r[25] = 'Q2, 2027';
  r[26] = 'Washington, DC'; r[27] = 'United States'; r[28] = 'New Award';
  return r;
}
function workbook(rows: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, ...rows]), 'Sheet2');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

type Batch = Array<Record<string, unknown>>;
/**
 * In-memory stand-in for the three tables runDojIngest touches. The insert
 * enforces agency_forecasts.title NOT NULL exactly as Postgres reports it.
 */
function fakeDb(held: Batch, opts: { updateError?: string } = {}) {
  const inserts: Batch[] = [];
  const updates: Array<{ id: unknown; patch: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      if (table === 'forecast_publisher_alert_floor') {
        return { select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
      }
      if (table !== 'agency_forecasts') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({ eq: () => ({ range: async (from: number) => ({ data: from === 0 ? held : [], error: null }) }) }),
        insert: async (batch: Batch) => {
          const bad = batch.find((row) => row.title == null);
          if (bad) {
            return { count: null, error: { message: 'null value in column "title" of relation "agency_forecasts" violates not-null constraint' } };
          }
          inserts.push(batch);
          return { count: batch.length, error: null };
        },
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            eq: async (_c: string, id: unknown) => {
              if (opts.updateError) return { count: null, error: { message: opts.updateError } };
              updates.push({ id, patch });
              return { count: 1, error: null };
            },
          }),
        }),
      };
    },
  };
  return { db: db as never, inserts, updates };
}

const HELD = [{ external_id: 'FY27-ATF-1560-1', title: 'Existing Thing', bureau: 'ATF-1560' }];

describe('dojHasUsableTitle', () => {
  it('null / blank is unusable; any real text is usable', () => {
    expect(dojHasUsableTitle({ title: null })).toBe(false);
    expect(dojHasUsableTitle({ title: '   ' })).toBe(false);
    expect(dojHasUsableTitle({})).toBe(false);
    expect(dojHasUsableTitle({ title: 'Ammunition' })).toBe(true);
  });
});

describe('runDojIngest — untitled new rows', () => {
  const ROWS = [
    sheetRow({ atn: 'FY27-ATF-1560-1', title: 'Existing Thing' }),
    sheetRow({ atn: 'FY27-ATF-1560-2', title: 'Body Armor' }),
    sheetRow({ atn: 'FY27-ATF-1560-4', title: 'TBD' }),   // the live placeholder
  ];

  it('the titled new row is inserted; the TBD row is held back and COUNTED, not invented', async () => {
    const { db, inserts } = fakeDb(HELD);
    const r = await runDojIngest(db, { apply: true, workbook: workbook(ROWS) });
    expect(r.failure).toBeUndefined();
    expect(r).toMatchObject({
      ok: true, newProven: 2, newWithoutTitle: 1, newWithoutTitleSample: ['FY27-ATF-1560-4'],
      insertAttempted: 1, inserted: 1, insertFailed: 0, writeErrors: [],
    });
    const written = inserts.flat();
    expect(written.map((row) => row.external_id)).toEqual(['FY27-ATF-1560-2']);
    expect(written.every((row) => typeof row.title === 'string' && row.title !== '')).toBe(true);
  });

  it('a dry run reports the same bucket without writing', async () => {
    const { db, inserts } = fakeDb(HELD);
    const r = await runDojIngest(db, { workbook: workbook(ROWS) });
    expect(r).toMatchObject({ ok: true, applied: false, newWithoutTitle: 1, newWithoutTitleSample: ['FY27-ATF-1560-4'] });
    expect(inserts).toHaveLength(0);
  });

  it('a failed update keeps the database error text instead of discarding it', async () => {
    const changed = [sheetRow({ atn: 'FY27-ATF-1560-1', title: 'Existing Thing' })];
    (changed[0] as unknown[])[5] = 'New POC';
    const { db } = fakeDb(HELD, { updateError: 'permission denied for table agency_forecasts' });
    const r = await runDojIngest(db, { apply: true, workbook: workbook(changed) });
    expect(r).toMatchObject({ ok: false, failure: 'partial_mutation', updateFailed: 1 });
    expect(r.writeErrors).toEqual([
      { op: 'update', externalIds: ['FY27-ATF-1560-1'], message: 'permission denied for table agency_forecasts' },
    ]);
  });

  it('a failed insert keeps the database error text and the batch ids', async () => {
    const { db } = fakeDb(HELD);
    const insertFails = {
      from: (t: string) => {
        const real = (db as { from: (t: string) => Record<string, unknown> }).from(t);
        return t === 'agency_forecasts'
          ? { ...real, insert: async () => ({ count: null, error: { message: 'duplicate key value violates unique constraint' } }) }
          : real;
      },
    } as never;
    const r = await runDojIngest(insertFails, { apply: true, workbook: workbook(ROWS) });
    expect(r).toMatchObject({ ok: false, failure: 'partial_mutation', insertFailed: 1 });
    expect(r.writeErrors).toEqual([
      { op: 'insert', externalIds: ['FY27-ATF-1560-2'], message: 'duplicate key value violates unique constraint' },
    ]);
  });
});
