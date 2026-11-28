import { describe, it, expect } from 'vitest';
import { LAB_ENTRIES, LAB_FIELDS, DOE_LAB_COUNT, unsourcedFields, findLabs, labDirectoryAnswer, type LabSupplierEntry } from './lab-directory';

// Official lab or DOE hosts only. .gov, plus the three lab sites DOE's own directory links that are not .gov.
const DOMAIN_OK = /^https:\/\/(([a-z0-9-]+\.)*gov|([a-z0-9-]+\.)*slac\.stanford\.edu|www\.jlab\.org|sites\.google\.com\/pppl\.gov)(\/|$)/i;

// Every address in the file, reviewed: office or role mailboxes printed on the lab's own page. A new address fails until
// it is reviewed here — never a named person's email.
const REVIEWED_OFFICE_EMAILS = new Set([
  'netlsmallbusiness@netl.doe.gov', 'procurement@srnl.doe.gov', 'procurement@srnl.gov', 'small.business@nlr.gov', 'ppc@nlr.gov',
  'aribasuppliers@lanl.gov', 'business@lanl.gov', 'infosmallbiz@ornl.gov', 'vendoradm@ornl.gov', 'procurement@pppl.gov',
  'sblo@bnl.gov', 'selfservice.acq@pnnl.gov', 'small.business@pnnl.gov', 'smallbusiness@llnl.gov', 'supplier@sandia.gov',
  'supreg@sandia.gov', 'suppliers@slac.stanford.edu', 'vendormanagment@inl.gov',
]);

describe('national lab supplier directory — data integrity', () => {
  it('every published field carries an https source_url and a retrieved_on date', () => {
    expect(unsourcedFields()).toEqual([]);
  });

  it('sources are official lab or DOE pages (.gov) only', () => {
    const off: string[] = [];
    for (const l of LAB_ENTRIES) for (const k of LAB_FIELDS) {
      const f = l[k] as { value: unknown; source_url: string | null };
      if (f.value != null && f.source_url && !DOMAIN_OK.test(f.source_url)) off.push(`${l.id}.${k}: ${f.source_url}`);
    }
    expect(off).toEqual([]);
  });

  it('retrieved_on is an ISO date', () => {
    for (const l of LAB_ENTRIES) for (const k of LAB_FIELDS) {
      const f = l[k] as { value: unknown; retrieved_on: string | null };
      if (f.value != null) expect(f.retrieved_on, `${l.id}.${k}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('no personal email addresses (only reviewed office mailboxes)', () => {
    const json = JSON.stringify(LAB_ENTRIES);
    const found = [...json.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[a-z]{2,}/g)].map((m) => m[0].toLowerCase());
    expect(found.filter((e) => !REVIEWED_OFFICE_EMAILS.has(e))).toEqual([]);
  });

  it('operator UEI is never filled from a non-official source (none is published)', () => {
    for (const l of LAB_ENTRIES) if (l.operator_uei.value != null) expect(l.operator_uei.source_url, l.id).toMatch(DOMAIN_OK);
  });

  it('every row has a sourced name, unique ids, and stays within the 17 DOE labs', () => {
    const ids = LAB_ENTRIES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(LAB_ENTRIES.length).toBeLessThanOrEqual(DOE_LAB_COUNT);
    for (const l of LAB_ENTRIES) expect(l.name.value, l.id).toBeTruthy();
  });

  it('the guard actually fails on an unsourced field', () => {
    const bad = { ...(LAB_ENTRIES[0] ?? {}), id: 'x', aliases: [], name: { value: 'X Lab', source_url: null, retrieved_on: null } } as LabSupplierEntry;
    for (const k of LAB_FIELDS) if (k !== 'name' && !(bad as unknown as Record<string, unknown>)[k]) (bad as unknown as Record<string, unknown>)[k] = { value: null, source_url: null, retrieved_on: null };
    expect(unsourcedFields([bad])).toContain('x.name');
  });
});

describe('national lab supplier directory — answer', () => {
  it('states coverage as N of 17', () => {
    expect(labDirectoryAnswer(null).coverage).toMatch(new RegExp(`^${LAB_ENTRIES.length} of 17 DOE national labs`));
  });

  it('marks unpublished fields "not published", never fabricates', () => {
    const a = labDirectoryAnswer(null) as { labs: Array<Record<string, { value: unknown; note?: string; source_url?: string }>> };
    for (const lab of a.labs) for (const k of LAB_FIELDS) {
      const f = lab[k];
      if (f.value == null) expect(f.note).toBe('not published');
      else expect(f.source_url).toMatch(/^https:\/\//);
    }
  });

  it('an unknown lab name says so instead of matching everything', () => {
    const a = labDirectoryAnswer('Acme Widget Institute') as { matched: number; rules: string[] };
    expect(a.matched).toBe(0);
    expect(a.rules.join(' ')).toMatch(/No lab in this directory matches/);
  });

  it('covers the 17 DOE labs', () => {
    expect(LAB_ENTRIES.length).toBe(17);
  });

  it('finds a lab by alias', () => {
    expect(findLabs('how do I sell to NREL').map((l) => l.id)).toEqual(['nlr']);
    expect(findLabs('Los Alamos supplier portal').map((l) => l.id)).toEqual(['lanl']);
    expect(findLabs('Oak Ridge and PNNL').map((l) => l.id).sort()).toEqual(['ornl', 'pnnl']);
    expect(findLabs('how do I sell to Sandia?').map((l) => l.id)).toEqual(['sandia']);
    expect((labDirectoryAnswer('Sandia') as { matched: number }).matched).toBe(1);
  });

  it('"the national labs" returns the whole directory', () => {
    expect((labDirectoryAnswer('how do I sell to the national labs') as { matched: number }).matched).toBe(17);
  });

  it("Sandia carries Eric's named rule with its source", () => {
    const s = LAB_ENTRIES.find((l) => l.id === 'sandia')!;
    expect(s.buying_rules.value!.join(' ')).toMatch(/under \$350K.*3 business days.*Small Business First/);
    expect(s.buying_rules.source_url).toMatch(/^https:\/\/www\.sandia\.gov\//);
  });
});
