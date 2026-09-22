/**
 * Full-document access beyond the 20,000-char inline cap.
 *
 * THE DEFECT (measured 2026-09-22 on notice a218aa7ee6554aceaf33af0da86d3582,
 * "N4008024R2401 - Solicitation.pdf", 69 pages / 192,582 stored chars):
 * get_solicitation_documents returned only the first 20,000 chars of each
 * document and offered no way to read the rest, so an agent reported it could
 * not find the evaluation factors, insurance requirements, the limitations-on-
 * subcontracting certificate, or the order limitations. Those clauses ARE in
 * the stored text, at offsets 67k–101k. Verified against the real row:
 *
 *   evaluation factor              offset   7,102   (inside the old window)
 *   limitations on subcontracting  offset  67,109   (LOST)
 *   insurance                      offset  69,995   (LOST)
 *   order limitations              offset 101,707   (LOST)
 *
 * THE INVARIANTS:
 *  1. Content past the old cap is REACHABLE by paging.
 *  2. A response that stopped early says so (coverage.complete=false) and hands
 *     back the exact continuation — a partial window is never "complete".
 *  3. Absent text says WHY (file_unavailable / extraction_failed) and is never
 *     silently an empty string.
 *  4. Text the extractor never read is 'extraction_capped', never 'complete' —
 *     paging cannot recover it, so we must not claim we delivered everything.
 *  5. Coverage is reported in CHARACTERS. Nothing converts chars to pages.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Offsets mirror the real document so the fixture can't drift into passing.
const EVAL_AT = 7_102;
const LIMSUB_AT = 67_109;
const INSURANCE_AT = 69_995;
const ORDERLIM_AT = 101_707;
const TOTAL = 192_582;

function buildSolicitationText(): string {
  const a = new Array(TOTAL).fill('.');
  const put = (at: number, phrase: string) => {
    for (let i = 0; i < phrase.length; i++) a[at + i] = phrase[i];
  };
  put(EVAL_AT, 'EVALUATION FACTORS FOR AWARD');
  put(LIMSUB_AT, 'LIMITATIONS ON SUBCONTRACTING certificate');
  put(INSURANCE_AT, 'INSURANCE REQUIREMENTS for the contractor');
  put(ORDERLIM_AT, 'ORDER LIMITATIONS apply to each task order');
  return a.join('');
}

const SOLICITATION_TEXT = buildSolicitationText();

const warmRows = [
  {
    sam_file_id: 'file-solicitation',
    sam_url: 'https://sam.gov/.../download',
    filename: 'N4008024R2401+-+Solicitation.pdf',
    mime_type: 'application/pdf',
    page_count: 69,
    char_count: TOTAL,
    extracted_text: SOLICITATION_TEXT,
    storage_path: null,
    doc_kind: 'solicitation',
    extraction_error: null,
  },
];

const mockMaybeSingle = vi.fn();
const mockWarm = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      const chain = new Proxy(b, {
        get: (_t, prop: string) => {
          if (prop === 'maybeSingle') return mockMaybeSingle;
          if (prop === 'then') return undefined;
          if (prop === 'order') return () => (table === 'pursuit_documents' ? mockWarm() : chain);
          return () => chain;
        },
      });
      return chain;
    },
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: null }),
        upload: async () => ({ error: { message: 'Bucket not found' } }),
      }),
    },
  }),
}));

vi.mock('@/lib/mcp/external-cache', () => ({
  getCached: async () => null,
  setCached: async () => undefined,
}));
vi.mock('@/lib/sam/fetch-pursuit-docs', () => ({
  normalizeNoticeId: (s: string) => s,
  MAX_EXTRACTED_TEXT_CHARS: 200_000,
  fetchAndExtractNoticeFiles: async () => ({ found: false, documents: [], degraded: false, trace: [] }),
}));
vi.mock('@/lib/mcp/flags', () => ({ mcpFlags: { aiHint: false } }));

const { solicitationDocuments } = await import('./solicitation-documents');

const NOTICE = 'a218aa7ee6554aceaf33af0da86d3582';

beforeEach(() => {
  vi.clearAllMocks();
  mockMaybeSingle.mockResolvedValue({ data: null });
  mockWarm.mockResolvedValue({ data: warmRows });
});

/** Read every window until the tool says it is done. Returns the joined text. */
async function readAll(limit: number): Promise<{ text: string; calls: number; final: Awaited<ReturnType<typeof solicitationDocuments>> }> {
  let res = await solicitationDocuments({ notice_id: NOTICE, text_limit: limit });
  let text = res.documents[0].extracted_text;
  let calls = 1;
  // Guard generously above the worst case (TOTAL/limit) so the loop bound can
  // never be what "proves" completeness — the tool's own next_page must end it.
  const maxCalls = Math.ceil(TOTAL / limit) + 5;
  while (res.next_page && calls < maxCalls) {
    res = await solicitationDocuments({ notice_id: NOTICE, text_limit: limit, document_ids: res.next_page.document_ids, documents: res.next_page.documents });
    text += res.documents[0].extracted_text;
    calls++;
  }
  return { text, calls, final: res };
}

describe('get_solicitation_documents — full-document access', () => {
  it('BEFORE-STATE: the cited clauses are genuinely outside the old 20,000-char window', async () => {
    const res = await solicitationDocuments({ notice_id: NOTICE });
    const firstWindow = res.documents[0].extracted_text;
    expect(firstWindow.length).toBe(20_000);
    // This is exactly what the agent experienced.
    expect(/limitations on subcontracting/i.test(firstWindow)).toBe(false);
    expect(/insurance requirements/i.test(firstWindow)).toBe(false);
    expect(/order limitations/i.test(firstWindow)).toBe(false);
    // ...and it must NOT be presented as the whole document.
    expect(res.coverage.complete).toBe(false);
    expect(res.documents[0].text_availability).toBe('partial');
  });

  it('the four cited sections are ALL reachable by paging to the end', async () => {
    const { text, final } = await readAll(20_000);
    expect(text.length).toBe(TOTAL);
    expect(/EVALUATION FACTORS FOR AWARD/.test(text)).toBe(true);
    expect(/LIMITATIONS ON SUBCONTRACTING/.test(text)).toBe(true);
    expect(/INSURANCE REQUIREMENTS/.test(text)).toBe(true);
    expect(/ORDER LIMITATIONS/.test(text)).toBe(true);
    expect(final.coverage.complete).toBe(true);
    expect(final.next_page).toBeNull();
  });

  it('a single larger window can reach late content directly', async () => {
    const res = await solicitationDocuments({ notice_id: NOTICE, text_offset: 60_000, text_limit: 60_000 });
    const t = res.documents[0].extracted_text;
    expect(/LIMITATIONS ON SUBCONTRACTING/.test(t)).toBe(true);
    expect(/INSURANCE REQUIREMENTS/.test(t)).toBe(true);
    expect(res.documents[0].text_window.offset).toBe(60_000);
  });

  it('next_page is an exact, ready-to-send continuation (no offset math by the agent)', async () => {
    const res = await solicitationDocuments({ notice_id: NOTICE, text_limit: 20_000 });
    expect(res.next_page).not.toBeNull();
    expect(res.next_page!.documents[0]).toMatchObject({ document_id: 'file-solicitation', offset: 20_000 });
    const second = await solicitationDocuments({ notice_id: NOTICE, document_ids: res.next_page!.document_ids, documents: res.next_page!.documents });
    expect(second.documents[0].text_window.offset).toBe(20_000);
  });

  it('next_page is SCOPED — a continuation does not re-send completed documents', async () => {
    // Two docs: one long (pages), one short (completes in the first window).
    mockWarm.mockResolvedValue({
      data: [
        warmRows[0],
        { ...warmRows[0], sam_file_id: 'file-short', filename: 'Exhibit.docx', extracted_text: 'short', char_count: 5, page_count: null },
      ],
    });
    const first = await solicitationDocuments({ notice_id: NOTICE, text_limit: 20_000 });
    expect(first.documents).toHaveLength(2);
    // Only the long doc has more text, so only it may be carried forward.
    expect(first.next_page!.document_ids).toEqual(['file-solicitation']);
    const second = await solicitationDocuments({
      notice_id: NOTICE,
      document_ids: first.next_page!.document_ids,
      documents: first.next_page!.documents,
    });
    // The completed doc is NOT re-sent from offset 0 (which would double-count it).
    expect(second.documents).toHaveLength(1);
    expect(second.documents[0].document_id).toBe('file-solicitation');
  });

  it('a MULTI-document notice pages to the end and terminates on next_page=null', async () => {
    // The suite's other completeness assertions use a SINGLE-document fixture,
    // where scoping is a no-op — so they could not see that a scoped
    // continuation makes coverage.complete unreachable on a real notice. This
    // asserts the DOCUMENTED terminator instead: next_page goes null and no
    // document is left reporting unread text.
    mockWarm.mockResolvedValue({
      data: [
        warmRows[0],
        { ...warmRows[0], sam_file_id: 'file-b', filename: 'WD.docx', extracted_text: 'x'.repeat(45_000), char_count: 45_000, page_count: null },
        { ...warmRows[0], sam_file_id: 'file-short', filename: 'Exhibit.docx', extracted_text: 'short', char_count: 5, page_count: null },
      ],
    });
    let res = await solicitationDocuments({ notice_id: NOTICE, text_limit: 20_000 });
    let calls = 1;
    while (res.next_page && calls < 60) {
      res = await solicitationDocuments({
        notice_id: NOTICE,
        document_ids: res.next_page.document_ids,
        documents: res.next_page.documents,
      });
      calls++;
    }
    expect(res.next_page).toBeNull();
    expect(res.documents.every((d) => !d.text_window.has_more)).toBe(true);
    expect(calls).toBeGreaterThan(1); // it really did page
  });

  it('a SCOPED read is never "complete" — a subset is not the package', async () => {
    mockWarm.mockResolvedValue({
      data: [
        warmRows[0],
        { ...warmRows[0], sam_file_id: 'file-short', filename: 'Exhibit.docx', extracted_text: 'short', char_count: 5, page_count: null },
      ],
    });
    // Ask for ONLY the short doc, which completes in one window. Before the
    // scoped guard this reported coverage.complete=true while the long
    // solicitation still held 172,582 unread chars on the SAME notice.
    const scoped = await solicitationDocuments({ notice_id: NOTICE, document_ids: ['file-short'] });
    expect(scoped.documents).toHaveLength(1);
    expect(scoped.documents[0].text_availability).toBe('complete');
    expect(scoped.coverage.scoped).toBe(true);
    expect(scoped.coverage.documents_not_requested).toBe(1);
    expect(scoped.coverage.complete).toBe(false);
  });

  it('next_page carries the window the caller ACTUALLY used, not the 20k default', async () => {
    // Unguarded until now: reverting this fix to `input.text_limit ?? 20_000`
    // left all 13 tests green, so a 120k reader could silently drop to 20k on
    // its own continuation (a 3-call read becoming 15) with nothing failing.
    const byRequestDefault = await solicitationDocuments({ notice_id: NOTICE, text_limit: 120_000 });
    expect(byRequestDefault.next_page!.documents[0].limit).toBe(120_000);

    // Per-document spec wins over the request default...
    const perDoc = await solicitationDocuments({
      notice_id: NOTICE,
      text_limit: 120_000,
      documents: [{ document_id: 'file-solicitation', offset: 0, limit: 90_000 }],
    });
    expect(perDoc.next_page!.documents[0].limit).toBe(90_000);

    // ...and a wildcard spec (no document_id) applies when there is no per-doc one.
    const wildcard = await solicitationDocuments({
      notice_id: NOTICE,
      documents: [{ offset: 0, limit: 50_000 }],
    });
    expect(wildcard.next_page!.documents[0].limit).toBe(50_000);

    // The continuation must then really deliver that window, not just report it.
    const continued = await solicitationDocuments({
      notice_id: NOTICE,
      document_ids: byRequestDefault.next_page!.document_ids,
      documents: byRequestDefault.next_page!.documents,
    });
    expect(continued.documents[0].text_window.returned_chars).toBe(TOTAL - 120_000);
  });

  it('documents are addressed by stable document_id, not array position', async () => {
    const res = await solicitationDocuments({
      notice_id: NOTICE,
      document_ids: ['file-solicitation'],
      text_offset: ORDERLIM_AT - 10,
      text_limit: 200,
    });
    expect(res.documents).toHaveLength(1);
    expect(res.documents[0].document_id).toBe('file-solicitation');
    expect(/ORDER LIMITATIONS/.test(res.documents[0].extracted_text)).toBe(true);
  });

  it('a response-size limit never makes the remainder inaccessible', async () => {
    // Even at a hostile 1k window the whole document is still readable.
    const { text, calls, final } = await readAll(1_000);
    expect(calls).toBe(Math.ceil(TOTAL / 1_000)); // 193 windows, all delivered
    expect(text.length).toBe(TOTAL);
    expect(text.slice(ORDERLIM_AT, ORDERLIM_AT + 17)).toBe('ORDER LIMITATIONS');
    expect(final.coverage.complete).toBe(true);
  });

  it('coverage is reported in CHARACTERS and never as pages', async () => {
    const res = await solicitationDocuments({ notice_id: NOTICE, text_limit: 20_000 });
    const w = res.documents[0].text_window;
    expect(w.total_chars).toBe(TOTAL);
    expect(w.coverage_of_stored_text).toBeCloseTo(20_000 / TOTAL, 4);
    // page_count is passed through as metadata, but nothing derives coverage from it.
    expect(JSON.stringify(res.coverage)).not.toMatch(/page/i);
  });
});

describe('missing content stays explicitly unknown', () => {
  it('a file we hold but could not parse is extraction_failed, not empty/absent', async () => {
    mockWarm.mockResolvedValue({
      data: [{ ...warmRows[0], extracted_text: null, char_count: null, extraction_error: 'PDF parse failed' }],
    });
    const res = await solicitationDocuments({ notice_id: NOTICE });
    const d = res.documents[0];
    expect(d.text_availability).toBe('extraction_failed');
    expect(res.coverage.documents_unavailable).toBe(1);
    expect(res.coverage.complete).toBe(false);
  });

  it('no file and no text is file_unavailable — absence is stated, not implied', async () => {
    mockWarm.mockResolvedValue({
      data: [{ ...warmRows[0], extracted_text: '', char_count: 0, sam_url: null, storage_path: null, extraction_error: null }],
    });
    const res = await solicitationDocuments({ notice_id: NOTICE });
    expect(res.documents[0].text_availability).toBe('file_unavailable');
    expect(res.documents[0].text_window.total_chars).toBeNull(); // unknown, NOT 0
  });

  it('text stopped at the extraction ceiling is extraction_capped, never complete', async () => {
    const capped = '.'.repeat(200_000);
    mockWarm.mockResolvedValue({
      data: [{ ...warmRows[0], extracted_text: capped, char_count: 200_000, page_count: 582 }],
    });
    const res = await solicitationDocuments({ notice_id: NOTICE, text_limit: 120_000 });
    const all = await solicitationDocuments({ notice_id: NOTICE, text_offset: 120_000, text_limit: 120_000 });
    expect(res.documents[0].text_availability).toBe('partial');
    // Even having delivered every STORED char, the file's tail was never read.
    expect(all.documents[0].text_availability).toBe('extraction_capped');
    expect(all.documents[0].extraction_capped).toBe(true);
    expect(all.coverage.complete).toBe(false);
  });
});
