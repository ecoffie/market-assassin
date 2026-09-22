/**
 * Compliance Matrix Truth — the tool contract around the deterministic gate:
 * package → document → requirement → quote → source → matrix → verify.
 * The LLM and the SAM document fetch are mocked; the gate, the coverage math and
 * the source assembly are real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const llmMock = vi.fn();
const docsMock = vi.fn();
vi.mock('@/lib/llm/call-llm', () => ({ callLLM: (a: unknown) => llmMock(a) }));
vi.mock('@/lib/sam/solicitation-documents', () => ({ getSolicitationDocuments: (a: unknown) => docsMock(a) }));

import { assembleNoticeSourceText } from '@/lib/sam/notice-identity';
import { extractComplianceMatrix } from './compliance-matrix';
import { classifyBillingOutcome } from '@/lib/mcp/credit-integrity';

const BASE = 'SECTION E - SOLICITATION PROVISIONS\n\nE.1  52.212-1  INSTRUCTIONS TO OFFERORS\n\nQuotes shall be emailed to the Contracting Officer by the closing date.\n';
const AMD = 'AMENDMENT 0001\n\nThe closing date is extended to October 30, 2026 at 10:00 EST.\n';

function doc(filename: string, text: string, availability = 'complete', kind: string | null = null) {
  return {
    filename, doc_kind: kind, mime_type: null, extracted_text: text, text_availability: availability,
    text_window: { offset: 0, returned_chars: text.length, total_chars: text.length, next_offset: null, has_more: false, coverage_of_stored_text: 1 },
    document_id: `id-${filename}`, char_count: text.length, extracted_text_truncated: false,
  };
}

let CORPUS = ''; // every document's text in the current package (what a quote can truly come from)
function pkg(documents: ReturnType<typeof doc>[]) {
  CORPUS = documents.map((d) => d.extracted_text).join(' ');
  const assembled = assembleNoticeSourceText({ sow_text: null, description: null, documents });
  return {
    notice_id: 'n1', description: null, sow_text: null, documents, degraded: false,
    truncated_attachments: assembled.truncated_attachments, source_text: assembled.text,
  };
}

// A faithful model stand-in: each window is read separately (Completeness Poteto), so a
// row comes back only from a window whose text holds its quote; a FABRICATED quote (in
// no window) comes back once, from the first window — as a real model would invent it.
const flat = (x: string) => x.replace(/\s+/g, ' ');
const llmReturns = (rows: Array<{ source_quote?: string }>) => {
  let calls = 0;
  llmMock.mockImplementation(async ({ user }: { user: string }) => {
    const first = calls++ === 0;
    const corpus = flat(`${CORPUS} ${user}`);
    const picked = rows.filter((r) => flat(user).includes(flat(String(r.source_quote ?? ''))) ||
      (first && !corpus.includes(flat(String(r.source_quote ?? '')))));
    return { text: JSON.stringify({ requirements: picked }), model: 'test-model' };
  });
};

beforeEach(() => {
  CORPUS = '';
  llmMock.mockReset();
  docsMock.mockReset();
});

describe('extract_compliance_matrix — truth contract', () => {
  it('trusted rows carry their source document; fabricated rows and a fake Section L are kept out', async () => {
    docsMock.mockResolvedValue(pkg([doc('36C24226Q0857_1.docx', BASE), doc('Amendment 0001.pdf', AMD, 'complete', 'amendment')]));
    llmReturns([
      { id: 'REQ-001', requirement: 'Email quotes to the Contracting Officer by the closing date.', category: 'submission', section: 'E.1', source_quote: 'Quotes shall be emailed to the Contracting Officer by the closing date.' },
      { id: 'REQ-002', requirement: 'Submit by the revised closing date of October 30, 2026.', category: 'submission', section: 'L', source_quote: 'The closing date is extended to October 30, 2026 at 10:00 EST.' },
      { id: 'REQ-003', requirement: 'Limit the technical volume to 25 pages.', category: 'submission', section: 'L.3.2', source_quote: 'The technical volume shall not exceed 25 pages.' },
    ]);
    const r = await extractComplianceMatrix({ notice_id: 'n1' });

    expect(r.requirements.map((x) => [x.id, x.source_doc, x.section])).toEqual([
      ['REQ-001', '36C24226Q0857_1.docx', 'E.1'],
      ['REQ-002', 'Amendment 0001.pdf', undefined], // amendment identity preserved; fake "L" dropped
    ]);
    expect(r.withheld.map((x) => [x.id, x.withheld_reason])).toEqual([['REQ-003', 'unverifiable']]);
    expect(r._meta.verification).toMatchObject({ requirements_verified: 2, candidates_withheld: 1, sections_withheld: 1 });
    expect(r._meta.count).toBe(2);
    expect(r._meta.amendments_detected).toEqual(['Amendment 0001.pdf']);
    expect(r._meta.extraction_completeness).toBe('unproven'); // a candidate was withheld
    expect(r._meta.truth_contract).toMatch(/Mindy's reading/);
    expect(JSON.stringify(r.requirements)).not.toMatch(/"section":"L/);
  });

  it('9+10: an unreadable document makes coverage partial and a missing quote is source_unavailable, not absent', async () => {
    docsMock.mockResolvedValue(pkg([doc('36C24226Q0857_1.docx', BASE), doc('Drawings.pdf', '', 'extraction_failed')]));
    llmReturns([
      { id: 'REQ-001', requirement: 'Provide shop drawings per sheet A-101.', category: 'technical', source_quote: 'Shop drawings shall conform to sheet A-101 dimensions.' },
    ]);
    const r = await extractComplianceMatrix({ notice_id: 'n1' });
    expect(r._meta.source_coverage).toMatchObject({ complete: false, documents_unreadable: 1 });
    expect(r.withheld[0].withheld_reason).toBe('source_unavailable');
    expect(r._meta.extraction_completeness).toBe('unproven');
    expect(r._meta.grounded).toBe(false);
  });

  it('extraction_coverage says exactly which documents the model read — no completeness claim from partial text', async () => {
    // Completeness Poteto: a 60K document is no longer cut at 50K — it is read in full,
    // in windows. Partial text now comes from a FAILED window, and the principle holds:
    // what was not processed is named, and completeness is not claimed.
    const big = 'The contractor shall provide all labor. '.repeat(1500); // 60K chars
    docsMock.mockResolvedValue(pkg([doc('Base.docx', big), doc('Exhibit C.docx', 'Offerors shall submit Exhibit C.')]));
    llmReturns([{ id: 'REQ-001', requirement: 'Provide all labor.', category: 'technical', source_quote: 'The contractor shall provide all labor.' }]);
    const ok = await extractComplianceMatrix({ notice_id: 'n1' });
    expect(ok._meta.extraction_coverage).toMatchObject({ complete: true, chars_read: ok._meta.extraction_coverage!.relevant_chars });
    expect(ok._meta.extraction_coverage!.documents.find((d) => d.filename === 'Exhibit C.docx')).toMatchObject({ fully_read: true });

    const impl = llmMock.getMockImplementation()!;
    let n = 0;
    llmMock.mockImplementation(async (a: { user: string }) => { if (n++ === 1) throw new Error('provider down'); return impl(a); });
    const r = await extractComplianceMatrix({ notice_id: 'n1' });
    const ec = r._meta.extraction_coverage!;
    expect(ec.complete).toBe(false);
    expect(ec.chars_read).toBeLessThan(ec.relevant_chars);
    expect(ec.uncovered_ranges.length).toBeGreaterThan(0);
    expect(r._meta.extraction_completeness).toBe('partial');
    expect(r._meta.truncated_attachments).toBe(0); // complete docs are not "truncated"
  });

  it('a complete, fully-read package with every row verified is the only case that claims source_text completeness', async () => {
    docsMock.mockResolvedValue(pkg([doc('36C24226Q0857_1.docx', BASE)]));
    llmReturns([{ id: 'REQ-001', requirement: 'Email quotes to the Contracting Officer.', category: 'submission', source_quote: 'Quotes shall be emailed to the Contracting Officer by the closing date.' }]);
    const r = await extractComplianceMatrix({ notice_id: 'n1' });
    expect(r._meta.extraction_coverage?.complete).toBe(true);
    expect(r._meta.extraction_completeness).toBe('source_text');
  });

  it('rfp_text input is verified against the text the caller supplied', async () => {
    llmReturns([
      { id: 'REQ-001', requirement: 'Email quotes to the Contracting Officer.', category: 'submission', source_quote: 'Quotes shall be emailed to the Contracting Officer by the closing date.' },
      { id: 'REQ-002', requirement: 'Hold a SECRET facility clearance.', category: 'admin', source_quote: 'Offerors shall hold a SECRET facility clearance.' },
    ]);
    const r = await extractComplianceMatrix({ rfp_text: BASE });
    expect(r.requirements.map((x) => x.source_doc)).toEqual(['Provided rfp_text']);
    expect(r.withheld.map((x) => x.withheld_reason)).toEqual(['unverifiable']);
  });
});

describe('extract_compliance_matrix — billing classification (Credit Integrity unchanged)', () => {
  it('source fetch failure is a system failure, never an empty matrix', async () => {
    docsMock.mockRejectedValue(new Error('SAM 503'));
    const r = await extractComplianceMatrix({ notice_id: 'n1' });
    expect(r._meta).toMatchObject({ grounded: false, degraded: true, count: 0 });
    expect(classifyBillingOutcome(r)).toBe('nonbillable_system_failure');
  });

  it('extraction that ran but whose candidates were all withheld is a real (billable) no-result, not degraded', async () => {
    docsMock.mockResolvedValue(pkg([doc('36C24226Q0857_1.docx', BASE)]));
    llmReturns([{ id: 'REQ-001', requirement: 'Limit to 25 pages.', category: 'submission', source_quote: 'The technical volume shall not exceed 25 pages.' }]);
    const r = await extractComplianceMatrix({ notice_id: 'n1' });
    expect(r._meta).toMatchObject({ grounded: false, degraded: false });
    expect(r._meta.verification?.candidates_withheld).toBe(1);
    expect(classifyBillingOutcome(r)).toBe('billable_no_result');
  });

  it('every extraction chunk failing is degraded (provider down), not "no requirements"', async () => {
    docsMock.mockResolvedValue(pkg([doc('36C24226Q0857_1.docx', BASE)]));
    llmMock.mockRejectedValue(new Error('all providers down'));
    const r = await extractComplianceMatrix({ notice_id: 'n1' });
    expect(r._meta).toMatchObject({ grounded: false, degraded: true });
    expect(classifyBillingOutcome(r)).toBe('nonbillable_system_failure');
  });
});
