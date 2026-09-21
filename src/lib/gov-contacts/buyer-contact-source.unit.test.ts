/**
 * Decision Makers source — checkpoint algebra, write classification, coverage, health.
 *
 * Behavioural (not source-text) because these are the properties that make the drain safe:
 * a cursor that cannot skip, a write plan that cannot fake advancement, and a coverage
 * number that measures traversal rather than the writer.
 */
import { describe, it, expect } from 'vitest';
import {
  advanceCursor, classifyWrites, coverageReport, cursorIsAhead, dataAdvanced, decodeCursor,
  emptyStats, encodeCursor, evaluateSourceHealth, extractContactRows, isGarbageContactName,
  mergeStats, runVerified,
  type ContactRow, type SourceNotice,
} from './buyer-contact-source';

const notice = (over: Partial<SourceNotice> = {}): SourceNotice => ({
  notice_id: 'n1',
  solicitation_number: 'W912PL25R0001',
  department: 'DEFENSE, DEPARTMENT OF',
  office: null,
  sub_tier: 'DEPT OF THE ARMY',
  posted_date: '2026-05-01',
  created_at: '2026-05-02T10:00:00.000Z',
  points_of_contact: [],
  ...over,
});

describe('extraction', () => {
  it('keys every row <notice_id>::<slot index>, so a re-read is idempotent', () => {
    const n = notice({ points_of_contact: [
      { fullName: 'Jane Doe', email: 'jane@army.mil', type: 'primary' },
      { fullName: 'John Roe', phone: '555-0100', type: 'secondary' },
    ] });
    const a = extractContactRows(n);
    const b = extractContactRows(n);
    expect(a.rows.map((r) => r.source_row_key)).toEqual(['n1::0', 'n1::1']);
    expect(b.rows).toEqual(a.rows);
  });

  it('drops a POC with neither email nor phone, and counts the rejection', () => {
    const out = extractContactRows(notice({ points_of_contact: [{ fullName: 'No Contact' }] }));
    expect(out.rows).toHaveLength(0);
    expect(out.rejectedNoContact).toBe(1);
    expect(out.slots).toBe(1);
  });

  it('drops SAM placeholder names and counts them SEPARATELY from no-contact drops', () => {
    const out = extractContactRows(notice({ points_of_contact: [
      { fullName: 'Telephone: 7175503112', email: 'x@y.mil' },
      { fullName: 'Please see the solicitation for buyer details', email: 'z@y.mil' },
    ] }));
    expect(out.rows).toHaveLength(0);
    expect(out.rejectedName).toBe(2);
    expect(out.rejectedNoContact).toBe(0);
  });

  it('preserves the slot INDEX when an earlier slot is rejected', () => {
    // Re-indexing survivors would re-key every row on the next upstream edit and orphan
    // the ones already held.
    const out = extractContactRows(notice({ points_of_contact: [
      { fullName: 'Telephone: 5551234567', email: 'a@y.mil' },
      { fullName: 'Real Person', email: 'b@y.mil' },
    ] }));
    expect(out.rows.map((r) => r.source_row_key)).toEqual(['n1::1']);
  });

  it('falls back to a type-derived title but never invents a name', () => {
    const out = extractContactRows(notice({ points_of_contact: [{ fullName: 'Jane Doe', email: 'j@y.mil', type: 'primary' }] }));
    expect(out.rows[0].contact_title).toBe('Primary Contact');
    expect(out.rows[0].contact_fullname).toBe('Jane Doe');
  });

  it('a notice with no POC array yields nothing rather than throwing', () => {
    expect(extractContactRows(notice({ points_of_contact: null })).rows).toHaveLength(0);
  });
});

describe('garbage-name filter parity', () => {
  it.each([
    ['Telephone: 7175503112', true],
    ['Phone: 555 0100', true],
    ['Please contact the office listed in the solicitation', true],
    ['x'.repeat(81), true],
    [null, true],
    ['Jane Doe', false],
    ["O'Brien-Smith, Patricia", false],
  ])('%s → garbage=%s', (name, expected) => {
    expect(isGarbageContactName(name as string | null)).toBe(expected);
  });
});

describe('cursor: persists and resumes', () => {
  it('round-trips through the checkpoint encoding', () => {
    const c = { createdAt: '2026-05-02T10:00:00.000Z', noticeId: 'abc-123' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it('rejects a malformed stored cursor rather than half-decoding it', () => {
    for (const bad of [null, '', 'no-separator', '|only-id', 'only-date|']) {
      expect(decodeCursor(bad)).toBeNull();
    }
  });

  it('a second run resumes from where the first stopped', () => {
    const batch1 = [notice({ notice_id: 'a', created_at: '2026-01-01T00:00:00.000Z' }),
                    notice({ notice_id: 'b', created_at: '2026-01-02T00:00:00.000Z' })];
    const after1 = advanceCursor(null, batch1);
    expect(after1).toEqual({ createdAt: '2026-01-02T00:00:00.000Z', noticeId: 'b' });
    const batch2 = [notice({ notice_id: 'c', created_at: '2026-01-03T00:00:00.000Z' })];
    expect(advanceCursor(after1, batch2)).toEqual({ createdAt: '2026-01-03T00:00:00.000Z', noticeId: 'c' });
  });
});

describe('cursor: cannot skip', () => {
  it('a FAILED page leaves the cursor untouched — the next run re-reads that position', () => {
    const prev = { createdAt: '2026-01-01T00:00:00.000Z', noticeId: 'a' };
    // A failed page processes nothing, so nothing is passed in.
    expect(advanceCursor(prev, [])).toEqual(prev);
  });

  it('a PARTIAL batch advances only to the last notice actually processed', () => {
    const processed = [notice({ notice_id: 'a', created_at: '2026-01-01T00:00:00.000Z' })];
    // 'b' and 'c' were fetched but never processed — the cursor must not reach them.
    expect(advanceCursor(null, processed)).toEqual({ createdAt: '2026-01-01T00:00:00.000Z', noticeId: 'a' });
  });

  it('a NEW notice cannot land behind the cursor, whatever its posted_date', () => {
    // The whole reason the cursor is created_at. A notice posted 30 days ago but ingested
    // NOW gets created_at = now, which sorts AFTER any cursor already reached. Under a
    // posted_date cursor this same record would be skipped.
    const cursor = { createdAt: '2026-06-01T00:00:00.000Z', noticeId: 'm' };
    const backdated = notice({ notice_id: 'z', created_at: '2026-06-02T00:00:00.000Z', posted_date: '2026-05-03' });
    expect(cursorIsAhead(cursor, { createdAt: backdated.created_at, noticeId: backdated.notice_id })).toBe(true);
  });

  it('ties on created_at are broken by notice_id, so the ordering is total', () => {
    const same = '2026-01-01T00:00:00.000Z';
    expect(cursorIsAhead({ createdAt: same, noticeId: 'a' }, { createdAt: same, noticeId: 'b' })).toBe(true);
    expect(cursorIsAhead({ createdAt: same, noticeId: 'b' }, { createdAt: same, noticeId: 'a' })).toBe(false);
  });

  it('never reports a backwards move as progress', () => {
    const ahead = { createdAt: '2026-06-01T00:00:00.000Z', noticeId: 'm' };
    const behind = { createdAt: '2026-01-01T00:00:00.000Z', noticeId: 'a' };
    expect(cursorIsAhead(ahead, behind)).toBe(false);
    expect(cursorIsAhead(null, behind)).toBe(true);
    expect(cursorIsAhead(ahead, null)).toBe(false);
  });
});

describe('write classification', () => {
  const row = (over: Partial<ContactRow> = {}): ContactRow => ({
    source_row_key: 'n1::0', contact_fullname: 'Jane Doe', contact_title: 'CO',
    contact_email: 'jane@army.mil', contact_phone: null,
    department_ind_agency: 'DEFENSE, DEPARTMENT OF', office: null, sub_tier: 'ARMY',
    role_category: 'contracting', solicitation_number: 'W1', posted_date: '2026-05-01',
    source: 'sam_opportunities_poc', raw_data: {}, ...over,
  });

  it('an unseen key is an INSERT', () => {
    const plan = classifyWrites([row()], new Map());
    expect(plan.inserts).toHaveLength(1);
    expect(plan.updates).toHaveLength(0);
  });

  it('an identical held row is UNCHANGED and is not re-written', () => {
    const r = row();
    const plan = classifyWrites([r], new Map([[r.source_row_key, { ...r }]]));
    expect(plan.unchangedCount).toBe(1);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
  });

  it('a changed meaningful field is an UPDATE', () => {
    const held = { ...row(), contact_email: 'old@army.mil' };
    const plan = classifyWrites([row()], new Map([[held.source_row_key, held]]));
    expect(plan.updates).toHaveLength(1);
  });

  it('a differing updated_at is NOT a change — that is how a sweep fakes advancement', () => {
    const r = row();
    const held = { ...r, updated_at: '1999-01-01T00:00:00.000Z' } as unknown as Partial<ContactRow>;
    expect(classifyWrites([r], new Map([[r.source_row_key, held]])).unchangedCount).toBe(1);
  });

  it('treats undefined and null as the same absent value', () => {
    const r = row({ office: null });
    const held: Partial<ContactRow> = { ...r };
    delete held.office;
    expect(classifyWrites([r], new Map([[r.source_row_key, held]])).unchangedCount).toBe(1);
  });
});

describe('run success is not data advancement', () => {
  it('a completed run with zero mutations does NOT advance the data clock', () => {
    const stats = { ...emptyStats(), noticesScanned: 500, contactsExtracted: 640, unchanged: 640 };
    expect(runVerified(stats)).toBe(true);
    expect(dataAdvanced(stats)).toBe(false);
  });

  it('one insert OR one update is enough to advance it', () => {
    expect(dataAdvanced({ ...emptyStats(), inserted: 1 })).toBe(true);
    expect(dataAdvanced({ ...emptyStats(), updated: 1 })).toBe(true);
  });

  it('a run that hit an API or parse failure is NOT a verified check', () => {
    expect(runVerified({ ...emptyStats(), apiFailures: 1 })).toBe(false);
    expect(runVerified({ ...emptyStats(), parseFailures: 1 })).toBe(false);
  });

  it('merging lanes sums every counter', () => {
    const a = { ...emptyStats(), inserted: 2, noticesScanned: 10 };
    const b = { ...emptyStats(), inserted: 3, apiFailures: 1 };
    const m = mergeStats(a, b);
    expect(m.inserted).toBe(5);
    expect(m.noticesScanned).toBe(10);
    expect(m.apiFailures).toBe(1);
  });
});

describe('traversal coverage', () => {
  it('reports remaining work and a percentage, not a row count', () => {
    const c = coverageReport({ eligibleNotices: 207067, visitedNotices: 125578, oldestUnvisitedCreatedAt: '2026-06-01T00:00:00.000Z' });
    expect(c.remainingNotices).toBe(81489);
    expect(c.percentVisited).toBeCloseTo(60.65, 1);
    expect(c.complete).toBe(false);
  });

  it('is complete only when nothing remains', () => {
    const c = coverageReport({ eligibleNotices: 100, visitedNotices: 100, oldestUnvisitedCreatedAt: null });
    expect(c.complete).toBe(true);
    expect(c.remainingNotices).toBe(0);
  });

  it('an empty universe is UNKNOWN percent, never 100%', () => {
    const c = coverageReport({ eligibleNotices: 0, visitedNotices: 0, oldestUnvisitedCreatedAt: null });
    expect(c.percentVisited).toBeNull();
    expect(c.complete).toBe(false);
  });

  it('never reports negative remaining work if the cursor outruns the count', () => {
    expect(coverageReport({ eligibleNotices: 10, visitedNotices: 12, oldestUnvisitedCreatedAt: null }).remainingNotices).toBe(0);
  });
});

describe('source health', () => {
  const now = new Date('2026-09-20T00:00:00.000Z');
  const draining = coverageReport({ eligibleNotices: 100, visitedNotices: 40, oldestUnvisitedCreatedAt: '2026-06-01T00:00:00.000Z' });
  const done = coverageReport({ eligibleNotices: 100, visitedNotices: 100, oldestUnvisitedCreatedAt: null });

  it('never verified = UNMEASURED and alerts — inability to verify is the finding', () => {
    const h = evaluateSourceHealth({ lastSuccessfulCheck: null, lastDataAdvance: null, now, checkStaleDays: 3, coverage: draining });
    expect(h.state).toBe('unmeasured');
    expect(h.alert).toBe(true);
  });

  it('a producer silent past its budget is ingest_stale and alerts', () => {
    const h = evaluateSourceHealth({ lastSuccessfulCheck: '2026-09-10T00:00:00.000Z', lastDataAdvance: null, now, checkStaleDays: 3, coverage: done });
    expect(h.state).toBe('ingest_stale');
    expect(h.alert).toBe(true);
  });

  it('mid-drain is DRAINING, not stale — coverage debt is not a broken producer', () => {
    const h = evaluateSourceHealth({ lastSuccessfulCheck: '2026-09-19T00:00:00.000Z', lastDataAdvance: '2026-09-19T00:00:00.000Z', now, checkStaleDays: 3, coverage: draining });
    expect(h.state).toBe('draining');
    expect(h.alert).toBe(false);
    expect(h.reason).toContain('60 remaining');
  });

  it('current only when the producer is fresh AND traversal is complete', () => {
    const h = evaluateSourceHealth({ lastSuccessfulCheck: '2026-09-19T00:00:00.000Z', lastDataAdvance: '2026-09-01T00:00:00.000Z', now, checkStaleDays: 3, coverage: done });
    expect(h.state).toBe('current');
    expect(h.alert).toBe(false);
  });

  it('a stale producer is stale even while draining — coverage cannot mask a dead cron', () => {
    const h = evaluateSourceHealth({ lastSuccessfulCheck: '2026-08-01T00:00:00.000Z', lastDataAdvance: null, now, checkStaleDays: 3, coverage: draining });
    expect(h.state).toBe('ingest_stale');
  });
});
