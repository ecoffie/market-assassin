/**
 * getSolicitationDocuments(noticeId) — the data core of the MCP
 * `get_solicitation_documents` tool. Hands an external caller the FULL
 * solicitation text + downloadable raw files for a SAM notice, so their own
 * agent can pipe it anywhere (Canva, an LLM, a proposal drafter).
 *
 * Three-layer retrieval (cheapest first — zero SAM calls unless truly cold):
 *   1. WARM — reuse the notice-level dedup already in `pursuit_documents`
 *      (any user who tracked this notice already downloaded + extracted its
 *      files; extracted_text + storage_path are cached, keyed by notice_id).
 *   2. COLD CACHE — a prior MCP on-demand fetch stored the doc metadata +
 *      storage paths in `mcp_external_cache` (no new table needed).
 *   3. COLD FETCH — nobody has this notice yet: fetch + extract on demand via
 *      fetchAndExtractNoticeFiles (public SAM attachments), upload the raw
 *      blobs to Storage, cache the metadata, and return.
 *
 * DELIVERY: extracted text is returned INLINE (capped); the raw file is a
 * short-lived SIGNED URL to our Storage copy (SAM API key never leaves the
 * server). SAM attachments are PUBLIC federal data — no entitlement gate.
 */
import { createClient } from '@supabase/supabase-js';
import { getCached, setCached } from '@/lib/mcp/external-cache';
import { fetchAndExtractNoticeFiles, normalizeNoticeId } from '@/lib/sam/fetch-pursuit-docs';

const BUCKET = 'pursuit-documents';
const SIGNED_URL_TTL = 3600; // 1h — long enough for an external agent to fetch
const CACHE_TTL = 30 * 24 * 60 * 60; // 30 days
const INLINE_CAP = 20_000; // chars returned inline per text field (raw file has the full text)
const CACHE_TEXT_CAP = 40_000; // chars stored per doc in the cold cache

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export interface SolicitationDocument {
  filename: string;
  doc_kind: string | null; // sow | pricing | amendment | … (best-effort classify)
  mime_type: string | null;
  page_count: number | null;
  char_count: number | null; // TRUE length of the extracted text (not the inline cap)
  extracted_text: string; // inline, capped at INLINE_CAP
  extracted_text_truncated: boolean;
  download_url: string | null; // signed Storage URL (~1h) or public SAM fallback
  download_source: 'mindy_signed' | 'sam_public' | null;
}

export interface SolicitationDocumentsResult {
  notice_id: string;
  title: string | null;
  solicitation_number: string | null;
  agency: string | null;
  description: string; // inline, capped
  description_truncated: boolean;
  sow_text: string; // inline, capped
  sow_text_truncated: boolean;
  documents: SolicitationDocument[];
  source: 'cache' | 'on_demand' | 'none'; // where the documents came from
  degraded: boolean;
}

interface CachedDocMeta {
  fileId: string;
  filename: string;
  mime: string | null;
  pageCount: number | null;
  charCount: number | null;
  docKind: string | null;
  storagePath: string | null;
  samUrl: string | null;
  extractedText: string; // capped at CACHE_TEXT_CAP
}

function cap(text: string | null | undefined, n: number): { text: string; truncated: boolean } {
  const s = text || '';
  return s.length > n ? { text: s.slice(0, n), truncated: true } : { text: s, truncated: false };
}

async function signUrl(
  supabase: ReturnType<typeof sb>,
  storagePath: string | null,
  samUrl: string | null,
  filename: string,
): Promise<{ url: string | null; source: 'mindy_signed' | 'sam_public' | null }> {
  if (storagePath) {
    try {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL, {
        download: filename || true,
      });
      if (data?.signedUrl) return { url: data.signedUrl, source: 'mindy_signed' };
    } catch {
      /* fall through to public SAM link */
    }
  }
  if (samUrl) return { url: samUrl, source: 'sam_public' };
  return { url: null, source: null };
}

async function toOutputDocs(
  supabase: ReturnType<typeof sb>,
  metas: CachedDocMeta[],
): Promise<SolicitationDocument[]> {
  return Promise.all(
    metas.map(async (m) => {
      const { url, source } = await signUrl(supabase, m.storagePath, m.samUrl, m.filename);
      const inline = cap(m.extractedText, INLINE_CAP);
      return {
        filename: m.filename,
        doc_kind: m.docKind,
        mime_type: m.mime,
        page_count: m.pageCount,
        char_count: m.charCount,
        extracted_text: inline.text,
        extracted_text_truncated: inline.truncated,
        download_url: url,
        download_source: source,
      };
    }),
  );
}

export async function getSolicitationDocuments(input: { noticeId: string }): Promise<SolicitationDocumentsResult> {
  const noticeId = normalizeNoticeId((input.noticeId || '').trim());
  const supabase = sb();

  const base: SolicitationDocumentsResult = {
    notice_id: noticeId,
    title: null,
    solicitation_number: null,
    agency: null,
    description: '',
    description_truncated: false,
    sow_text: '',
    sow_text_truncated: false,
    documents: [],
    source: 'none',
    degraded: false,
  };

  if (!noticeId) return base;

  // ── Base fields from the opportunity cache (title + inline body/SOW text) ──
  const { data: opp } = await supabase
    .from('sam_opportunities')
    .select('title, solicitation_number, department, agency_hierarchy, description, sow_text')
    .eq('notice_id', noticeId)
    .maybeSingle();

  if (opp) {
    base.title = opp.title ?? null;
    base.solicitation_number = opp.solicitation_number ?? null;
    base.agency = opp.department ?? opp.agency_hierarchy ?? null;
    // description may still be a noticedesc URL on the ~5% not yet backfilled;
    // only surface it as text if it isn't a bare link.
    const desc = typeof opp.description === 'string' && !/^https?:\/\//i.test(opp.description.trim()) ? opp.description : '';
    const dCap = cap(desc, INLINE_CAP);
    base.description = dCap.text;
    base.description_truncated = dCap.truncated;
    const sCap = cap(opp.sow_text, INLINE_CAP);
    base.sow_text = sCap.text;
    base.sow_text_truncated = sCap.truncated;
  }

  // ── Layer 1: WARM — notice-level dedup already in pursuit_documents ────────
  const { data: warmRows } = await supabase
    .from('pursuit_documents')
    .select('sam_file_id, sam_url, filename, mime_type, page_count, char_count, extracted_text, storage_path, doc_kind')
    .eq('notice_id', noticeId)
    .eq('doc_source', 'sam_public')
    .not('extracted_text', 'is', null)
    .order('char_count', { ascending: false });

  if (warmRows && warmRows.length > 0) {
    const seen = new Set<string>();
    const metas: CachedDocMeta[] = [];
    for (const r of warmRows) {
      if (seen.has(r.sam_file_id)) continue; // dedup across pursuits by file
      seen.add(r.sam_file_id);
      metas.push({
        fileId: r.sam_file_id,
        filename: r.filename,
        mime: r.mime_type ?? null,
        pageCount: r.page_count ?? null,
        charCount: r.char_count ?? (r.extracted_text ? String(r.extracted_text).length : null),
        docKind: r.doc_kind ?? null,
        storagePath: r.storage_path ?? null,
        samUrl: r.sam_url ?? null,
        extractedText: String(r.extracted_text || ''),
      });
    }
    base.documents = await toOutputDocs(supabase, metas);
    base.source = 'cache';
    return base;
  }

  // ── Layer 2: COLD CACHE — a prior MCP on-demand fetch ─────────────────────
  const cached = await getCached<CachedDocMeta[]>('solicitation_docs', { noticeId });
  if (cached && cached.length > 0) {
    base.documents = await toOutputDocs(supabase, cached);
    base.source = 'cache';
    return base;
  }

  // ── Layer 3: COLD FETCH — on-demand download + extract (public SAM) ────────
  const fetched = await fetchAndExtractNoticeFiles({
    noticeId,
    solicitationNumber: base.solicitation_number,
    title: base.title,
    agency: base.agency,
  });
  base.degraded = fetched.degraded;

  if (fetched.documents.length === 0) {
    // No attachments (many notices legitimately have none). Inline text (if any)
    // is still returned above; the caller sees an honest empty documents list.
    base.source = 'none';
    return base;
  }

  // Upload each raw blob to Storage under a notice-level path, build metadata.
  const metas: CachedDocMeta[] = [];
  for (const f of fetched.documents) {
    const safe = `${f.fileId}-${(f.filename || 'file').replace(/[^a-zA-Z0-9.-]/g, '_')}`.slice(0, 400);
    const storagePath = `_notices/${noticeId}/${safe}`;
    let finalPath: string | null = null;
    try {
      const { error } = await supabase.storage.from(BUCKET).upload(storagePath, f.buffer, {
        contentType: f.mime || 'application/octet-stream',
        upsert: true,
      });
      if (!error) finalPath = storagePath;
      else console.warn('[solicitation-docs] storage upload failed:', error.message);
    } catch (err) {
      console.warn('[solicitation-docs] storage upload threw:', err);
    }
    metas.push({
      fileId: f.fileId,
      filename: f.filename,
      mime: f.mime,
      pageCount: f.pageCount ?? null,
      charCount: f.extractedText.length,
      docKind: f.docKind ?? null,
      storagePath: finalPath,
      samUrl: f.samUrl, // best-effort fallback if the signed Storage copy is unavailable
      extractedText: f.extractedText.slice(0, CACHE_TEXT_CAP),
    });
  }

  // Cache the metadata (NOT signed URLs — those are minted fresh each call).
  await setCached('solicitation_docs', { noticeId }, metas, CACHE_TTL);

  base.documents = await toOutputDocs(supabase, metas);
  base.source = 'on_demand';
  return base;
}
