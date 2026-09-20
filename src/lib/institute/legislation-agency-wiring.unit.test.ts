import { describe, it, expect } from 'vitest';
import { ingestInstituteDocument, type InstituteDocument } from './sources';
import { resolveLegislationAgency } from './legislation';
import CODES from '@/data/agency-toptier-codes.json';

const NAMES = Object.keys(CODES as Record<string, unknown>);

const ndaaDoc = (o: Partial<InstituteDocument> = {}): InstituteDocument => ({
  sourceOrg: 'Congress', sourceType: 'introduced_bill', documentNumber: '119-HR8800-IH',
  title: 'National Defense Authorization Act for Fiscal Year 2027 [HR 8800 — Introduced in House]',
  url: 'https://www.congress.gov/119/bills/hr8800/BILLS-119hr8800ih.htm',
  publicationDate: '2026-05-13', abstract: null,
  raw: { congress: 119, chamber: 'House', billType: 'HR', billNumber: '8800' }, ...o,
});

/** Minimal Supabase double recording what actually reaches the table. */
function fakeDb(opts: { existingId?: string } = {}) {
  const calls: { inserted: Record<string, unknown>[]; updated: Record<string, unknown>[] } = { inserted: [], updated: [] };
  const api = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: opts.existingId ? { id: opts.existingId } : null, error: null }) }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        calls.inserted.push(row);
        return { select: () => ({ maybeSingle: async () => ({ data: { id: 'new-id' }, error: null }) }) };
      },
      update: (row: Record<string, unknown>) => {
        calls.updated.push(row);
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  return { db: api as never, calls };
}

describe('legislative agency attribution survives ingestion', () => {
  it('the resolver itself already answers correctly (pre-ingestion)', () => {
    const r = resolveLegislationAgency(ndaaDoc(), NAMES);
    expect(r.canonicalAgency).toBe('Department of Defense');
    expect(r.resolved).toBe(true);
    expect(r.method).toBe('exact_name');
  });

  it('REGRESSION: that exact attribution is what gets PERSISTED', async () => {
    const doc = ndaaDoc();
    const resolution = resolveLegislationAgency(doc, NAMES);
    const { db, calls } = fakeDb();
    await ingestInstituteDocument(db, doc, NAMES, { agencyResolution: resolution });
    expect(calls.inserted).toHaveLength(1);
    // Before the fix this persisted null, because the title lacks the literal
    // string "Department of Defense" and the ingest re-resolved from the title.
    expect(calls.inserted[0].canonical_agency).toBe('Department of Defense');
    expect(calls.inserted[0].resolution_method).toBe('exact_name');
  });

  it('a genuinely unresolved legislative document stays NULL (no upgrade, no guess)', async () => {
    const doc = ndaaDoc({ documentNumber: '119-HR1-IH', title: 'A Bill To Do Various Things [HR 1 — Introduced in House]' });
    const resolution = resolveLegislationAgency(doc, NAMES);
    expect(resolution.resolved).toBe(false);
    const { db, calls } = fakeDb();
    await ingestInstituteDocument(db, doc, NAMES, { agencyResolution: resolution });
    expect(calls.inserted[0].canonical_agency).toBeNull();
    expect(calls.inserted[0].resolution_method).toBe('unresolved');
  });

  it('does not infer an agency merely because "defense" appears in a title', async () => {
    const doc = ndaaDoc({ documentNumber: '119-HR2-IH', title: 'A bill to study defense of coastal wetlands [HR 2 — Introduced in House]' });
    const resolution = resolveLegislationAgency(doc, NAMES);
    const { db, calls } = fakeDb();
    await ingestInstituteDocument(db, doc, NAMES, { agencyResolution: resolution });
    expect(calls.inserted[0].canonical_agency).toBeNull();
  });

  it('GAO ingestion is UNCHANGED — no options means the title resolver still decides', async () => {
    const gao: InstituteDocument = {
      sourceOrg: 'GAO', sourceType: 'gao_report', documentNumber: 'GAO-26-107894',
      title: 'Disaster Risk: Improvements Needed at FEMA',
      url: 'https://www.gao.gov/products/gao-26-107894', publicationDate: '2026-09-10',
      abstract: 'FEMA — a component within the Department of Homeland Security — ...',
    };
    const { db, calls } = fakeDb();
    await ingestInstituteDocument(db, gao, NAMES);           // legacy 3-arg call
    expect(calls.inserted[0].canonical_agency).toBe('Department of Homeland Security');
    expect(calls.updated).toHaveLength(0);
  });

  it('document identity is unchanged by the fix', async () => {
    const doc = ndaaDoc();
    const { db, calls } = fakeDb();
    await ingestInstituteDocument(db, doc, NAMES, { agencyResolution: resolveLegislationAgency(doc, NAMES) });
    expect(calls.inserted[0].source_type).toBe('introduced_bill');
    expect(calls.inserted[0].document_number).toBe('119-HR8800-IH');
  });
});

describe('re-running the same artifacts repairs in place', () => {
  it('an existing identity is UPDATED, never duplicated', async () => {
    const doc = ndaaDoc();
    const { db, calls } = fakeDb({ existingId: 'row-1' });
    const r = await ingestInstituteDocument(db, doc, NAMES, {
      agencyResolution: resolveLegislationAgency(doc, NAMES), updateExisting: true,
    });
    expect(r.inserted).toBe(false);          // no new row
    expect(r.updated).toBe(true);
    expect(calls.inserted).toHaveLength(0);  // ZERO duplicates
    expect(calls.updated).toHaveLength(1);
    expect(calls.updated[0].canonical_agency).toBe('Department of Defense');
    // identity columns are never in the update payload
    expect(calls.updated[0].document_number).toBeUndefined();
    expect(calls.updated[0].source_type).toBeUndefined();
  });

  it('without updateExisting an existing identity is a pure no-op (default preserved)', async () => {
    const doc = ndaaDoc();
    const { db, calls } = fakeDb({ existingId: 'row-1' });
    const r = await ingestInstituteDocument(db, doc, NAMES, { agencyResolution: resolveLegislationAgency(doc, NAMES) });
    expect(r.inserted).toBe(false);
    expect(r.updated).toBeUndefined();
    expect(calls.inserted).toHaveLength(0);
    expect(calls.updated).toHaveLength(0);
  });

  it('the repair path never upgrades a null into a guess', async () => {
    const doc = ndaaDoc({ documentNumber: '119-HR1-IH', title: 'A Bill To Do Various Things [HR 1 — Introduced in House]' });
    const { db, calls } = fakeDb({ existingId: 'row-9' });
    await ingestInstituteDocument(db, doc, NAMES, {
      agencyResolution: resolveLegislationAgency(doc, NAMES), updateExisting: true,
    });
    expect(calls.updated[0].canonical_agency).toBeNull();
  });
});

describe('the route passes the resolution through, not a name list', () => {
  const routeSrc = async () => {
    const fs = await import('node:fs');
    const raw = fs.readFileSync(new URL('../../app/api/cron/institute-legislation-sync/route.ts', import.meta.url), 'utf8');
    return raw.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  };

  it('hands the grounded resolution to the ingest', async () => {
    expect(await routeSrc()).toContain('agencyResolution: resolution');
  });

  it('no longer reduces the resolution to a single-name array', async () => {
    expect(await routeSrc()).not.toContain('resolution.canonicalAgency ? [resolution.canonicalAgency] : []');
  });
});
