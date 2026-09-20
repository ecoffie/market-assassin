import { describe, it, expect } from 'vitest';
import { ingestInstituteDocument, hasSourceFieldChanges, type InstituteDocument } from './sources';
import { resolveLegislationAgency } from './legislation';
import CODES from '@/data/agency-toptier-codes.json';

const NAMES = Object.keys(CODES as Record<string, unknown>);

const doc = (o: Partial<InstituteDocument> = {}): InstituteDocument => ({
  sourceOrg: 'Congress', sourceType: 'introduced_bill', documentNumber: '119-HR8800-IH',
  title: 'National Defense Authorization Act for Fiscal Year 2027 [HR 8800 — Introduced in House]',
  url: 'https://www.congress.gov/119/bills/hr8800/BILLS-119hr8800ih.htm',
  publicationDate: '2026-05-13', abstract: null,
  raw: { congress: 119, chamber: 'House', billType: 'HR', billNumber: '8800',
         latestActionDate: '2026-09-14', latestActionText: 'Received in the Senate.',
         retrievedAt: '2026-09-20T13:13:03.547Z' },
  ...o,
});

/** Builds the row a prior ingest would have persisted for `d`. */
function persistedRowFor(d: InstituteDocument) {
  const r = resolveLegislationAgency(d, NAMES);
  return {
    id: 'row-1',
    title: d.title,
    source_url: d.url,
    publication_date: d.publicationDate,
    canonical_agency: r.canonicalAgency,
    toptier_code: r.toptierCode,
    resolution_method: r.method,
    resolution_confidence: r.confidence,
    source_watermark: d.sourceWatermark ?? d.publicationDate,
    abstract: d.abstract,
    raw: { ...(d.raw as object), agencyClassification: 'UNKNOWN', agencyCandidates: [], agencyNote: 'Unknown — no force-map.' },
  };
}

function fakeDb(existingRow: Record<string, unknown> | null) {
  const calls = { inserted: [] as Record<string, unknown>[], updated: [] as Record<string, unknown>[] };
  const api = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingRow, error: null }) }) }) }),
      insert: (row: Record<string, unknown>) => { calls.inserted.push(row); return { select: () => ({ maybeSingle: async () => ({ data: { id: 'new' }, error: null }) }) }; },
      update: (row: Record<string, unknown>) => { calls.updated.push(row); return { eq: async () => ({ error: null }) }; },
    }),
  };
  return { db: api as never, calls };
}

const ingest = (d: InstituteDocument, row: Record<string, unknown> | null) => {
  const { db, calls } = fakeDb(row);
  return ingestInstituteDocument(db, d, NAMES, { agencyResolution: resolveLegislationAgency(d, NAMES), updateExisting: true })
    .then((r) => ({ r, calls }));
};

describe('RUN 1 — unchanged source is a genuine no-op', () => {
  it('writes NOTHING when every source-derived field is identical', async () => {
    const d = doc();
    const { r, calls } = await ingest(d, persistedRowFor(d));
    expect(r.inserted).toBe(false);
    expect(r.updated).toBe(false);
    expect(r.unchanged).toBe(true);
    expect(calls.updated).toHaveLength(0);   // no UPDATE => no updated_at churn
    expect(calls.inserted).toHaveLength(0);
  });

  it('a NEW retrievedAt alone does NOT count as a change', async () => {
    const prior = persistedRowFor(doc());
    // Same artifact, polled later: only the operational timestamp differs.
    const later = doc({ raw: { ...(doc().raw as object), retrievedAt: '2026-10-01T09:00:00.000Z' } });
    const { r, calls } = await ingest(later, prior);
    expect(r.unchanged).toBe(true);
    expect(calls.updated).toHaveLength(0);
  });
});

describe('RUN 2 — a real source change still writes', () => {
  it('a new latest action UPDATES the row', async () => {
    const prior = persistedRowFor(doc());
    const moved = doc({ raw: { ...(doc().raw as object), latestActionDate: '2026-09-25', latestActionText: 'Passed Senate.' } });
    const { r, calls } = await ingest(moved, prior);
    expect(r.updated).toBe(true);
    expect(r.unchanged).toBeUndefined();
    expect(calls.updated).toHaveLength(1);
    expect((calls.updated[0].raw as Record<string, unknown>).latestActionText).toBe('Passed Senate.');
  });

  it.each([
    ['title', { title: 'National Defense Authorization Act for Fiscal Year 2027 [HR 8800 — Reported in House]' }],
    ['source_url', { url: 'https://www.congress.gov/119/bills/hr8800/BILLS-119hr8800rh.htm' }],
    ['publication_date', { publicationDate: '2026-06-15' }],
  ])('a changed %s UPDATES the row', async (_label, patch) => {
    const prior = persistedRowFor(doc());
    const { r, calls } = await ingest(doc(patch as Partial<InstituteDocument>), prior);
    expect(r.updated).toBe(true);
    expect(calls.updated).toHaveLength(1);
  });

  it('a newly grounded agency UPDATES (never suppressed to keep updated_at quiet)', () => {
    const base = persistedRowFor(doc());
    expect(hasSourceFieldChanges({ ...base, canonical_agency: null, resolution_method: 'unresolved' },
      { ...base, raw: base.raw } as never)).toBe(true);
  });
});

describe('RUN 3 — convergence', () => {
  it('reverting to the prior state stops writing again', async () => {
    const prior = persistedRowFor(doc());
    // after a real change was persisted, the row now equals the new state
    const moved = doc({ raw: { ...(doc().raw as object), latestActionText: 'Passed Senate.' } });
    const afterUpdate = persistedRowFor(moved);
    const { r, calls } = await ingest(moved, afterUpdate);
    expect(r.unchanged).toBe(true);
    expect(calls.updated).toHaveLength(0);
    // and the ORIGINAL state against the ORIGINAL row is still a no-op
    const again = await ingest(doc(), prior);
    expect(again.r.unchanged).toBe(true);
  });
});

describe('a newly discovered artifact still INSERTS normally', () => {
  it('no existing identity => insert, never an update', async () => {
    const { r, calls } = await ingest(doc({ documentNumber: '119-HR9999-IH' }), null);
    expect(r.inserted).toBe(true);
    expect(calls.inserted).toHaveLength(1);
    expect(calls.updated).toHaveLength(0);
    expect(calls.inserted[0].document_number).toBe('119-HR9999-IH');
  });
});

describe('preserved invariants', () => {
  it('identity columns are never compared or written on update', async () => {
    const prior = persistedRowFor(doc());
    const { calls } = await ingest(doc({ title: 'changed title' }), prior);
    expect(calls.updated[0].document_number).toBeUndefined();
    expect(calls.updated[0].source_type).toBeUndefined();
  });

  it('errata and base report remain separate identities', async () => {
    const base = doc({ sourceType: 'committee_report', documentNumber: '119-SRPT-39', title: 'S. Rept. 119-39', raw: { congress: 119 } });
    const errata = doc({ sourceType: 'committee_report', documentNumber: '119-SRPT-39-ERRATA', title: 'S. Rept. 119-39,Errata', raw: { congress: 119 } });
    const a = await ingest(base, null);
    const b = await ingest(errata, null);
    expect(a.calls.inserted[0].document_number).toBe('119-SRPT-39');
    expect(b.calls.inserted[0].document_number).toBe('119-SRPT-39-ERRATA');
  });

  it('GAO ingestion (no options) still no-ops on an existing row without comparing', async () => {
    const gao: InstituteDocument = {
      sourceOrg: 'GAO', sourceType: 'gao_report', documentNumber: 'GAO-26-107894',
      title: 'Disaster Risk: Improvements Needed at FEMA',
      url: 'https://www.gao.gov/products/gao-26-107894', publicationDate: '2026-09-10', abstract: null,
    };
    const { db, calls } = fakeDb({ id: 'gao-1' });
    const r = await ingestInstituteDocument(db, gao, NAMES);   // legacy 3-arg
    expect(r.inserted).toBe(false);
    expect(r.updated).toBeUndefined();
    expect(r.unchanged).toBeUndefined();
    expect(calls.updated).toHaveLength(0);
  });
});

/**
 * A failed identity lookup must NOT be read as "no such row" — that falls through to
 * the insert path and tries to duplicate an identity we already hold. (Caught by the
 * pre-push swallowed-error gate while building this change.)
 */
describe('a failed identity lookup is an error, not an absence', () => {
  it('surfaces the error and never inserts', async () => {
    const calls = { inserted: [] as unknown[], updated: [] as unknown[] };
    const db = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'connection reset' } }) }) }) }),
        insert: (row: unknown) => { calls.inserted.push(row); return { select: () => ({ maybeSingle: async () => ({ data: { id: 'x' }, error: null }) }) }; },
        update: (row: unknown) => { calls.updated.push(row); return { eq: async () => ({ error: null }) }; },
      }),
    };
    const d = doc();
    const r = await ingestInstituteDocument(db as never, d, NAMES, {
      agencyResolution: resolveLegislationAgency(d, NAMES), updateExisting: true,
    });
    expect(r.error).toBe('connection reset');
    expect(r.inserted).toBe(false);
    expect(calls.inserted).toHaveLength(0);   // no duplicate attempt
    expect(calls.updated).toHaveLength(0);
  });
});
