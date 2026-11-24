/**
 * Market report provenance (Design & Output's "Data and sources" section, #2396; Agent 4 approved 2026-11-23).
 * Labels come only from evidence on the row — never a column DEFAULT (recompete_opportunities.data_source
 * defaults to 'usaspending'; federal_contacts.source defaults to 'sam_opportunities_poc').
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recompeteProvenance, recompeteSourceSummary, contactsAsOf, CONTACTS_SOURCE_LABEL } from './report-presentation';

describe('recompete provenance', () => {
  it('a USASpending award id is a USASpending award record, even without a URL', () => {
    expect(recompeteProvenance({ contract_id: 'CONT_AWD_693C7322C000001_6925_-NONE-_-NONE-', last_synced_at: '2026-09-19T22:27:05Z' }))
      .toEqual({ source_label: 'USASpending award record', source_url: null, as_of: '2026-09-19T22:27:05Z', as_of_label: 'last synced' });
    expect(recompeteProvenance({ contract_id: 'CONT_IDV_X' }).source_label).toBe('USASpending award record');
  });
  it('a usaspending.gov URL is evidence and is carried; a non-USASpending URL is not', () => {
    const u = 'https://www.usaspending.gov/award/CONT_AWD_36C24626C0021_3600_-NONE-_-NONE-';
    expect(recompeteProvenance({ contract_id: 'legacy-1', source_url: u })).toMatchObject({ source_label: 'USASpending award record', source_url: u });
    expect(recompeteProvenance({ contract_id: 'legacy-1', source_url: 'https://example.com/usaspending.gov' })).toMatchObject({ source_label: null, source_url: null });
  });
  it('row-level evidence WINS over a conflicting data_source', () => {
    expect(recompeteProvenance({ contract_id: 'CONT_AWD_A', data_source: 'contracts-data-import' }).source_label).toBe('USASpending award record');
  });
  it('contracts-data-import without row evidence is labelled a legacy import', () => {
    expect(recompeteProvenance({ contract_id: '12345', data_source: 'contracts-data-import' }).source_label).toBe('Legacy contracts import');
  });
  it('the column DEFAULT alone (data_source=usaspending, no id/url evidence) is NOT evidence → null', () => {
    expect(recompeteProvenance({ contract_id: '12345', data_source: 'usaspending' })).toMatchObject({ source_label: null, source_url: null });
    expect(recompeteProvenance({})).toEqual({ source_label: null, source_url: null, as_of: null, as_of_label: 'last synced' });
  });
  it('section summary counts each label; rows without evidence are not_stated', () => {
    expect(recompeteSourceSummary([
      { source_label: 'USASpending award record' }, { source_label: 'USASpending award record' },
      { source_label: 'Legacy contracts import' }, { source_label: null },
    ])).toEqual([
      { label: 'USASpending award record', count: 2 }, { label: 'Legacy contracts import', count: 1 }, { label: 'not_stated', count: 1 },
    ]);
  });
});

describe('contacts provenance', () => {
  it('as_of is the newest notice that listed the shown people; null when none states one', () => {
    expect(contactsAsOf([
      { source: { notice_posted: '2026-10-02' } }, { source: { notice_posted: null } }, { source: { notice_posted: '2026-11-18' } },
    ])).toBe('2026-11-18');
    expect(contactsAsOf([{ source: { notice_posted: null } }])).toBeNull();
    expect(CONTACTS_SOURCE_LABEL).toBe('SAM.gov notice points of contact (government buyers)');
  });
  it('the roster reads the row notice fields and never the DEFAULT source column', () => {
    const src = readFileSync(join(__dirname, '..', 'gov-contacts', 'contact-roster.ts'), 'utf8');
    expect(src).toMatch(/role_category, solicitation_number, posted_date'/);
    expect(src).toMatch(/notice_solicitation_number: r\.solicitation_number/);
    expect(src).toMatch(/notice_posted_date: r\.posted_date/);
    expect(src).not.toMatch(/notice_\w+: r\.source\b/);
  });
  it('the report attaches per-person source + section label/as_of on both roster paths', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'mcp', 'tools', 'market-report.ts'), 'utf8');
    expect(src.match(/source_label: CONTACTS_SOURCE_LABEL, as_of: contactsAsOf\(people\)/g)).toHaveLength(2);
    expect(src).toMatch(/notice_posted: c\.notice_posted_date \?\? null/);
    expect(src).toMatch(/provenance: recompeteProvenance\(c\)/);
  });
});
