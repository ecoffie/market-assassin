import { describe, it, expect } from 'vitest';
import { LAB_ENTRIES, LAB_FIELDS, DOE_LAB_COUNT, unsourcedFields, findLabs, labDirectoryAnswer, type LabSupplierEntry } from './lab-directory';

const DOMAIN_OK = /^https:\/\/([a-z0-9-]+\.)*(gov|energy\.gov)(\/|$)/i;

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

  it('no personal email addresses (office or generic only)', () => {
    const generic = /^(small\s*business|smallbusiness|sbp|sbo|osbp|procurement|purchasing|supplier|suppliers|subcontracts|business|sb|socio)[a-z0-9._-]*@/i;
    const bad: string[] = [];
    const json = JSON.stringify(LAB_ENTRIES);
    for (const m of json.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g)) if (!generic.test(m[0])) bad.push(m[0]);
    expect(bad).toEqual([]);
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

  it('finds a lab by alias when present', () => {
    const sandia = LAB_ENTRIES.find((l) => l.id === 'sandia');
    if (!sandia) return;
    expect(findLabs('how do I sell to Sandia?').map((l) => l.id)).toEqual(['sandia']);
    expect((labDirectoryAnswer('Sandia') as { matched: number }).matched).toBe(1);
  });
});
