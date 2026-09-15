/**
 * contact_kind — the authoritative government/vendor classification.
 *
 * Fixtures are REAL row shapes measured in federal_contacts on 2026-09-15, including the six
 * rows whose key is `No longer available::<role>` (SAM's literal for a delisted entity), which a
 * key-shape-only test would leave unclassified.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyContactKind, isVendorEntityPoc, isGovernmentBuyerContact,
  CONTACT_KIND_GOVERNMENT, CONTACT_KIND_VENDOR, CONTACT_KIND_SQL,
} from './contact-kind';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const read = (p: string) => strip(readFileSync(join(process.cwd(), p), 'utf8'));

const govRow = (over = {}) => ({
  source_row_key: '23a0d0c1dae44f978a020202d660a60b::0',
  department_ind_agency: 'DEPT OF DEFENSE',
  contact_email: 'jane.doe@army.mil',
  solicitation_number: 'W912PL25R0001',
  raw_data: { fullName: 'Jane Doe', email: 'jane.doe@army.mil', type: 'primary' },
  ...over,
});

const vendorRow = (over = {}) => ({
  source_row_key: 'C113E4798JC5::alt_elec_bus',
  department_ind_agency: null,
  contact_email: null,
  solicitation_number: null,
  raw_data: { uei: 'C113E4798JC5', role: 'alt_elec_bus', company: 'ACME CORP', role_title: 'Alternate Electronic Business POC' },
  ...over,
});

describe('classification', () => {
  it('classifies a notice POC as government_buyer', () => {
    expect(classifyContactKind(govRow())).toBe(CONTACT_KIND_GOVERNMENT);
    expect(isGovernmentBuyerContact(govRow())).toBe(true);
    expect(isVendorEntityPoc(govRow())).toBe(false);
  });

  it('classifies an entity POC as vendor_entity_poc', () => {
    expect(classifyContactKind(vendorRow())).toBe(CONTACT_KIND_VENDOR);
    expect(isVendorEntityPoc(vendorRow())).toBe(true);
    expect(isGovernmentBuyerContact(vendorRow())).toBe(false);
  });

  it('classifies the six "No longer available" rows as vendor, not unclassified', () => {
    // SAM emits this literal for a delisted entity, so the UEI slot is not UEI-shaped. Keying
    // the rule on the PAYLOAD rather than the key shape is what catches them.
    const row = vendorRow({
      source_row_key: 'No longer available::alt_elec_bus',
      raw_data: { uei: 'No longer available', role: 'alt_elec_bus', company: 'ANHAM FZCO', role_title: 'Alternate Past Performance POC' },
    });
    expect(classifyContactKind(row)).toBe(CONTACT_KIND_VENDOR);
  });

  it('classifies BOTH government generations identically — source_table is never consulted', () => {
    // AllSamContacts and sam_opportunities_pointOfContact share this key space; the rule cannot
    // see which generation a row came from, which is the point.
    for (const key of ['23a0d0c1dae44f978a020202d660a60b::0', '0000eba97392482f9aef56a7afd0f6a7::2']) {
      expect(classifyContactKind(govRow({ source_row_key: key }))).toBe(CONTACT_KIND_GOVERNMENT);
    }
  });
});

describe('unclassified is a real answer', () => {
  it.each([
    ['no department', govRow({ department_ind_agency: null })],
    ['no fullName payload', govRow({ raw_data: {} })],
    ['not a notice key', govRow({ source_row_key: 'something-else' })],
    ['vendor payload missing company', vendorRow({ raw_data: { uei: 'X' } })],
    ['vendor row with an email', vendorRow({ contact_email: 'x@y.com' })],
    ['empty row', {}],
  ])('returns null for %s rather than guessing', (_label, row) => {
    expect(classifyContactKind(row)).toBeNull();
  });

  it('the two rules are MUTUALLY EXCLUSIVE by construction, not by luck', () => {
    // vendor requires department_ind_agency IS NULL; government requires IS NOT NULL. One
    // column decides it, so no row can satisfy both — the overlap measured on the live corpus
    // was 0/287,534, and this is why.
    const withDept = { ...govRow(), raw_data: { fullName: 'Jane', uei: 'X', company: 'Y' }, contact_email: null, solicitation_number: null };
    expect(isGovernmentBuyerContact(withDept)).toBe(true);
    expect(isVendorEntityPoc(withDept)).toBe(false);

    const withoutDept = { ...withDept, department_ind_agency: null };
    expect(isGovernmentBuyerContact(withoutDept)).toBe(false);
    expect(isVendorEntityPoc(withoutDept)).toBe(true);
  });

  it('still refuses to guess if both rules ever did fire', () => {
    // Defensive branch: unreachable while the department rule above holds, kept so a future
    // rule change degrades to "unclassified" rather than to whichever branch runs first.
    const src = read('src/lib/gov-contacts/contact-kind.ts');
    expect(src).toMatch(/if \(vendor && government\) return null;/);
  });
});

describe('the rules never consult the unreliable columns', () => {
  it('source / source_table / role_category appear nowhere in the classifier', () => {
    const src = read('src/lib/gov-contacts/contact-kind.ts');
    const body = src.slice(src.indexOf('export function isVendorEntityPoc'));
    for (const col of ['source_table', 'role_category']) {
      expect(body, `classifier reads ${col}`).not.toContain(col);
    }
  });

  it('the SQL predicates mirror the TS rules', () => {
    expect(CONTACT_KIND_SQL.vendor).toContain("raw_data ? 'uei'");
    expect(CONTACT_KIND_SQL.vendor).toContain("raw_data ? 'company'");
    expect(CONTACT_KIND_SQL.vendor).toContain('department_ind_agency IS NULL');
    expect(CONTACT_KIND_SQL.government).toContain("raw_data ? 'fullName'");
    expect(CONTACT_KIND_SQL.government).toContain('department_ind_agency IS NOT NULL');
    for (const p of Object.values(CONTACT_KIND_SQL)) {
      expect(p).not.toContain('source_table');
      expect(p).not.toContain('role_category');
    }
  });
});

describe('the live producer states the kind explicitly', () => {
  const src = read('src/lib/gov-contacts/buyer-contact-source.ts');

  it('every extracted row carries contact_kind = government_buyer', () => {
    expect(src).toContain('contact_kind: CONTACT_KIND_GOVERNMENT');
  });

  it('never relies on a DB default — the migration adds NO default', () => {
    const mig = readFileSync(join(process.cwd(), 'supabase/migrations/20260916_federal_contacts_contact_kind.sql'), 'utf8');
    expect(mig).not.toMatch(/DEFAULT\s+'(government_buyer|vendor_entity_poc)'/i);
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS contact_kind TEXT;/);
  });

  it('the producer still never writes source_table — generations stay intact', () => {
    // Relabelling would destroy the import-lineage the provenance audit depends on, and is
    // exactly what makes the retired importer dangerous.
    expect(src).not.toContain('source_table');
  });

  it('contact_kind is compared on write, so unclassified legacy rows get repaired in place', () => {
    expect(src).toMatch(/'contact_kind',/);
  });

  it('the runner READS contact_kind back, or every row would look changed forever', () => {
    // Omitting it from HELD_COLUMNS would make the comparison undefined-vs-value on every row:
    // permanent churn and a permanently-advancing last_data_advance.
    expect(read('src/lib/gov-contacts/buyer-contact-run.ts')).toMatch(/HELD_COLUMNS[\s\S]{0,300}contact_kind/);
  });
});

describe('the retired importer cannot write production by accident', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/populate-contracting-officers.js'), 'utf8');

  it('requires TWO deliberate flags', () => {
    expect(src).toContain("ARGV.includes('--legacy-replay')");
    expect(src).toContain("ARGV.includes('--i-understand-this-relabels-live-rows')");
    expect(src).toMatch(/WRITES_ENABLED = LEGACY_REPLAY && ACKNOWLEDGED/);
  });

  it('guards at the WRITE, not only at the entry point', () => {
    const upsert = src.slice(src.indexOf('async function upsertChunk'));
    expect(upsert.indexOf('if (!WRITES_ENABLED) return;')).toBeGreaterThan(-1);
    expect(upsert.indexOf('if (!WRITES_ENABLED) return;')).toBeLessThan(upsert.indexOf('.upsert('));
  });

  it('is documented as retired and explains the relabelling danger', () => {
    expect(src).toContain('RETIRED');
    expect(src).toContain('NOT THE CANONICAL PRODUCER');
    expect(src).toMatch(/RELABEL/i);
  });
});
