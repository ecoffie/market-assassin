/**
 * Compliance-matrix OBLIGATION IDENTITY — the production dedupe failure (2026-09-22).
 *
 * Hosted production (merge 954e901b) returned five pairs of trusted rows that share verified
 * source evidence. In every pair each row came from a DIFFERENT extraction window, and each
 * window emitted exactly ONE row for that text — two independent readings of one obligation,
 * paraphrased differently ("Provide … coverage" vs "Maintain … insurance", $200,000 vs
 * $200,000.00), which the 60% bidirectional wording rule let through.
 *
 * Identity contract:
 *   SOURCE EVIDENCE establishes the candidate duplicate set (overlapping verified ranges).
 *   OBLIGATION COUNT is the finest single reading of that evidence: the window that emitted the
 *   most rows for it. A window is where the model may split a compound sentence into several
 *   obligations; a second window re-reading the same text is a duplicate reading, never extra
 *   obligations. No wording-similarity threshold decides identity.
 */
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/matrix-dedupe-prod-pairs-36C24226Q0857.json';
import { mergeVerifiedByEvidence } from '@/lib/proposal/matrix-merge';
import { verifyComplianceMatrix, type MatrixSourceDoc } from '@/lib/proposal/matrix-verification';

const BASE_ID = '1f7ff76547504ed68313baf2f328341f';
const ORDER = ['notice_description', BASE_ID];
const REPS = new Set(['notice_description']);
type Row = (typeof fixture.rows)[number];
const byId = (id: string) => fixture.rows.find((r) => r.id === id)! as Row;
const merge = (rows: Row[]) =>
  mergeVerifiedByEvidence({ requirements: rows as never[], interpretations: [], withheld: [] }, ORDER, new Set(), REPS);
const quoteOf = (r: { source_quote?: string }) => r.source_quote;

describe('production regression — the five pairs from hosted 954e901b', () => {
  it('the ten real rows collapse to five customer-visible obligations', () => {
    const r = merge(fixture.rows);
    expect(fixture.rows).toHaveLength(10);
    expect(r.requirements).toHaveLength(5);
  });

  it('A 082/083: $200,000 vs $200,000.00 and "provide coverage" vs "maintain insurance" do not prevent dedupe; the fuller reading survives', () => {
    const r = merge([byId('REQ-082'), byId('REQ-083')]);
    expect(r.requirements).toHaveLength(1);
    expect(r.requirements[0].requirement).toBe(byId('REQ-083').requirement); // carries all three figures
    expect((r.requirements[0] as { merged_readings?: string[] }).merged_readings).toEqual([byId('REQ-082').requirement]);
  });

  it('A 105/106: same obligation read by w8 (whole sentence) and w9 (clause) is one row; the clause reading is retained', () => {
    const r = merge([byId('REQ-105'), byId('REQ-106')]);
    expect(r.requirements).toHaveLength(1);
    expect(quoteOf(r.requirements[0])).toBe(byId('REQ-105').source_quote);
    expect((r.requirements[0] as { merged_readings?: string[] }).merged_readings).toEqual([byId('REQ-106').requirement]);
  });

  it('A 117/118: the 50% subcontracting limit read by w9 and w10 is one row', () => {
    expect(merge([byId('REQ-117'), byId('REQ-118')]).requirements).toHaveLength(1);
  });

  it('C 001/025: notice text reproducing SOW §2 is ONE requirement with BOTH sources in its provenance', () => {
    const r = merge([byId('REQ-001'), byId('REQ-025')]);
    expect(r.requirements).toHaveLength(1);
    const prov = (r.requirements[0] as { provenance?: Array<{ document_id: string; window_id: string }> }).provenance!;
    expect(prov.map((p) => p.document_id).sort()).toEqual([BASE_ID, 'notice_description'].sort());
    expect(prov.map((p) => p.window_id).sort()).toEqual(['1f7ff76547504ed68313baf2f328341f#w1', 'notice_description#w1'].sort());
    expect(r.requirements[0].verification.found_in.map((h) => h.document_id).sort()).toEqual([BASE_ID, 'notice_description'].sort());
  });

  it('084/085: each window read the sentence ONCE (neither split it) → one obligation; the other reading is retained, the quote carries both conditions', () => {
    const r = merge([byId('REQ-084'), byId('REQ-085')]);
    expect(r.requirements).toHaveLength(1);
    const s = r.requirements[0] as { source_quote?: string; merged_readings?: string[] };
    expect(s.source_quote).toMatch(/prior to award/);
    expect(s.source_quote).toMatch(/exclusionary clauses for asbestos/);
    expect(s.merged_readings).toHaveLength(1);
  });

  it('survivors are the gate\'s own rows — no quote, range or section is invented by the merge', () => {
    const r = merge(fixture.rows);
    for (const s of r.requirements) {
      const src = fixture.rows.find((x) => x.source_quote === s.source_quote && x.requirement === s.requirement)!;
      expect(src).toBeTruthy();
      expect(s.verification).toEqual(src.verification);
      expect((s as { section?: string | null }).section ?? null).toBe(src.section ?? null);
    }
  });
});

// ── controls the production pairs do not exercise ─────────────────────────────
describe('identity controls', () => {
  const text =
    'The Contractor shall submit a Quality Control Plan within 10 days of award and shall update it annually. ' +
    'The Contractor shall maintain a Quality Control Plan throughout performance. ' +
    'The contractor shall submit weekly safety reports to the COR.';
  const docs: MatrixSourceDoc[] = [{ document_id: 'd1', filename: 'Base.docx', text, role: 'attachment' }];
  const Q1 = 'The Contractor shall submit a Quality Control Plan within 10 days of award and shall update it annually.';
  const w = (id: string, doc = 'd1', s = 0, e = 500) => ({ window_id: id, document_id: doc, char_start: s, char_end: e });
  const gate = (rows: object[], d = docs) => verifyComplianceMatrix(rows as never[], d);
  const run = (rows: object[], d = docs, change = new Set<string>(), reps = new Set<string>()) =>
    mergeVerifiedByEvidence(gate(rows, d), d.map((x) => x.document_id), change, reps);

  it('one sentence with two genuinely distinct obligations, split by ONE reading → both survive, even when another window read it once', () => {
    const r = run([
      { requirement: 'Submit a Quality Control Plan within 10 days of award.', category: 'submission', source_quote: Q1, source_doc: 'Base.docx', extraction_window: w('d1#w1') },
      { requirement: 'Update the Quality Control Plan annually.', category: 'submission', source_quote: Q1, source_doc: 'Base.docx', extraction_window: w('d1#w1') },
      { requirement: 'Submit and annually update a Quality Control Plan.', category: 'submission', source_quote: Q1, source_doc: 'Base.docx', extraction_window: w('d1#w2') },
    ]);
    expect(r.requirements.map((x) => x.requirement)).toEqual([
      'Submit a Quality Control Plan within 10 days of award.',
      'Update the Quality Control Plan annually.',
    ]);
  });

  it('similar wording on DIFFERENT evidence stays separate', () => {
    const r = run([
      { requirement: 'Submit a Quality Control Plan within 10 days of award.', category: 'technical', source_quote: Q1, source_doc: 'Base.docx', extraction_window: w('d1#w1') },
      { requirement: 'Maintain a Quality Control Plan.', category: 'technical', source_quote: 'The Contractor shall maintain a Quality Control Plan throughout performance.', source_doc: 'Base.docx', extraction_window: w('d1#w2') },
    ]);
    expect(r.requirements).toHaveLength(2);
  });

  it('amendment vs base with identical wording is NOT collapsed across version identity', () => {
    const q = 'The contractor shall submit weekly safety reports to the COR.';
    const d: MatrixSourceDoc[] = [...docs, { document_id: 'amd', filename: 'Amendment 0001.pdf', text: `AMENDMENT 0001\n\n${q}`, role: 'attachment' }];
    const r = run([
      { requirement: 'Submit weekly safety reports to the COR.', category: 'submission', source_quote: q, source_doc: 'Base.docx', extraction_window: w('d1#w1') },
      { requirement: 'Submit weekly safety reports to the COR.', category: 'submission', source_quote: q, source_doc: 'Amendment 0001.pdf', extraction_window: w('amd#w1', 'amd', 0, 200) },
    ], d, new Set(['amd']));
    expect(r.requirements.map((x) => x.source_doc)).toEqual(['Base.docx', 'Amendment 0001.pdf']);
  });

  it('two CONTRACTUAL documents that copy the same clause stay separate (only the notice body is a representation)', () => {
    const q = 'The contractor shall submit weekly safety reports to the COR.';
    const d: MatrixSourceDoc[] = [
      { document_id: 'sow', filename: 'SOW.docx', text: q, role: 'attachment' },
      { document_id: 'pws', filename: 'PWS Annex.docx', text: q, role: 'attachment' },
    ];
    const r = run([
      { requirement: 'Submit weekly safety reports.', category: 'submission', source_quote: q, source_doc: 'SOW.docx', extraction_window: w('sow#w1', 'sow', 0, 100) },
      { requirement: 'Submit weekly safety reports.', category: 'submission', source_quote: q, source_doc: 'PWS Annex.docx', extraction_window: w('pws#w1', 'pws', 0, 100) },
    ], d);
    expect(r.requirements).toHaveLength(2);
  });

  it('a verified section folds onto the survivor only at the IDENTICAL location, never onto merely overlapping evidence', () => {
    const t = 'E.1 INSTRUCTIONS\n\nQuotes shall be emailed to the Contracting Officer by the closing date of October 16, 2026.';
    const d: MatrixSourceDoc[] = [{ document_id: 'd1', filename: 'Base.docx', text: t, role: 'attachment' }];
    const full = 'Quotes shall be emailed to the Contracting Officer by the closing date of October 16, 2026.';
    const part = 'Quotes shall be emailed to the Contracting Officer by the closing date';
    const same = run([
      { requirement: 'Email quotes to the Contracting Officer by October 16, 2026.', category: 'submission', source_quote: full, source_doc: 'Base.docx', extraction_window: w('d1#w1') },
      { requirement: 'Email quotes to the CO.', category: 'submission', section: 'E.1', source_quote: full, source_doc: 'Base.docx', extraction_window: w('d1#w2') },
    ], d);
    expect(same.requirements).toHaveLength(1);
    expect(same.requirements[0].section).toBe('E.1');
    const overlapOnly = run([
      { requirement: 'Email quotes to the Contracting Officer by October 16, 2026.', category: 'submission', source_quote: full, source_doc: 'Base.docx', extraction_window: w('d1#w1') },
      { requirement: 'Email quotes to the CO.', category: 'submission', section: 'E.1', source_quote: part, source_doc: 'Base.docx', extraction_window: w('d1#w2') },
    ], d);
    expect(overlapOnly.requirements).toHaveLength(1);
    expect(overlapOnly.requirements[0].section).toBeUndefined();
  });

  it('the same row repeated verbatim by overlapping windows collapses to one (the original overlap case)', () => {
    const q = 'The contractor shall submit weekly safety reports to the COR.';
    const r = run([
      { requirement: 'Submit weekly safety reports to the COR.', category: 'submission', source_quote: q, source_doc: 'Base.docx', extraction_window: w('d1#w1') },
      { requirement: 'Submit weekly safety reports to the COR.', category: 'submission', source_quote: q, source_doc: 'Base.docx', extraction_window: w('d1#w2') },
    ]);
    expect(r.requirements).toHaveLength(1);
    expect(r.summary.duplicates_merged).toBe(1);
  });
});
