import { describe, it, expect } from 'vitest';
import {
  decorateTitle, undecorateTitle, billVersionsToDocuments,
  committeeReportToDocument, type BillRef,
} from './legislation';
import { knownMeasures } from './legislation-discovery';

const RAW_TITLE = 'To amend the National Defense Authorization Act for Fiscal Year 2000 to modify and extend the annual report on military and security developments involving the People’s Republic of China.';
const ref = (o: Partial<BillRef> = {}): BillRef => ({
  congress: 119, billType: 'HR', number: '5180', title: RAW_TITLE,
  updateDate: null, originChamber: 'House', ...o,
});
const VERSIONS = [{ type: 'Introduced in House', date: '2025-09-08T04:00:00Z', formats: [] }];
const NO_LAW = { latestActionDate: null, latestActionText: null, becameLaw: false, lawNumber: null };
const titleOf = (r: BillRef) => billVersionsToDocuments(r, VERSIONS, NO_LAW, 'T')[0].title;

describe('1. API raw title receives EXACTLY ONE suffix', () => {
  it('decorates once', () => {
    const t = titleOf(ref());
    expect(t).toBe(`${RAW_TITLE} [HR 5180 — Introduced in House]`);
    expect(t.split('[HR 5180 — Introduced in House]')).toHaveLength(2);  // exactly one
  });
});

describe('2. a once-decorated persisted title stays once-decorated', () => {
  it('re-decorating an already-decorated title is a no-op', () => {
    const once = titleOf(ref());
    expect(titleOf(ref({ title: once }))).toBe(once);
  });
  it('decorate is idempotent as a pure function', () => {
    const a = decorateTitle(RAW_TITLE, 'HR 5180 — Introduced in House');
    expect(decorateTitle(a, 'HR 5180 — Introduced in House')).toBe(a);
  });
});

describe('3. 2–5 stacked suffixes converge to exactly one', () => {
  it.each([2, 3, 4, 5])('collapses %i copies', (n) => {
    const polluted = RAW_TITLE + ' [HR 5180 — Introduced in House]'.repeat(n);
    const fixed = titleOf(ref({ title: polluted }));
    expect(fixed).toBe(`${RAW_TITLE} [HR 5180 — Introduced in House]`);
    expect(fixed.split('[HR 5180').length - 1).toBe(1);
  });
  it('undecorateTitle strips all copies and returns the source title', () => {
    expect(undecorateTitle(RAW_TITLE + ' [HR 5180 — Introduced in House]'.repeat(4))).toBe(RAW_TITLE);
  });
});

describe('4. two consecutive tracking-path runs are byte-identical', () => {
  /** Mirrors knownMeasures -> billVersionsToDocuments, the loop that corrupted prod. */
  const trackOnce = (storedTitle: string, storedRaw: Record<string, unknown>) => {
    const reconstructed = typeof storedRaw.billTitle === 'string' && storedRaw.billTitle
      ? (storedRaw.billTitle as string)
      : undecorateTitle(storedTitle);
    const doc = billVersionsToDocuments(ref({ title: reconstructed }), VERSIONS, NO_LAW, 'T')[0];
    return { title: doc.title, raw: doc.raw as Record<string, unknown> };
  };

  it('does not grow the title across runs (the production defect)', () => {
    let state = trackOnce(RAW_TITLE, {});
    const first = state.title;
    for (let i = 0; i < 5; i++) state = trackOnce(state.title, state.raw);
    expect(state.title).toBe(first);
  });

  it('converges a polluted row to the canonical title and then holds', () => {
    const polluted = RAW_TITLE + ' [HR 5180 — Introduced in House]'.repeat(4);
    let state = trackOnce(polluted, {});            // legacy row: no billTitle yet
    expect(state.title).toBe(`${RAW_TITLE} [HR 5180 — Introduced in House]`);
    const after = state.title;
    state = trackOnce(state.title, state.raw);
    expect(state.title).toBe(after);
  });

  it('persists the authoritative undecorated title in raw.billTitle', () => {
    const doc = billVersionsToDocuments(ref(), VERSIONS, NO_LAW, 'T')[0];
    expect((doc.raw as Record<string, unknown>).billTitle).toBe(RAW_TITLE);
  });

  it('knownMeasures reads raw.billTitle, not the decorated column', async () => {
    const rows = [{
      title: `${RAW_TITLE} [HR 5180 — Introduced in House] [HR 5180 — Introduced in House]`,
      raw: { congress: 119, billType: 'HR', billNumber: '5180', billTitle: RAW_TITLE },
    }];
    const db = { from: () => ({ select: () => ({ in: () => ({ order: () => ({ range: async () => ({ data: rows, error: null }) }) }) }) }) };
    const r = await knownMeasures(db as never, 119);
    expect(r.measures[0].title).toBe(RAW_TITLE);      // undecorated, not the column
  });

  it('knownMeasures falls back to undecorating a legacy row with no billTitle', async () => {
    const rows = [{
      title: `${RAW_TITLE} [HR 5180 — Introduced in House] [HR 5180 — Introduced in House]`,
      raw: { congress: 119, billType: 'HR', billNumber: '5180' },
    }];
    const db = { from: () => ({ select: () => ({ in: () => ({ order: () => ({ range: async () => ({ data: rows, error: null }) }) }) }) }) };
    const r = await knownMeasures(db as never, 119);
    expect(r.measures[0].title).toBe(RAW_TITLE);
  });
});

describe('5. different versions still get their own distinct suffixes', () => {
  it('IH / RH / EH stay distinct', () => {
    const docs = billVersionsToDocuments(ref({ number: '8800', title: 'National Defense Authorization Act for Fiscal Year 2027' }), [
      { type: 'Introduced in House', date: '2026-05-13T04:00:00Z', formats: [] },
      { type: 'Reported in House', date: '2026-06-15T04:00:00Z', formats: [] },
      { type: 'Engrossed in House', date: '2026-07-22T04:00:00Z', formats: [] },
    ], NO_LAW, 'T');
    expect(docs.map((d) => d.title)).toEqual([
      'National Defense Authorization Act for Fiscal Year 2027 [HR 8800 — Introduced in House]',
      'National Defense Authorization Act for Fiscal Year 2027 [HR 8800 — Reported in House]',
      'National Defense Authorization Act for Fiscal Year 2027 [HR 8800 — Engrossed in House]',
    ]);
    expect(new Set(docs.map((d) => d.documentNumber)).size).toBe(3);
  });
});

describe('6. errata / report behaviour unchanged', () => {
  const rpt = (citation: string) => committeeReportToDocument(
    { type: 'SRPT', number: 39, congress: 119, part: 1, citation, issueDate: '2025-07-15T04:00:00Z', title: 'NDAA FY2026', chamber: 'Senate' }, 'T')!;
  it('base and errata keep distinct identities and titles', () => {
    expect(rpt('S. Rept. 119-39').documentNumber).toBe('119-SRPT-39');
    expect(rpt('S. Rept. 119-39,Errata').documentNumber).toBe('119-SRPT-39-ERRATA');
    expect(rpt('S. Rept. 119-39,Errata').title).toMatch(/Errata/);
  });
});

describe('7. identity never changes to solve a title problem', () => {
  it('document_number is identical for raw, once- and five-times-decorated input', () => {
    const polluted = RAW_TITLE + ' [HR 5180 — Introduced in House]'.repeat(5);
    const a = billVersionsToDocuments(ref(), VERSIONS, NO_LAW, 'T')[0].documentNumber;
    const b = billVersionsToDocuments(ref({ title: polluted }), VERSIONS, NO_LAW, 'T')[0].documentNumber;
    expect(a).toBe('119-HR5180-IH');
    expect(b).toBe(a);
  });
});

describe('8. the matcher does not eat legitimate source text', () => {
  it('leaves a bracketed phrase that is not Mindy decoration', () => {
    const t = 'A bill [as amended] to do things — including dashes';
    expect(undecorateTitle(t)).toBe(t);
  });
  it('leaves a trailing bracket without the bill-number/em-dash shape', () => {
    const t = 'A bill about [section 844]';
    expect(undecorateTitle(t)).toBe(t);
  });
  it('strips only the trailing decoration, preserving earlier brackets', () => {
    const t = 'A bill [as amended] to do things [HR 5180 — Introduced in House]';
    expect(undecorateTitle(t)).toBe('A bill [as amended] to do things');
  });
});
