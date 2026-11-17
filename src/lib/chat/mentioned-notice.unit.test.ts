import { describe, it, expect } from 'vitest';
import { extractNoticeRefs, userTextsNewestFirst, resolveMentionedNotice, lookupNoticeRef } from './mentioned-notice';

const NID = '1a02451bf3e04edf93f56216c2113d73';
type Row = { notice_id: string; solicitation_number: string | null; posted_date: string | null };

/** A fake sam_opportunities: notice_id eq / solicitation_number ilike (exact, case-insensitive). */
function fakeDb(rows: Row[], opts: { error?: boolean } = {}) {
  const calls: Array<{ col: string; val: string }> = [];
  const db = {
    from: () => {
      let col = ''; let val = '';
      const q = {
        select: () => q,
        eq: (c: string, v: string) => { col = c; val = v; return q; },
        ilike: (c: string, v: string) => { col = c; val = v; return q; },
        limit: async () => {
          calls.push({ col, val });
          if (opts.error) return { data: null, error: { message: 'down' } };
          const unesc = val.replace(/\\(.)/g, '$1');
          const data = rows.filter((r) => col === 'notice_id' ? r.notice_id === val : String(r.solicitation_number).toUpperCase() === unesc.toUpperCase());
          return { data, error: null };
        },
      };
      return q;
    },
  };
  return { db, calls };
}

describe('extractNoticeRefs', () => {
  it('finds solicitation numbers with sentence punctuation removed', () => {
    expect(extractNoticeRefs('Tell me about solicitation SPRPA127RUA05.')).toEqual([{ kind: 'solicitation_number', value: 'SPRPA127RUA05' }]);
    expect(extractNoticeRefs('Analyze 70ZL26-27-SectorKWJanitorialServices (Coast Guard Key West)')).toEqual([
      { kind: 'solicitation_number', value: '70ZL26-27-SectorKWJanitorialServices' },
    ]);
  });
  it('finds notice ids, hyphenated or not, normalized to 32 lowercase hex', () => {
    expect(extractNoticeRefs(`notice ${NID.toUpperCase()}`)).toEqual([{ kind: 'notice_id', value: NID }]);
    expect(extractNoticeRefs('1a02451b-f3e0-4edf-93f5-6216c2113d73')).toEqual([{ kind: 'notice_id', value: NID }]);
  });
  it('ignores ordinary words, NAICS codes and one-digit tokens; de-duplicates', () => {
    expect(extractNoticeRefs('I run a janitorial company, NAICS 561720, since COVID-19 in Florida')).toEqual([]);
    expect(extractNoticeRefs('SPRPA127RUA05 and sprpa127rua05')).toHaveLength(1);
  });
});

describe('userTextsNewestFirst', () => {
  it('current message first, then earlier USER turns newest first; assistant turns skipped', () => {
    expect(userTextsNewestFirst('now', [
      { role: 'user', content: 'first' }, { role: 'assistant', content: 'A SPRPA127RUA05' }, { role: 'user', content: 'second' },
    ])).toEqual(['now', 'second', 'first']);
  });
});

describe('resolveMentionedNotice', () => {
  const sprpa: Row = { notice_id: NID, solicitation_number: 'SPRPA127RUA05', posted_date: '2026-11-01' };

  it('resolves the number in the current message', async () => {
    const { db } = fakeDb([sprpa]);
    const r = await resolveMentionedNotice(db, 'Tell me about SPRPA127RUA05', []);
    expect(r).toMatchObject({ status: 'resolved', notice: { record: { notice_id: NID }, fromEarlierTurn: false } });
  });

  it('C1b T6: a message with no number uses the number from an earlier user turn', async () => {
    const { db } = fakeDb([sprpa]);
    const r = await resolveMentionedNotice(db, 'Email the contracting officer for me', [
      { role: 'user', content: 'Tell me about solicitation SPRPA127RUA05' }, { role: 'assistant', content: '…' },
    ]);
    expect(r).toMatchObject({ status: 'resolved', notice: { fromEarlierTurn: true, ref: { value: 'SPRPA127RUA05' } } });
  });

  it('the newest message that names a notice decides', async () => {
    const other: Row = { notice_id: 'b'.repeat(32), solicitation_number: 'W912PL26Q0042', posted_date: '2026-11-02' };
    const { db } = fakeDb([sprpa, other]);
    const r = await resolveMentionedNotice(db, 'and this one?', [
      { role: 'user', content: 'SPRPA127RUA05' }, { role: 'user', content: 'what about W912PL26Q0042' },
    ]);
    expect(r).toMatchObject({ status: 'resolved', notice: { record: { notice_id: 'b'.repeat(32) } } });
  });

  it('two different notices in one message → ambiguous, nothing attached', async () => {
    const other: Row = { notice_id: 'b'.repeat(32), solicitation_number: 'W912PL26Q0042', posted_date: null };
    const { db } = fakeDb([sprpa, other]);
    expect(await resolveMentionedNotice(db, 'Compare SPRPA127RUA05 with W912PL26Q0042', [])).toEqual({ status: 'ambiguous', count: 2 });
  });

  it('several versions of one solicitation are one notice; the newest posted wins', async () => {
    const amd: Row = { notice_id: 'c'.repeat(32), solicitation_number: 'SPRPA127RUA05', posted_date: '2026-11-10' };
    const { db } = fakeDb([sprpa, amd]);
    const r = await resolveMentionedNotice(db, 'SPRPA127RUA05', []);
    expect(r).toMatchObject({ status: 'resolved', notice: { record: { notice_id: 'c'.repeat(32) } } });
  });

  it('a number only in an assistant answer is never looked up', async () => {
    const { db, calls } = fakeDb([sprpa]);
    expect(await resolveMentionedNotice(db, 'which first?', [{ role: 'assistant', content: 'SPRPA127RUA05' }])).toEqual({ status: 'none' });
    expect(calls).toEqual([]);
  });

  it('a miss or a read error attaches nothing', async () => {
    expect(await resolveMentionedNotice(fakeDb([]).db, 'SPRPA127RUA05', [])).toEqual({ status: 'none' });
    expect(await resolveMentionedNotice(fakeDb([sprpa], { error: true }).db, 'SPRPA127RUA05', [])).toEqual({ status: 'none' });
  });

  it('bounded: at most 4 lookups per request', async () => {
    const { db, calls } = fakeDb([]);
    await resolveMentionedNotice(db, 'AB12CD34 EF56GH78 IJ90KL12 MN34OP56 QR78ST90 UV12WX34', [{ role: 'user', content: 'YZ56AB78' }]);
    expect(calls).toHaveLength(4);
  });

  it('LIKE wildcards in the token are escaped (an exact match only)', async () => {
    const { db, calls } = fakeDb([]);
    await lookupNoticeRef(db, { kind: 'solicitation_number', value: 'W912_PL26%Q42' });
    expect(calls[0]).toEqual({ col: 'solicitation_number', val: 'W912\\_PL26\\%Q42' });
  });
});
