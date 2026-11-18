/**
 * Hermetic DHS allRecords parse + reconcile — no network, no DB.
 */
import { describe, it, expect } from 'vitest';
import {
  parseDhsAllrecordsAoa,
  dhsAllrecordsToDbRow,
  dhsAwardQuarter,
  dhsSplitNaics,
  dhsParseDollarRange,
  DHS_ALLRECORDS_CSV_URL,
} from './dhs-allrecords';
import {
  planDhsAllrecordsReconciliation,
  dhsAllrecordsPlanReconciles,
  dhsAllrecordsPlanIsSemanticallySane,
  DHS_ALLRECORDS_SOURCE_OWNED_FIELDS,
  type DhsAllrecordsRow,
} from './dhs-allrecords-reconcile';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Tiny 3-row fixture matching the public CSV header shape. */
const FIXTURE_AOA: unknown[][] = [
  [
    'APFS Number', 'forecast_id', 'NAICS', 'Component', 'Title', 'Contract Type',
    'Contract Vehicle', 'Dollar Range', 'Small Business Set-Aside', 'Small Business Program',
    'Small Business Coordinator Email', 'Contract Status', 'Contract Number', 'Contractor',
    'Place of Performance City', 'Place of Performance State',
    'Period of Performance Start', 'Period of Performance End',
    'Primary Contact First Name', 'Primary Contact Last Name',
    'Primary Contact Phone', 'Primary Contact Email', 'Requirements Office',
    'Description', 'Award Quarter', 'Award Date', 'Estimated Solicitation Release',
    'Forecast Published', 'Forecast Previously Published',
  ],
  [
    'F2026073140', '73140', '336411 - Aircraft Manufacturing', 'USCG/CG-AIR',
    'Overhaul Hydraulic Pump', 'Firm Fixed Price', '', '$10M - $19M', 'N/A', 'None',
    'justin@example.com', 'Follow On', '70Z03822DJ0000001', 'Parker-Hannifin',
    'Irvine', 'CA', '2027-08-03', '2032-08-02', 'Ismael', 'Melendez',
    '(571) 607-6144', 'ismael@example.com', 'USCG/CG-AIR/MRR',
    'Need parts overhauled', 'Q3 2027', '2027-08-02', '2027-03-01', '2026-11-09', '',
  ],
  [
    '*F2026074090', '74090', '238210 - Electrical Contractors', 'FLETC/DD/MRSD',
    'Fire alarm replacement', 'Firm Fixed Price', '', '$2M - $4.9M', 'Full', 'SB',
    'allan@example.com', 'New Requirement', '', 'None',
    'charleston', 'SC', '2027-01-15', '2028-06-23', 'Aubreigh', 'Sumner',
    '(843) 745-2761', 'aubreigh@example.com', 'Office of Charleston Operations',
    'Replace fire alarm systems', 'Q1 2027', '2027-01-08', '2026-12-04', '2026-11-10', '2026-10-16',
  ],
  [
    'F2026074703', '74703', '611710 - Educational Support Services', 'FEMA',
    'College Credit Recommendation', 'Firm Fixed Price', '', '$500K - $999K', 'N/A', 'None',
    'FEMA-SB@example.com', 'Non-Competitive', '70FA2022C00000001', 'American Council on Education',
    'Washington, D.C.', 'NA', '2027-03-15', '2032-03-14', 'Anne', 'Thigpen',
    '(202) 394-2098', 'anne@example.com', 'PNP - NPD',
    'Curriculum evaluation services', 'Q2 2027', '2027-03-15', '2026-11-01', '2026-11-01', '',
  ],
];

const row = (id: string, over: Partial<DhsAllrecordsRow> = {}): DhsAllrecordsRow =>
  ({ external_id: id, title: 'T', naics_code: '541512', ...over });

describe('dhs allRecords parse', () => {
  it('extracts raw F… APFS Numbers (star-stripped, never DHS-APFS- prefixed)', () => {
    const p = parseDhsAllrecordsAoa(FIXTURE_AOA);
    expect(p.headerRow).toBe(0);
    expect(p.rows).toHaveLength(3);
    expect(p.rows.map((r) => r.apfsNumber)).toEqual([
      'F2026073140',
      'F2026074090', // * stripped
      'F2026074703',
    ]);
    for (const r of p.rows) {
      expect(r.apfsNumber).toMatch(/^F\d+/);
      expect(r.apfsNumber).not.toMatch(/^DHS-APFS-/);
    }
  });

  it('maps fields similarly to the sync-forecasts DHS mapper', () => {
    const p = parseDhsAllrecordsAoa(FIXTURE_AOA);
    const db = dhsAllrecordsToDbRow(p.rows[0], { sourceUrl: DHS_ALLRECORDS_CSV_URL });
    expect(db.external_id).toBe('F2026073140');
    expect(db.title).toBe('Overhaul Hydraulic Pump');
    expect(db.bureau).toBe('USCG/CG-AIR');
    expect(db.program_office).toBe('USCG/CG-AIR/MRR');
    expect(db.naics_code).toBe('336411');
    expect(db.naics_description).toBe('Aircraft Manufacturing');
    expect(db.estimated_value_range).toBe('$10M - $19M');
    expect(db.estimated_value_min).toBe(10_000_000);
    expect(db.estimated_value_max).toBe(19_000_000);
    expect(db.incumbent_name).toBe('Parker-Hannifin');
    expect(db.incumbent_contract_number).toBe('70Z03822DJ0000001');
    expect(db.pop_state).toBe('CA');
    expect(db.anticipated_quarter).toBe('Q3');
    expect(db.solicitation_date).toBe('2027-03-01');
    expect(db.source_url).toBe(DHS_ALLRECORDS_CSV_URL);
  });

  it('treats blank APFS as missing (never guessed)', () => {
    const aoa = [
      FIXTURE_AOA[0],
      ['', '1', '541512 - X', 'X', 'No id', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ];
    const p = parseDhsAllrecordsAoa(aoa);
    expect(p.rows).toHaveLength(0);
    expect(p.missingApfs).toBe(1);
  });
});

describe('helpers', () => {
  it('parses Award Quarter with year into Qn only', () => {
    expect(dhsAwardQuarter('Q3 2027')).toBe('Q3');
    expect(dhsAwardQuarter('q1')).toBe('Q1');
    expect(dhsAwardQuarter('')).toBeNull();
  });
  it('splits NAICS code/description', () => {
    expect(dhsSplitNaics('336411 - Aircraft Manufacturing')).toEqual({
      code: '336411',
      description: 'Aircraft Manufacturing',
    });
  });
  it('parses dollar ranges', () => {
    expect(dhsParseDollarRange('$500K - $999K')).toEqual([500_000, 999_000]);
  });
});

describe('reconcile plan', () => {
  it('insert / update / unchanged / absent_upstream balance', () => {
    const held = new Map<string, Partial<DhsAllrecordsRow>>([
      ['F2026073140', { title: 'OLD TITLE', naics_code: '336411' }],
      ['F2026074090', { title: 'Fire alarm replacement', naics_code: '238210' }],
      ['F9999999999', { title: 'Gone from public file' }],
    ]);
    const parsed = parseDhsAllrecordsAoa(FIXTURE_AOA);
    const upstream = parsed.rows.map((r) => dhsAllrecordsToDbRow(r) as DhsAllrecordsRow);
    // Force F2026074090 to match held on every supplied owned field that we care about for "unchanged"
    // by aligning held to the mapped row for that id:
    const mapped4090 = upstream.find((r) => r.external_id === 'F2026074090')!;
    held.set('F2026074090', { ...mapped4090 });

    const plan = planDhsAllrecordsReconciliation(upstream, held);
    expect(dhsAllrecordsPlanReconciles(plan).ok).toBe(true);
    expect(plan.toInsert.map((r) => r.external_id)).toEqual(['F2026074703']);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].externalId).toBe('F2026073140');
    expect(plan.toUpdate[0].changedFields).toContain('title');
    expect(plan.unchanged).toBe(1);
    expect(plan.absentUpstream).toEqual(['F9999999999']);
  });

  it('accounting identities hold with duplicates + rejected', () => {
    const p = planDhsAllrecordsReconciliation(
      [row('F1'), row('F1'), null, row('F2')],
      new Map([['F2', { title: 'T', naics_code: '541512' }]]),
    );
    expect(p.duplicateSourceIds).toEqual(['F1']);
    expect(p.parseRejected).toBe(1);
    expect(dhsAllrecordsPlanReconciles(p).ok).toBe(true);
  });

  it('semantic gate catches the Navy zero-match shape', () => {
    const held = new Map([['OLD-1', { title: 'x' }]]);
    const p = planDhsAllrecordsReconciliation([row('NEW-1')], held);
    expect(dhsAllrecordsPlanReconciles(p).ok).toBe(true);
    expect(dhsAllrecordsPlanIsSemanticallySane(p, held.size).ok).toBe(false);
  });

  it('Mindy enrichment is not source-owned', () => {
    for (const f of ['map_lat', 'map_lng', 'created_at', 'last_synced_at']) {
      expect(DHS_ALLRECORDS_SOURCE_OWNED_FIELDS as readonly string[]).not.toContain(f);
    }
  });
});

describe('live ingest paths keep canonical identity', () => {
  it('dhs-allrecords uses canonicalDhsApfsNumber (no synthetic prefix literals)', () => {
    const s = readFileSync(join(process.cwd(), 'src/lib/forecasts/dhs-allrecords.ts'), 'utf8');
    expect(s).toContain('canonicalDhsApfsNumber(');
    // external_id assignment must be the raw APFS number field, not a prefixed template.
    expect(s).toMatch(/external_id:\s*r\.apfsNumber/);
    expect(s).not.toMatch(/external_id:\s*`\$\{/);
  });
});
