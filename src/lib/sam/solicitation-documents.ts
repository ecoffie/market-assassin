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
import { fetchAndExtractNoticeFiles, normalizeNoticeId, MAX_EXTRACTED_TEXT_CHARS } from '@/lib/sam/fetch-pursuit-docs';
import { classifyExtraction, readableRatio, type ExtractionQuality } from '@/lib/sam/extraction-quality';

const BUCKET = 'pursuit-documents';
const SIGNED_URL_TTL = 3600; // 1h — long enough for an external agent to fetch
const CACHE_TTL = 30 * 24 * 60 * 60; // 30 days
const INLINE_CAP = 20_000; // DEFAULT chars per doc when the caller doesn't page (back-compat)
const MAX_WINDOW_CHARS = 120_000; // hard ceiling for ONE response window (MCP payload safety)
/** Single source of truth — imported, never re-typed (see the extractor's note). */
const EXTRACTION_CEILING_CHARS = MAX_EXTRACTED_TEXT_CHARS;
const CACHE_TEXT_CAP = MAX_EXTRACTED_TEXT_CHARS; // store what was extracted — matches the
// extraction ceiling (MAX_EXTRACTED_TEXT_CHARS in fetch-pursuit-docs). It was 40_000, which
// silently DESTROYED text beyond 40k on the cold path: the window could never reach what the
// cache never stored. The warm path (pursuit_documents) always had the full extraction.

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * Why the text for a document is (or isn't) here. Collapsing these into an empty
 * string is what made "we have no text" indistinguishable from "this response
 * stopped early" — the caller could not tell absence from truncation.
 */
export type TextAvailability =
  | 'complete' // this window reaches the end of the stored text
  | 'partial' // more text exists AFTER this window — page with next_offset
  | 'extraction_failed' // we hold the file but could not turn it into text
  | 'file_unavailable' // no file and no text on record
  | 'extraction_capped' // extraction stopped at the pipeline ceiling; the TAIL OF
  // THE FILE WAS NEVER EXTRACTED. Paging cannot recover it — the raw file can.
  | 'container_stub' // a PDF Portfolio cover sheet: real content is nested inside
  // the container and was never reached. Non-empty text, but NOT the document.
  | 'unreadable_encoding'; // extracted, but the glyphs carry no usable text map
// (font-subset PDF) — the characters are not the document's words.

/** Byte/char window actually returned for one document. */
export interface TextWindow {
  offset: number; // char offset this window starts at
  returned_chars: number; // chars in THIS window
  total_chars: number | null; // TRUE stored length; null = unknown, never assume 0
  next_offset: number | null; // pass back as offset to continue; null = no more
  has_more: boolean;
  /** Fraction of the STORED text delivered so far (0..1). Chars, never pages. */
  coverage_of_stored_text: number | null;
}

export interface SolicitationDocument {
  filename: string;
  doc_kind: string | null; // sow | pricing | amendment | … (best-effort classify)
  mime_type: string | null;
  page_count: number | null;
  char_count: number | null; // TRUE length of the extracted text (not the inline cap)
  extracted_text: string; // the requested WINDOW of text (see text_window)
  extracted_text_truncated: boolean; // true when more text follows this window
  text_availability: TextAvailability;
  text_window: TextWindow;
  /**
   * Stable identity for paging + amendment tracking. A notice's documents are
   * addressed by this, NOT by array position (an amendment landing between two
   * calls would otherwise shift every index).
   */
  document_id: string;
  /** True when extraction hit the pipeline ceiling — the file's tail was never read. */
  extraction_capped: boolean;
  /** Mechanical extraction succeeded but produced unusable text (see quality). */
  extraction_quality: ExtractionQuality;
  /**
   * True when char_count (recorded at extraction) is LARGER than the text on
   * hand — the stored text is a truncated remnant, so this document is treated
   * as extraction_capped rather than reported complete.
   */
  text_shorter_than_recorded: boolean;
  /** 0..1 share of ordinary readable characters; low = encoding failure. */
  text_readable_ratio: number | null;
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
  /** Whole-notice coverage so a caller can assert completeness in ONE place. */
  coverage: {
    documents_total: number;
    /** Docs whose returned window reaches the end of their stored text. */
    documents_complete: number;
    /** Docs with text still unread AFTER this response (page them). */
    documents_with_more_text: number;
    /** Docs we could not turn into text at all. */
    documents_unavailable: number;
    /** Docs whose EXTRACTION was capped — tail unreadable via paging. */
    documents_extraction_capped: number;
    /** True only when every document's full stored text has been delivered. */
    complete: boolean;
    /**
     * Documents on the notice that this response did NOT include, because the
     * caller scoped it with document_ids. `complete` describes what was
     * RETURNED, so without this a one-document scoped read looked like a full
     * package read. Non-zero means: this is a subset, not the notice.
     */
    documents_not_requested: number;
    /** True when document_ids narrowed the response to part of the notice. */
    scoped: boolean;

  };
}

/** Per-document paging request, addressed by stable document_id. */
export interface DocTextRequest {
  /** document_id (sam file id). Omit to apply to EVERY document. */
  document_id?: string;
  offset?: number;
  limit?: number;
}

export interface SolicitationDocumentsInput {
  noticeId: string;
  /** Chars per document in this response. Defaults to INLINE_CAP for back-compat. */
  textLimit?: number;
  /** Start offset applied to every document unless overridden per-doc. */
  textOffset?: number;
  /** Per-document windows — wins over textOffset/textLimit for that doc. */
  documents?: DocTextRequest[];
  /** Only return these document_ids (page one big doc without re-sending the rest). */
  documentIds?: string[];
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
  /** Extractor reported a failure for this file (we hold it, text is absent). */
  extractionError?: string | null;
}

function cap(text: string | null | undefined, n: number): { text: string; truncated: boolean } {
  const s = text || '';
  return s.length > n ? { text: s.slice(0, n), truncated: true } : { text: s, truncated: false };
}

/**
 * Take the requested WINDOW out of a document's stored text.
 *
 * Coverage is reported in CHARS, never pages: we know the stored char length
 * exactly, but a char offset cannot be mapped to a page without a per-page
 * offset index the extractor does not produce. Reporting "page N of M" from a
 * char ratio would be a fabricated number — see the report that claimed
 * "roughly 8 pages out of 60" purely from a 20k/char ratio.
 */
function windowText(
  full: string,
  offset: number,
  limit: number,
  opts: {
    extractionCapped: boolean;
    hadFile: boolean;
    extractionFailed: boolean;
    quality: ExtractionQuality;
  },
): { text: string; window: TextWindow; availability: TextAvailability; truncated: boolean } {
  const total = full.length;
  const start = Math.max(0, Math.min(Math.floor(offset) || 0, total));
  const size = Math.max(1, Math.min(Math.floor(limit) || INLINE_CAP, MAX_WINDOW_CHARS));
  const text = full.slice(start, start + size);
  const end = start + text.length;
  const hasMore = end < total;

  let availability: TextAvailability;
  if (total === 0) {
    // No text at all: say WHY. An empty string alone can't distinguish
    // "the file isn't retrievable" from "we have it but couldn't parse it".
    availability = opts.extractionFailed ? 'extraction_failed' : 'file_unavailable';
  } else if (hasMore) {
    // "More text exists" outranks a quality verdict: a long unusable document is
    // still PARTIAL, and saying otherwise both hides next_offset from the reader
    // and double-counts it as unavailable AND with-more-text in the rollup.
    // The quality verdict is not lost — extraction_quality carries it verbatim.
    availability = 'partial';
  } else if (opts.quality !== 'ok') {
    // Non-empty but not the document's words. Reporting this 'complete' is what
    // lets a downstream extractor invent requirements to fill the gap.
    availability = opts.quality === 'container_stub' ? 'container_stub' : 'unreadable_encoding';
  } else if (opts.extractionCapped) {
    // We delivered everything STORED, but extraction itself stopped early, so
    // the end of the FILE is still unread. Never call that 'complete'.
    availability = 'extraction_capped';
  } else {
    availability = 'complete';
  }

  return {
    text,
    truncated: hasMore,
    availability,
    window: {
      offset: start,
      returned_chars: text.length,
      total_chars: total > 0 ? total : opts.hadFile ? 0 : null,
      next_offset: hasMore ? end : null,
      has_more: hasMore,
      coverage_of_stored_text: total > 0 ? Number((end / total).toFixed(4)) : null,
    },
  };
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
  req: SolicitationDocumentsInput,
): Promise<SolicitationDocument[]> {
  const perDoc = new Map<string, DocTextRequest>();
  let wildcard: DocTextRequest | null = null;
  for (const d of req.documents || []) {
    if (d.document_id) perDoc.set(d.document_id, d);
    else wildcard = d;
  }

  const only = req.documentIds && req.documentIds.length > 0 ? new Set(req.documentIds) : null;
  const selected = only ? metas.filter((m) => only.has(m.fileId)) : metas;

  return Promise.all(
    selected.map(async (m) => {
      const { url, source } = await signUrl(supabase, m.storagePath, m.samUrl, m.filename);
      const spec = perDoc.get(m.fileId) || wildcard || {};
      const offset = spec.offset ?? req.textOffset ?? 0;
      const limit = spec.limit ?? req.textLimit ?? INLINE_CAP;
      const full = m.extractedText || '';
      const quality = classifyExtraction(full);
      // The DB's char_count and the text we actually hold can disagree (a row
      // written by an older/partial extraction). Resolving that silently toward
      // the shorter string would let a 1k excerpt of a 500k document report
      // 'complete'. Treat a larger recorded length as evidence that the stored
      // text is itself incomplete.
      const recorded = typeof m.charCount === 'number' ? m.charCount : null;
      const storedShortOfRecord = recorded !== null && full.length > 0 && recorded > full.length;
      // The extractor stops at a fixed ceiling; a stored length sitting exactly
      // ON it means the tail of the file was never read. Paging can't recover
      // that — only the raw file can — so it must not be reported 'complete'.
      const extractionCapped = full.length >= EXTRACTION_CEILING_CHARS || storedShortOfRecord;
      const w = windowText(full, offset, limit, {
        extractionCapped,
        hadFile: Boolean(m.storagePath || m.samUrl),
        extractionFailed: Boolean(m.extractionError),
        quality,
      });
      return {
        filename: m.filename,
        doc_kind: m.docKind,
        mime_type: m.mime,
        page_count: m.pageCount,
        char_count: m.charCount ?? (full.length || null),
        extracted_text: w.text,
        extracted_text_truncated: w.truncated,
        text_availability: w.availability,
        text_window: w.window,
        document_id: m.fileId,
        extraction_capped: extractionCapped,
        extraction_quality: quality,
        /** Recorded length exceeds the text we hold — stored text is incomplete. */
        text_shorter_than_recorded: storedShortOfRecord,
        text_readable_ratio: full.length > 0 ? Number(readableRatio(full).toFixed(2)) : null,
        download_url: url,
        download_source: source,
      };
    }),
  );
}

/** Roll per-document availability up to one notice-level answer. */
/**
 * Roll per-document availability up to ONE notice-level answer.
 *
 * ⚠️ `complete` describes THIS RESPONSE, not the caller's accumulated reading.
 * The call is stateless: it cannot know what earlier calls returned. Two wrong
 * answers were tried before this. Judging only the returned subset let a
 * one-document scoped read report complete=true while the rest of the notice
 * was unread (false positive). Then requiring every notice document in the
 * response made `complete` UNREACHABLE on any multi-document notice, because
 * next_page deliberately scopes each continuation to the documents that still
 * have text — a fully-read 7-document VA package finished 8 calls still
 * reporting complete=false (false negative). Inferring what was "already read"
 * from the current window cannot work either: a long document finished on an
 * earlier call carries no offset in the continuation.
 *
 * So `complete` is scoped-honest — true only when this response delivered every
 * document it covered AND covered the whole notice — and **`next_page === null`
 * is the termination signal** for a paging loop. Both are documented that way
 * on the tool, and `scoped` tells the caller which kind of answer this is.
 */
function summarize(
  documents: SolicitationDocument[],
  totalOnNotice: number,
): SolicitationDocumentsResult['coverage'] {
  const withMore = documents.filter((d) => d.text_window.has_more).length;
  const unavailable = documents.filter(
    (d) =>
      d.text_availability === 'file_unavailable' ||
      d.text_availability === 'extraction_failed' ||
      // Non-empty but unusable text is NOT readable content — counting it as
      // delivered is what made a portfolio stub look like a complete document.
      d.text_availability === 'container_stub' ||
      d.text_availability === 'unreadable_encoding',
  ).length;
  const capped = documents.filter((d) => d.text_availability === 'extraction_capped').length;
  const complete = documents.filter((d) => d.text_availability === 'complete').length;
  return {
    documents_total: documents.length,
    documents_complete: complete,
    documents_with_more_text: withMore,
    documents_unavailable: unavailable,
    documents_extraction_capped: capped,
    documents_not_requested: Math.max(0, totalOnNotice - documents.length),
    scoped: totalOnNotice > documents.length,
    // Scoped-honest (see the note above): every document in this response was
    // fully delivered AND this response covered the whole notice.
    complete:
      documents.length > 0 && complete === documents.length && totalOnNotice === documents.length,
  };
}

export async function getSolicitationDocuments(
  input: SolicitationDocumentsInput,
): Promise<SolicitationDocumentsResult> {
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
    coverage: {
      documents_total: 0,
      documents_complete: 0,
      documents_with_more_text: 0,
      documents_unavailable: 0,
      documents_extraction_capped: 0,
      documents_not_requested: 0,
      scoped: false,
      complete: false,
    },
  };

  if (!noticeId) return base;

  // ── Base fields from the opportunity cache (title + inline body/SOW text) ──
  const OPP_COLS = 'notice_id, title, solicitation_number, department, agency_hierarchy, description, sow_text';
  let { data: opp } = await supabase
    .from('sam_opportunities')
    .select(OPP_COLS)
    .eq('notice_id', noticeId)
    .maybeSingle();

  // FM-U05 (Eric/QA 2026-07-29): a caller may pass a SOLICITATION NUMBER (e.g. "W912PL-24-R-0005")
  // instead of the notice UUID — a notice_id is 32 hex chars, a sol# has dashes/letters. When the
  // notice_id lookup misses AND the input isn't UUID-shaped, resolve by solicitation_number so the tool
  // is consistent with get_solicitation_incumbent (which accepts either) instead of a silent all-null.
  const looksLikeUuid = /^[0-9a-f]{32}$/i.test(noticeId.replace(/-/g, ''));
  if (!opp && !looksLikeUuid) {
    const { data: bySol } = await supabase
      .from('sam_opportunities')
      .select(OPP_COLS)
      .eq('solicitation_number', noticeId)
      .order('posted_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (bySol) {
      opp = bySol;
      base.notice_id = bySol.notice_id; // continue the doc fetch with the RESOLVED notice_id
    }
  }
  // From here on, use the RESOLVED notice_id (a sol#-input now points at the real UUID).
  const resolvedNoticeId = base.notice_id;

  if (opp) {
    base.title = opp.title ?? null;
    base.solicitation_number = opp.solicitation_number ?? null;
    base.agency = opp.department ?? opp.agency_hierarchy ?? null;
    // description may still be a noticedesc URL on the ~5% not yet backfilled;
    // only surface it as text if it isn't a bare link.
    const desc = typeof opp.description === 'string' && !/^https?:\/\//i.test(opp.description.trim()) ? opp.description : '';
    // The notice BODY and SOW page on the same offset/limit as the documents,
    // so a long notice body is reachable too (it was capped identically before).
    const bodyOffset = input.textOffset ?? 0;
    const bodyLimit = Math.min(input.textLimit ?? INLINE_CAP, MAX_WINDOW_CHARS);
    const dCap = cap((desc || '').slice(bodyOffset), bodyLimit);
    base.description = dCap.text;
    base.description_truncated = dCap.truncated;
    const sCap = cap(String(opp.sow_text || '').slice(bodyOffset), bodyLimit);
    base.sow_text = sCap.text;
    base.sow_text_truncated = sCap.truncated;
  }

  // ── Layer 1: WARM — notice-level dedup already in pursuit_documents ────────
  const { data: warmRows, error: warmErr } = await supabase
    .from('pursuit_documents')
    .select(
      'sam_file_id, sam_url, filename, mime_type, page_count, char_count, extracted_text, storage_path, doc_kind, extraction_error',
    )
    .eq('notice_id', resolvedNoticeId)
    .eq('doc_source', 'sam_public')
    // NOTE: rows with NULL extracted_text are deliberately INCLUDED now. Filtering
    // them out made a file we hold but could not parse look like a file that does
    // not exist — the exact absence-vs-failure confusion this work removes. They
    // come back as text_availability='extraction_failed' with a download_url.
    .order('char_count', { ascending: false, nullsFirst: false });

  // A failed query returns data=null, which is INDISTINGUISHABLE from "this
  // notice has no documents" unless the error is surfaced. Mark the result
  // degraded so a caller never reads a query failure as an empty notice.
  if (warmErr) {
    console.error('[solicitation-docs] warm pursuit_documents query failed:', warmErr.message);
    base.degraded = true;
  }

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
        extractionError: r.extraction_error ?? null,
      });
    }
    base.documents = await toOutputDocs(supabase, metas, input);
    base.coverage = summarize(base.documents, metas.length);
    base.source = 'cache';
    return base;
  }

  // ── Layer 2: COLD CACHE — a prior MCP on-demand fetch ─────────────────────
  const cached = await getCached<CachedDocMeta[]>('solicitation_docs', { noticeId: resolvedNoticeId });
  if (cached && cached.length > 0) {
    base.documents = await toOutputDocs(supabase, cached, input);
    base.coverage = summarize(base.documents, cached.length);
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
      else {
        // Log, but do NOT mark the response degraded: the caller still gets the
        // extracted text AND a working public SAM download_url, so retrieval is
        // not impaired. A durable Mindy-hosted copy is an optimization, and
        // conflating "no cached copy" with "degraded data" would cry wolf on
        // every cold call. (The bucket does not currently exist — 28,092/28,092
        // rows have storage_path NULL — which is why download_source reads
        // 'sam_public' rather than 'mindy_signed'.)
        console.warn('[solicitation-docs] storage upload skipped:', error.message);
      }
    } catch (err) {
      console.warn('[solicitation-docs] storage upload skipped:', err);
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
      extractionError: f.extractionError ?? null,
    });
  }

  // Cache the metadata (NOT signed URLs — those are minted fresh each call).
  await setCached('solicitation_docs', { noticeId: resolvedNoticeId }, metas, CACHE_TTL);

  base.documents = await toOutputDocs(supabase, metas, input);
  base.coverage = summarize(base.documents, metas.length);
  base.source = 'on_demand';
  return base;
}
