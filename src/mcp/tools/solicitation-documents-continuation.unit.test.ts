/**
 * get_solicitation_documents — bounded free continuation + the scope-document signal
 * (ChatGPT submission blocker #2, owner decision 2026-10-04).
 *
 * Measured case: W5168W26RA015's latest amendment holds a 725-page reference guide
 * (doc_kind attachment_other) + an industry-questions sheet and NO statement of work. A
 * "summarize the scope" prompt paged the guide 9× at 10 credits each. The tool must (a) say the
 * scope document is not in the package, and (b) hand back a continuation that bills as part of
 * the paid retrieval.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const GUIDE_TOTAL = 200_000;
const guideRow = {
  sam_file_id: 'file-guide',
  sam_url: 'https://sam.gov/.../download',
  filename: 'TE+H0002+-+Army+BUILDER+SMS+Inventory+and+Assessment+Guide.pdf',
  mime_type: 'application/pdf',
  page_count: 725,
  char_count: GUIDE_TOTAL,
  extracted_text: 'g'.repeat(GUIDE_TOTAL),
  storage_path: null,
  doc_kind: 'attachment_other',
  extraction_error: null,
};
const qaRow = { ...guideRow, sam_file_id: 'file-qa', filename: 'Attachment_Q2__Industry_Questions.xlsx', page_count: null, char_count: 2_832, extracted_text: 'q'.repeat(2_832), doc_kind: 'qa' };
const pwsRow = { ...guideRow, sam_file_id: 'file-pws', filename: 'PWS_Base_Operations.pdf', page_count: 40, char_count: 5_000, extracted_text: 'p'.repeat(5_000), doc_kind: 'sow_pws' };

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
vi.mock('@/lib/mcp/external-cache', () => ({ getCached: async () => null, setCached: async () => undefined }));
vi.mock('@/lib/sam/fetch-pursuit-docs', () => ({
  normalizeNoticeId: (s: string) => s,
  MAX_EXTRACTED_TEXT_CHARS: 1_000_000,
  fetchAndExtractNoticeFiles: async () => ({ found: false, documents: [], degraded: false, trace: [] }),
}));
const flags = { aiHint: false };
vi.mock('@/lib/mcp/flags', () => ({ mcpFlags: flags }));

const { solicitationDocuments } = await import('./solicitation-documents');
const { isFreeDocumentContinuation, MAX_FREE_CONTINUATIONS } = await import('@/lib/mcp/doc-continuation');

const NOTICE = '6751556dbd1c4c25a46a3f30ac01bb59';
const USER = 'reader@example.com';

beforeAll(() => {
  process.env.MCP_OAUTH_SIGNING_SECRET = 'test-secret-docs';
});
beforeEach(() => {
  vi.clearAllMocks();
  flags.aiHint = false;
  mockMaybeSingle.mockResolvedValue({ data: null });
  mockWarm.mockResolvedValue({ data: [guideRow, qaRow] });
});

describe('continuation token on next_page', () => {
  it('a paid first retrieval hands back next_page WITH a continuation that bills as free', async () => {
    const first = await solicitationDocuments({ notice_id: NOTICE, userEmail: USER });
    expect(first.next_page).not.toBeNull();
    expect(typeof first.next_page!.continuation).toBe('string');
    expect(first._meta.continuation_page).toBeNull();
    // Exactly what a host sends back, verbatim:
    const args = { notice_id: NOTICE, document_ids: first.next_page!.document_ids, documents: first.next_page!.documents, continuation: first.next_page!.continuation };
    expect(isFreeDocumentContinuation('get_solicitation_documents', args, USER)).toBe(true);
  });

  it('following the continuation reads the next window and numbers the page', async () => {
    const first = await solicitationDocuments({ notice_id: NOTICE, userEmail: USER });
    const second = await solicitationDocuments({
      notice_id: NOTICE,
      userEmail: USER,
      document_ids: first.next_page!.document_ids,
      documents: first.next_page!.documents,
      continuation: first.next_page!.continuation,
    });
    expect(second._meta.continuation_page).toBe(1);
    expect(second.documents[0].text_window.offset).toBe(20_000);
    expect(isFreeDocumentContinuation('get_solicitation_documents', {
      notice_id: NOTICE, document_ids: second.next_page!.document_ids, documents: second.next_page!.documents, continuation: second.next_page!.continuation,
    }, USER)).toBe(true);
  });

  it('another user cannot ride the continuation (their call bills)', async () => {
    const first = await solicitationDocuments({ notice_id: NOTICE, userEmail: USER });
    const args = { notice_id: NOTICE, document_ids: first.next_page!.document_ids, documents: first.next_page!.documents, continuation: first.next_page!.continuation };
    expect(isFreeDocumentContinuation('get_solicitation_documents', args, 'someone@else.com')).toBe(false);
  });

  it('changing the window turns it into a new paid retrieval', async () => {
    const first = await solicitationDocuments({ notice_id: NOTICE, userEmail: USER });
    const moved = first.next_page!.documents.map((d) => ({ ...d, offset: 180_000 }));
    expect(isFreeDocumentContinuation('get_solicitation_documents', {
      notice_id: NOTICE, document_ids: first.next_page!.document_ids, documents: moved, continuation: first.next_page!.continuation,
    }, USER)).toBe(false);
  });

  it('at the cap, next_page still exists but carries no continuation (the next window bills)', async () => {
    // Forge the state "this response served the last free page" by walking a valid chain to it
    // is slow; instead verify the boundary through the tool's own numbering at the cap.
    const { issueContinuation } = await import('@/lib/mcp/doc-continuation');
    const windows = [{ document_id: 'file-guide', offset: 20_000, limit: 20_000 }];
    const atCap = issueContinuation(USER, windows, MAX_FREE_CONTINUATIONS)!;
    const res = await solicitationDocuments({ notice_id: NOTICE, userEmail: USER, document_ids: ['file-guide'], documents: windows, continuation: atCap });
    expect(res._meta.continuation_page).toBe(MAX_FREE_CONTINUATIONS);
    expect(res.next_page).not.toBeNull();
    expect(res.next_page!.continuation).toBeUndefined();
    expect(res._meta.continuation_cap_reached).toBe(true);
  });

  it('no verified caller (stdio / local) → no token issued, paging unchanged', async () => {
    const res = await solicitationDocuments({ notice_id: NOTICE });
    expect(res.next_page).not.toBeNull();
    expect(res.next_page!.continuation).toBeUndefined();
  });

  it('the token and result carry no commerce wording', async () => {
    const first = await solicitationDocuments({ notice_id: NOTICE, userEmail: USER });
    // The token itself is random base64 — exclude it so a chance substring cannot flake this.
    const { continuation: _token, ...nextPage } = first.next_page!;
    const text = JSON.stringify({ next_page: nextPage, scope: first.scope_document, meta: first._meta });
    expect(text).not.toMatch(/credit|price|free|upgrade|checkout/i);
  });
});

describe('scope_document signal', () => {
  it('not_found when every file was read and classified and none is a SOW/PWS (the W5168W26RA015 case)', async () => {
    const res = await solicitationDocuments({ notice_id: NOTICE, userEmail: USER });
    expect(res.scope_document.status).toBe('not_found');
    expect(res.scope_document.note).toMatch(/earlier version/);
  });

  it('found when a file is classified sow_pws', async () => {
    mockWarm.mockResolvedValue({ data: [guideRow, pwsRow] });
    const res = await solicitationDocuments({ notice_id: NOTICE, userEmail: USER });
    expect(res.scope_document.status).toBe('found');
    expect(res.scope_document.files).toEqual(['PWS_Base_Operations.pdf']);
  });

  it('unknown when a file was never classified', async () => {
    mockWarm.mockResolvedValue({ data: [guideRow, { ...qaRow, doc_kind: null }] });
    const res = await solicitationDocuments({ notice_id: NOTICE, userEmail: USER });
    expect(res.scope_document.status).toBe('unknown');
  });

  it('unknown on a scoped continuation page (it does not see every file)', async () => {
    const first = await solicitationDocuments({ notice_id: NOTICE, userEmail: USER });
    const second = await solicitationDocuments({ notice_id: NOTICE, userEmail: USER, document_ids: first.next_page!.document_ids, documents: first.next_page!.documents, continuation: first.next_page!.continuation });
    expect(second.scope_document.status).toBe('unknown');
  });

  it('the hint names the scope document (it looked for "sow"/"pws" and never matched "sow_pws")', async () => {
    flags.aiHint = true;
    mockWarm.mockResolvedValue({ data: [guideRow, pwsRow] });
    const res = await solicitationDocuments({ notice_id: NOTICE, userEmail: USER });
    expect(res._ai_hint!.summary).toContain('Scope doc: PWS_Base_Operations.pdf');
    expect(res._ai_hint!.how_to_use).not.toMatch(/keep re-calling/i);
    expect(res._ai_hint!.how_to_use).toMatch(/Page only when the question needs/);
  });
});
