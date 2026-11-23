import { describe, it, expect } from 'vitest';
import { applySourceProvenance, provenanceRecords } from './doc-provenance';
import type { DocModel } from '@/lib/documents/model';

const doc = (sources: DocModel['sources'], subtitle?: string): DocModel => ({
  schema: 'mindy.doc/1', title: 'T', date: '2026-11-23', sources, ...(subtitle ? { subtitle } : {}),
  sections: [{ id: 'a', heading: 'A', blocks: [{ type: 'paragraph', id: 'p', text: 'x', claim: 'fact', cites: sources.map((s) => s.id) }] }],
});
const REC = [
  { retrievedAt: '2026-11-22T15:04:00Z', asOf: '2026-11-20', url: 'https://www.usaspending.gov/award/CONT_AWD_W9124D26D0005', recordIds: ['W9124D26D0005'] },
  { retrievedAt: '2026-11-23T09:00:00Z', asOf: null, url: 'https://sam.gov/opp/abc123/view', recordIds: ['abc123', '36C24727Q0042'] },
];

describe('applySourceProvenance', () => {
  it('a url match fills the read date and the record id; a record-id match fills the read date and the link', () => {
    const r = applySourceProvenance(doc([
      { id: 's1', kind: 'usaspending', label: 'Award', url: 'http://usaspending.gov/award/CONT_AWD_W9124D26D0005/' },
      { id: 's2', kind: 'sam_notice', label: 'Notice', recordId: '36C24727Q0042' },
    ]), REC);
    expect(r.model.sources).toEqual([
      { id: 's1', kind: 'usaspending', label: 'Award', url: 'http://usaspending.gov/award/CONT_AWD_W9124D26D0005/', retrievedAt: '2026-11-22', recordId: 'W9124D26D0005' },
      // two record ids on that result: ambiguous, so recordId is not filled from it (the model's own stays)
      { id: 's2', kind: 'sam_notice', label: 'Notice', recordId: '36C24727Q0042', retrievedAt: '2026-11-23', url: 'https://sam.gov/opp/abc123/view' },
    ]);
    expect(r).toMatchObject({ filledRetrievedAt: 2, filledUrl: 1, filledRecordId: 1, unmatched: 0 });
  });

  it('no match fills nothing (no constructed link, id or date)', () => {
    const src = { id: 's1', kind: 'web' as const, label: 'Some page', url: 'https://example.org/report' };
    const r = applySourceProvenance(doc([src]), REC);
    expect(r.model.sources).toEqual([src]);
    expect(r.unmatched).toBe(1);
  });

  it('a model-written date that disagrees with the tool result is replaced; one with no match is kept', () => {
    const r = applySourceProvenance(doc([
      { id: 's1', kind: 'usaspending', label: 'Award', recordId: 'W9124D26D0005', retrievedAt: '2025-01-01' },
      { id: 's2', kind: 'web', label: 'Page', retrievedAt: '2025-02-02' },
    ]), REC);
    expect(r.model.sources[0].retrievedAt).toBe('2026-11-22');
    expect(r.model.sources[1].retrievedAt).toBe('2025-02-02');
    expect(r.replacedRetrievedAt).toBe(1);
  });

  it('subtitle: set from the matched results\' own as-of date only when empty; no as-of → none; a model subtitle stays', () => {
    expect(applySourceProvenance(doc([{ id: 's1', kind: 'usaspending', label: 'A', recordId: 'W9124D26D0005' }]), REC).model.subtitle).toBe('Data as of 2026-11-20');
    expect(applySourceProvenance(doc([{ id: 's1', kind: 'sam_notice', label: 'N', recordId: 'abc123' }]), REC).model.subtitle).toBeUndefined();
    expect(applySourceProvenance(doc([{ id: 's1', kind: 'usaspending', label: 'A', recordId: 'W9124D26D0005' }], 'Prepared for the board'), REC).model.subtitle).toBe('Prepared for the board');
  });

  it('subtitle: a range when the matched results carry different as-of dates, a single date when they agree', () => {
    const recs = [
      { retrievedAt: '2026-11-22T10:00:00Z', asOf: '2026-11-20', recordIds: ['W9124D26D0005'] },
      { retrievedAt: '2026-11-22T10:00:00Z', asOf: '2026-09-30', recordIds: ['36C24727Q0042'] },
      { retrievedAt: '2026-11-22T10:00:00Z', asOf: '2026-11-20T08:00:00Z', recordIds: ['HQ003422D0002'] },
    ];
    const two = doc([
      { id: 's1', kind: 'usaspending', label: 'A', recordId: 'W9124D26D0005' },
      { id: 's2', kind: 'sam_notice', label: 'B', recordId: '36C24727Q0042' },
    ]);
    expect(applySourceProvenance(two, recs).model.subtitle).toBe('Data as of 2026-09-30 to 2026-11-20');
    const agree = doc([
      { id: 's1', kind: 'usaspending', label: 'A', recordId: 'W9124D26D0005' },
      { id: 's3', kind: 'usaspending', label: 'C', recordId: 'HQ003422D0002' },
    ]);
    expect(applySourceProvenance(agree, recs).model.subtitle).toBe('Data as of 2026-11-20');
  });

  it('never mutates its input; no records means the model is returned as is', () => {
    const m = doc([{ id: 's1', kind: 'usaspending', label: 'A', recordId: 'W9124D26D0005' }]);
    const before = JSON.stringify(m);
    applySourceProvenance(m, REC);
    expect(JSON.stringify(m)).toBe(before);
    expect(applySourceProvenance(m, []).model).toBe(m);
  });
});

describe('provenanceRecords', () => {
  it('only results that returned data count, from this turn and earlier signed ledgers', () => {
    const recs = provenanceRecords(
      [
        { status: 'ok', retrievedAt: '2026-11-23T09:00:00Z', asOf: '2026-11-20', ref: { url: 'https://sam.gov/opp/x/view', noticeId: 'x' }, items: [{ key: 'K1' }] },
        { status: 'failed', retrievedAt: '2026-11-23T09:00:00Z', ref: { url: 'https://sam.gov/opp/y/view' } },
        { status: 'empty', retrievedAt: '2026-11-23T09:00:00Z' },
      ],
      [{ status: 'ok', retrievedAt: '2026-11-22T10:00:00Z', items: [{ key: 'W9124D26D0005' }] }, { status: 'refused', retrievedAt: '2026-11-22T10:00:00Z' }],
    );
    expect(recs).toEqual([
      { retrievedAt: '2026-11-23T09:00:00Z', asOf: '2026-11-20', url: 'https://sam.gov/opp/x/view', recordIds: ['x', 'K1'] },
      { retrievedAt: '2026-11-22T10:00:00Z', asOf: null, url: null, recordIds: ['W9124D26D0005'] },
    ]);
  });
});
