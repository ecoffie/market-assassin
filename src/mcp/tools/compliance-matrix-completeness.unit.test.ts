/**
 * Compliance Matrix Completeness — PACKAGE → COVERAGE → CHUNK → EXTRACT → MERGE → DEDUPE →
 * VERIFY → COMPLETE. The LLM and the SAM fetch are mocked; windowing, disposition, the frozen
 * truth gate, evidence merge and coverage math are real.
 *
 * Invariant under test: MORE SOURCE MAY INCREASE RECALL. IT MAY NEVER REDUCE PRECISION.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const llmMock = vi.fn();
const docsMock = vi.fn();
vi.mock('@/lib/llm/call-llm', () => ({ callLLM: (a: unknown) => llmMock(a) }));
vi.mock('@/lib/sam/solicitation-documents', () => ({ getSolicitationDocuments: (a: unknown) => docsMock(a) }));

import {
  WINDOW_CHARS,
  WINDOW_OVERLAP_CHARS,
  classifyPackageDocument,
  planDocumentWindows,
  planPackageExtraction,
  splitSpreadsheetLineItems,
} from '@/lib/proposal/compliance-matrix';
import { verifyComplianceMatrix, type MatrixSourceDoc } from '@/lib/proposal/matrix-verification';
import { mergeVerifiedByEvidence } from '@/lib/proposal/matrix-merge';
import { extractComplianceMatrix } from './compliance-matrix';
import { classifyBillingOutcome } from '@/lib/mcp/credit-integrity';

// ── fixtures ──────────────────────────────────────────────────────────────────
const filler = (n: number, word = 'The Government reserves discretion over scheduling of routine site visits. ') =>
  word.repeat(Math.ceil(n / word.length)).slice(0, n);

function doc(filename: string, text: string, kind: string | null = null) {
  return {
    filename, doc_kind: kind, mime_type: null, extracted_text: text, text_availability: 'complete',
    text_window: { offset: 0, returned_chars: text.length, total_chars: text.length, next_offset: null, has_more: false, coverage_of_stored_text: 1 },
    document_id: `id-${filename}`, char_count: text.length, extracted_text_truncated: false,
  };
}
let CORPUS = '';
function pkg(documents: ReturnType<typeof doc>[], solicitation_number = '36C24226Q0857') {
  CORPUS = documents.map((d) => d.extracted_text).join(' ');
  return {
    notice_id: 'n1', solicitation_number, description: null, sow_text: null, documents, degraded: false,
    truncated_attachments: 0, source_text: documents.map((d) => d.extracted_text).join('\n\n'),
  };
}
const flat = (x: string) => x.replace(/\s+/g, ' ');
/** Model stand-in: returns a row only from a window whose text holds its quote. */
function model(rows: Array<Record<string, string>>) {
  llmMock.mockImplementation(async ({ user }: { user: string }) => ({
    text: JSON.stringify({ requirements: rows.filter((r) => flat(user).includes(flat(r.source_quote))) }),
    model: 'test-model',
  }));
}
const userTexts = () => llmMock.mock.calls.map((c) => (c[0] as { user: string }).user);

beforeEach(() => { CORPUS = ''; llmMock.mockReset(); docsMock.mockReset(); });

// ── windows / overlap ─────────────────────────────────────────────────────────
describe('windows — every character of a requirement-bearing document is read, in order', () => {
  it('windows cover the whole document, deterministically', () => {
    const t = filler(100_000);
    const w = planDocumentWindows(t);
    expect(w[0][0]).toBe(0);
    expect(w[w.length - 1][1]).toBe(t.length);
    for (let i = 1; i < w.length; i++) expect(w[i][0]).toBeLessThan(w[i - 1][1]); // overlapped, never a gap
    expect(planDocumentWindows(t)).toEqual(w);
  });

  it('4: a requirement crossing a window boundary lies WHOLLY inside some window (measured 2,000-char overlap)', () => {
    const req = 'The Contractor shall submit the Asbestos Hazard Abatement Plan '.repeat(28).trim() + '.'; // ~1,760 chars
    for (const at of [WINDOW_CHARS - 900, WINDOW_CHARS - 300, 2 * WINDOW_CHARS - 1_500]) {
      const t = filler(at) + req + filler(20_000);
      const s = t.indexOf(req);
      const inside = planDocumentWindows(t).some(([a, b]) => s >= a && s + req.length <= b);
      expect(inside, `requirement at ${at}`).toBe(true);
    }
  });

  it('4 (control): without overlap the same requirement IS split — the overlap is what prevents the loss', () => {
    const req = 'The Contractor shall submit the Asbestos Hazard Abatement Plan '.repeat(28).trim() + '.';
    const t = filler(WINDOW_CHARS - 900) + req + filler(20_000);
    const s = t.indexOf(req);
    expect(planDocumentWindows(t, WINDOW_CHARS, 0).some(([a, b]) => s >= a && s + req.length <= b)).toBe(false);
    expect(WINDOW_OVERLAP_CHARS).toBeGreaterThanOrEqual(1_924); // longest obligation sentence on the gold master
  });
});

// ── disposition ───────────────────────────────────────────────────────────────
describe('disposition — every document is read or excluded with a stated reason', () => {
  const ctx = () => ({ solicitationNumber: '36C24226Q0857', seen: new Map<string, string>() });
  it('11: a wage determination is reference_data; an identical copy is a duplicate', () => {
    const c = ctx();
    const wd = { document_id: 'wd1', filename: 'WD Essex.docx', text: 'General Decision Number: NJ20260031 07/28/2026\n\nRates Fringes ASBE0032-008 $51.74', doc_kind: 'wage_det' };
    expect(classifyPackageDocument(wd, c).disposition).toBe('reference_data');
    expect(classifyPackageDocument({ ...wd, document_id: 'wd2', filename: 'WD Somerset.docx' }, c)).toMatchObject({ disposition: 'duplicate' });
  });
  it('a misfiled document that declares a different contract and never names this solicitation is foreign_instrument', () => {
    const t = 'DETERMINATION AND FINDINGS\n\nContract Number: 36C24226C0084\n\nModification Number: P00001\n\nThe contractor shall complete the arc flash study.';
    expect(classifyPackageDocument({ document_id: 'x', filename: 'VAAR+852.219-75.docx', text: t, doc_kind: 'rep_certs' }, ctx()).disposition).toBe('foreign_instrument');
  });
  it('guards: a SOW citing a predecessor contract, a doc naming this solicitation, or an unknown solicitation number are still read', () => {
    const t = 'Contract Number: 36C24220C0001 (incumbent)\n\nThe contractor shall remove asbestos.';
    expect(classifyPackageDocument({ document_id: 'a', filename: 'SOW.docx', text: t, doc_kind: 'sow_pws' }, ctx()).disposition).toBe('extract');
    expect(classifyPackageDocument({ document_id: 'b', filename: 'Att.docx', text: `${t}\nSolicitation 36C24226Q0857`, doc_kind: null }, ctx()).disposition).toBe('extract');
    expect(classifyPackageDocument({ document_id: 'c', filename: 'Att.docx', text: t, doc_kind: null }, { solicitationNumber: null, seen: new Map() }).disposition).toBe('extract');
  });
  it('10+11: a spreadsheet sends its NOTES to the model and classifies its line items (quoted multi-line cells respected)', () => {
    const sheet = '=== Sheet: IDIQ ===\nPRICE SCHEDULE,,,\n"Item\nNo.:",Description,Units\nGENERAL DEMOLITION ACTIVITIES ARE REQUIRED TO MEET ICRA LEVEL 4,,,\n1,"Remove flooring\n(ground smooth)",SF,120\n2,Remove drywall,SF,35\nPB,Performance Bonds above $35,000.00,,\n';
    const r = splitSpreadsheetLineItems(sheet)!;
    const notes = r.notes.map(([a, b]) => sheet.slice(a, b)).join('');
    const items = r.items.map(([a, b]) => sheet.slice(a, b)).join('');
    expect(notes).toContain('ICRA LEVEL 4');
    expect(notes).toContain('Performance Bonds');
    expect(items).toContain('Remove flooring\n(ground smooth)');
    expect(notes).not.toContain('Remove drywall');
    expect(splitSpreadsheetLineItems('Plain SOW text. The contractor shall comply.')).toBeNull();
  });
});

// ── merge / dedupe / provenance (the frozen gate runs first, for real) ────────
describe('merge — identity is verified evidence, never model text or model ids', () => {
  const base = 'The Contractor shall provide a Quality Control Plan within 10 days of award. ' +
    'The Contractor shall maintain a Quality Control Plan throughout performance. ' +
    'The contractor shall submit weekly safety reports to the COR.';
  const docs: MatrixSourceDoc[] = [{ document_id: 'd1', filename: 'Base.docx', text: base, role: 'attachment' }];
  const w = (id: string, s = 0, e = base.length) => ({ window_id: id, document_id: 'd1', char_start: s, char_end: e });
  const run = (rows: object[], changeDocs = new Set<string>(), d = docs) =>
    mergeVerifiedByEvidence(verifyComplianceMatrix(rows as never[], d), d.map((x) => x.document_id), changeDocs);

  it('5: the same obligation rediscovered by two overlapping windows is ONE trusted row', () => {
    const q = 'The contractor shall submit weekly safety reports to the COR.';
    const r = run([
      { id: 'REQ-004', requirement: 'Submit weekly safety reports to the COR.', category: 'submission', source_quote: q, source_doc: 'Base.docx', extraction_window: w('d1#w1') },
      { id: 'REQ-001', requirement: 'Submit weekly safety reports to the COR', category: 'submission', source_quote: q, source_doc: 'Base.docx', extraction_window: w('d1#w2') },
    ]);
    expect(r.requirements).toHaveLength(1);
    expect(r.summary.duplicates_merged).toBe(1);
  });

  it('6: two DISTINCT requirements with near-identical wording on different evidence are never merged', () => {
    const r = run([
      { requirement: 'Provide a Quality Control Plan.', category: 'technical', source_quote: 'The Contractor shall provide a Quality Control Plan within 10 days of award.', source_doc: 'Base.docx', extraction_window: w('d1#w1') },
      { requirement: 'Maintain a Quality Control Plan.', category: 'technical', source_quote: 'The Contractor shall maintain a Quality Control Plan throughout performance.', source_doc: 'Base.docx', extraction_window: w('d1#w1') },
    ]);
    expect(r.requirements).toHaveLength(2);
  });

  it('a compound sentence split into two obligations (same evidence, different readings) keeps BOTH', () => {
    const q = 'The Contractor shall provide a Quality Control Plan within 10 days of award.';
    const r = run([
      { requirement: 'Provide a Quality Control Plan.', category: 'technical', source_quote: q, source_doc: 'Base.docx', extraction_window: w('d1#w1') },
      { requirement: 'Deliver it within 10 days of award.', category: 'submission', source_quote: q, source_doc: 'Base.docx', extraction_window: w('d1#w1') },
    ]);
    expect(r.requirements).toHaveLength(2);
  });

  it('7+8: document and range identity survive extraction and merge; ids are re-issued in document order, unique across lists', () => {
    const r = run([
      { id: 'REQ-009', requirement: 'Submit weekly safety reports.', category: 'submission', source_quote: 'The contractor shall submit weekly safety reports to the COR.', source_doc: 'Base.docx', extraction_window: w('d1#w2') },
      { id: 'REQ-001', requirement: 'Provide a Quality Control Plan.', category: 'technical', source_quote: 'The Contractor shall provide a Quality Control Plan within 10 days of award.', source_doc: 'Base.docx', extraction_window: w('d1#w1') },
      { id: 'REQ-001', requirement: 'Hold a clearance.', category: 'admin', source_quote: 'Offerors shall hold a SECRET facility clearance.', source_doc: 'Base.docx', extraction_window: w('d1#w1') },
    ]);
    expect(r.requirements.map((x) => [x.id, x.source_doc, x.verification.found_in[0].char_start])).toEqual([
      ['REQ-001', 'Base.docx', 0],
      ['REQ-002', 'Base.docx', base.indexOf('The contractor shall submit')],
    ]);
    expect(r.requirements[1].extraction_window).toMatchObject({ window_id: 'd1#w2', document_id: 'd1' });
    expect(r.withheld.map((x) => x.id)).toEqual(['REQ-003']);
  });

  it('provenance: a quote that exists in the document but OUTSIDE the window the model read is withheld (memory, not reading)', () => {
    const r = run([
      { requirement: 'Submit weekly safety reports.', category: 'submission', source_quote: 'The contractor shall submit weekly safety reports to the COR.', source_doc: 'Base.docx', extraction_window: w('d1#w1', 0, 60) },
    ]);
    expect(r.requirements).toHaveLength(0);
    expect(r.withheld[0].withheld_reason).toBe('source_mismatch');
    expect(r.summary.outside_window_withheld).toBe(1);
  });

  it('amendment identity: an amendment row is never merged into an identical base row', () => {
    const q = 'The contractor shall submit weekly safety reports to the COR.';
    const d: MatrixSourceDoc[] = [...docs, { document_id: 'amd', filename: 'Amendment 0001.pdf', text: `AMENDMENT 0001\n\n${q}`, role: 'attachment' }];
    const r = run([
      { requirement: 'Submit weekly safety reports to the COR.', category: 'submission', source_quote: q, source_doc: 'Base.docx', extraction_window: w('d1#w1') },
      { requirement: 'Submit weekly safety reports to the COR.', category: 'submission', source_quote: q, source_doc: 'Amendment 0001.pdf', extraction_window: { window_id: 'amd#w1', document_id: 'amd', char_start: 0, char_end: 200 } },
    ], new Set(['amd']), d);
    expect(r.requirements.map((x) => x.source_doc)).toEqual(['Base.docx', 'Amendment 0001.pdf']);
  });
});

// ── the tool, end to end ──────────────────────────────────────────────────────
describe('extract_compliance_matrix — completeness', () => {
  const LATE = 'Offerors shall submit a Technical Capability Statement not to exceed five (5) pages.';
  const ATT3 = 'Offerors shall send the Past Performance Questionnaire to each reference contact.';

  it('1+2+9: a requirement beyond character 50,000 (late Section E) is recovered — the old window could never reach it', async () => {
    const base = `SECTION E - SOLICITATION PROVISIONS\n\n${filler(120_000)}\n\n${LATE}\n\n${filler(5_000)}`;
    docsMock.mockResolvedValue(pkg([doc('Base.docx', base, 'sow_pws')]));
    model([{ requirement: 'Submit a Technical Capability Statement of at most five (5) pages.', category: 'evaluation', source_quote: LATE }]);
    const r = await extractComplianceMatrix({ notice_id: 'n1' });
    expect(base.indexOf(LATE)).toBeGreaterThan(50_000);
    expect(r.requirements.map((x) => x.source_quote)).toEqual([LATE]);
    expect(r._meta.extraction_coverage).toMatchObject({ complete: true, windows_failed: 0 });
    expect(r._meta.extraction_completeness).toBe('source_text');
  });

  it('3+7+8: a requirement in the THIRD attachment is recovered with its own document identity and window', async () => {
    docsMock.mockResolvedValue(pkg([
      doc('Base.docx', `${filler(60_000)}\n\nThe contractor shall comply.`, 'sow_pws'),
      doc('Exhibit B.docx', 'Sample transmittal letter for references.'),
      doc('Exhibit C.docx', `INSTRUCTIONS TO OFFEROR\n\n${ATT3}`, 'past_perf_form'),
    ]));
    model([{ requirement: 'Send the PPQ to each reference contact.', category: 'past_performance', source_quote: ATT3 }]);
    const r = await extractComplianceMatrix({ notice_id: 'n1' });
    expect(r.requirements).toHaveLength(1);
    expect(r.requirements[0]).toMatchObject({ source_doc: 'Exhibit C.docx', extraction_window: { document_id: 'id-Exhibit C.docx' } });
    expect(r.requirements[0].verification.found_in[0]).toMatchObject({ document_id: 'id-Exhibit C.docx', char_start: 25 });
  });

  it('11: a wage determination never reaches the model and yields no rows; the obligation stays with the contract clause', async () => {
    const wd = `General Decision Number: NJ20260031\n\n${'ASBE0032-008 ASBESTOS WORKER $51.74 46.20\n'.repeat(900)}`;
    docsMock.mockResolvedValue(pkg([doc('Base.docx', 'The Contractor shall pay wages per the attached wage determination.', 'sow_pws'), doc('WD Essex.docx', wd, 'wage_det')]));
    model([{ requirement: 'Pay wages per the wage determination.', category: 'admin', source_quote: 'The Contractor shall pay wages per the attached wage determination.' }]);
    const r = await extractComplianceMatrix({ notice_id: 'n1' });
    expect(userTexts().some((u) => u.includes('General Decision Number'))).toBe(false);
    expect(r.requirements).toHaveLength(1);
    expect(r._meta.extraction_coverage!.documents.find((d) => d.filename === 'WD Essex.docx')).toMatchObject({ disposition: 'reference_data', chars_read: 0 });
    expect(r._meta.extraction_completeness).toBe('source_text'); // a stated exclusion is not a coverage gap
  });

  it('12+17: a failed window → partial, the range is named, verified rows from other windows remain, and it stays billable', async () => {
    const base = `${LATE}\n\n${filler(40_000)}`;
    docsMock.mockResolvedValue(pkg([doc('Base.docx', base, 'sow_pws')]));
    model([{ requirement: 'Submit a Technical Capability Statement of at most five (5) pages.', category: 'evaluation', source_quote: LATE }]);
    const impl = llmMock.getMockImplementation()!;
    llmMock.mockImplementation(async (a: { user: string }) => { if (!a.user.includes(LATE)) throw new Error('429'); return impl(a); });
    const r = await extractComplianceMatrix({ notice_id: 'n1' });
    expect(r.requirements).toHaveLength(1);
    expect(r._meta.extraction_completeness).toBe('partial');
    expect(r._meta.extraction_coverage!.uncovered_ranges[0]).toMatchObject({ filename: 'Base.docx', reason: 'failed' });
    expect(r._meta.completeness_reasons![0]).toMatch(/UNKNOWN, not absent/);
    expect(r._meta.degraded).toBe(false);
    expect(classifyBillingOutcome(r)).toBe('billable_success');
  });

  it('12+17: a failed window with NOTHING verified is a system failure (non-billable), never "no requirements"', async () => {
    docsMock.mockResolvedValue(pkg([doc('Base.docx', filler(40_000), 'sow_pws')]));
    let n = 0;
    llmMock.mockImplementation(async () => { if (n++ === 0) throw new Error('429'); return { text: '{"requirements":[]}', model: 'm' }; });
    const r = await extractComplianceMatrix({ notice_id: 'n1' });
    expect(r._meta).toMatchObject({ grounded: false, degraded: true, extraction_completeness: 'partial' });
    expect(classifyBillingOutcome(r)).toBe('nonbillable_system_failure');
  });

  it('13: complete (source_text) requires full coverage AND every candidate verified — one withheld row keeps it unproven', async () => {
    docsMock.mockResolvedValue(pkg([doc('Base.docx', `${LATE}\n\n${filler(30_000)}`, 'sow_pws')]));
    llmMock.mockImplementation(async ({ user }: { user: string }) => ({
      text: JSON.stringify({ requirements: user.includes(LATE) ? [
        { requirement: 'Submit a Technical Capability Statement of at most five (5) pages.', category: 'evaluation', source_quote: LATE },
        { requirement: 'Hold a SECRET clearance.', category: 'admin', source_quote: 'Offerors shall hold a SECRET facility clearance.' },
      ] : [] }),
      model: 'm',
    }));
    const r = await extractComplianceMatrix({ notice_id: 'n1' });
    expect(r._meta.extraction_coverage!.complete).toBe(true);
    expect(r._meta.extraction_completeness).toBe('unproven');
    expect(r._meta.completeness_reasons).toEqual(['1 candidate(s) withheld — what they point at could not be verified']);
  });

  it('15+16: fake Section L and an added figure never survive the larger read', async () => {
    docsMock.mockResolvedValue(pkg([doc('Base.docx', `SECTION E\n\nE.1 INSTRUCTIONS\n\n${LATE}\n\n${filler(30_000)}`, 'sow_pws')]));
    model([
      { requirement: 'Submit a Technical Capability Statement of at most five (5) pages.', category: 'evaluation', section: 'L', source_quote: LATE },
      { requirement: 'Submit a Technical Capability Statement of at most 25 pages.', category: 'evaluation', section: 'L.3', source_quote: LATE },
    ]);
    const r = await extractComplianceMatrix({ notice_id: 'n1' });
    expect(JSON.stringify(r.requirements)).not.toMatch(/"section":"L/);
    expect(r.requirements.map((x) => x.requirement)).toEqual(['Submit a Technical Capability Statement of at most five (5) pages.']);
    expect(r.withheld.map((x) => x.withheld_reason)).toEqual(['quote_does_not_support_requirement']);
  });

  it('amendment: an amendment keeps its own document identity and is read with the change prompt, not merged into base', async () => {
    const q = 'The closing date is extended to October 30, 2026 at 10:00 EST.';
    docsMock.mockResolvedValue(pkg([doc('Base.docx', 'Quotes are due October 16, 2026.', 'sow_pws'), doc('Amendment 0001.pdf', `AMENDMENT 0001\n\n${q}`, 'amendment')]));
    model([{ requirement: 'Submit by the revised closing date of October 30, 2026.', category: 'submission', source_quote: q }]);
    const r = await extractComplianceMatrix({ notice_id: 'n1' });
    expect(r.requirements.map((x) => x.source_doc)).toEqual(['Amendment 0001.pdf']);
    expect(r._meta.amendments_detected).toEqual(['Amendment 0001.pdf']);
    expect(llmMock.mock.calls.some((c) => /Amendment\/Q&A: Amendment 0001\.pdf/.test((c[0] as { user: string }).user))).toBe(true);
  });

  it('_meta.model names the model that actually answered, not a hard-coded constant', async () => {
    docsMock.mockResolvedValue(pkg([doc('Base.docx', LATE, 'sow_pws')]));
    model([{ requirement: 'Submit a Technical Capability Statement of at most five (5) pages.', category: 'evaluation', source_quote: LATE }]);
    const r = await extractComplianceMatrix({ notice_id: 'n1' });
    expect(r._meta.model).toBe('test-model');
  });

  it('the plan stays inside the runtime envelope; windows beyond the cap are REPORTED, not silently dropped', () => {
    const plan = planPackageExtraction([{ document_id: 'big', filename: 'Huge.pdf', text: filler(700_000), doc_kind: 'sow_pws' }], { maxWindows: 40 });
    expect(plan.windows).toHaveLength(40);
    expect(plan.dropped.length).toBeGreaterThan(0);
  });
});
