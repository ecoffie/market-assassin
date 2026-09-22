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
 *
 * Honesty (issue-log #11/#12): resolve noticedesc when the description column
 * is empty/URL; list unread attachments; surface PIEE external links with a
 * retrieval_limitation so "no SOW heading" is not read as "no scope exists".
 */
import { createClient } from '@supabase/supabase-js';
import { getCached, setCached } from '@/lib/mcp/external-cache';
import { fetchAndExtractNoticeFiles, normalizeNoticeId, MAX_EXTRACTED_TEXT_CHARS } from '@/lib/sam/fetch-pursuit-docs';
import { classifyExtraction, readableRatio, type ExtractionQuality } from '@/lib/sam/extraction-quality';
import { isNoticeUuid, resolveCanonicalSolicitation } from '@/lib/sam/resolve-solicitation';
import {
  assembleNoticeSourceText,
  attachmentLocationNote,
  detectPiee,
  extractPieeLinks,
  pieeRetrievalLimitation,
} from '@/lib/sam/notice-identity';
import { parseSamAttachment } from '@/lib/sam/attachment-metadata';
import {
  fetchNoticeDescriptionWithFailover,
  isDescriptionLink,
  noticedescRetrievalLimitation,
  type NoticedescFetchResult,
} from '@/lib/sam/notice-description';

const BUCKET = 'pursuit-documents';
const SIGNED_URL_TTL = 3600; // 1h — long enough for an external agent to fetch
const CACHE_TTL = 30 * 24 * 60 * 60; // 30 days
const INLINE_CAP = 20_000; // DEFAULT chars per doc when the caller doesn't page
// PER-DOCUMENT window ceiling. NOT a total response-size limit: it is applied
// inside the per-document map, so a notice with N attachments can return up to
// N x this in one response (measured: 14 DLA attachments = 481,351 chars at
// text_limit 120,000). Callers that need a bounded TOTAL should page with
// document_ids rather than relying on this constant.
const MAX_WINDOW_CHARS = 120_000;
// Store what was extracted. This was 40_000, which silently DISCARDED text above
// that on the cold path — so a textMode:'full' read was full on the cold call and
// 40k on every warm read for the 30-day TTL (disclosed via extracted_text_truncated,
// but a real fidelity limit). Now the extraction ceiling itself.
const CACHE_TEXT_CAP = MAX_EXTRACTED_TEXT_CHARS;

/**
 * Read-only mode for verification runs. `SAM_DOCS_READONLY=on` suppresses every
 * write this module can perform — description persistence and Storage upload —
 * so an acceptance script cannot mutate production while exercising the real
 * code path. Retrieval is unaffected; only persistence is skipped.
 *
 * It exists because a script LABELLED read-only acceptance performed a
 * production DELETE (2026-09-22). Scoping a write makes the hazard smaller;
 * removing the ability to write is what actually closes it.
 */
function isReadOnly(): boolean {
  return String(process.env.SAM_DOCS_READONLY || '').toLowerCase() === 'on';
}

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export type TextAvailability =
  | 'complete'
  | 'partial'
  | 'extraction_failed'
  | 'file_unavailable'
  | 'extraction_capped'
  | 'container_stub'
  | 'unreadable_encoding';

export interface TextWindow {
  offset: number;
  returned_chars: number;
  total_chars: number | null; // null = unknown, never assume 0
  next_offset: number | null;
  has_more: boolean;
  coverage_of_stored_text: number | null; // CHARS, never pages
}

export interface DocTextRequest {
  document_id?: string;
  offset?: number;
  limit?: number;
}

export interface SolicitationDocument {
  filename: string;
  doc_kind: string | null; // sow | pricing | amendment | … (best-effort classify)
  mime_type: string | null;
  page_count: number | null;
  char_count: number | null; // TRUE length of the extracted text (not the inline cap)
  extracted_text: string; // the requested WINDOW (or full text when textMode='full')
  extracted_text_truncated: boolean;
  text_availability: TextAvailability;
  text_window: TextWindow;
  /** Stable address for paging + amendment tracking (never array position). */
  document_id: string;
  extraction_capped: boolean;
  extraction_quality: ExtractionQuality;
  text_readable_ratio: number | null;
  /** Recorded length exceeds the text on hand — stored text is incomplete. */
  text_shorter_than_recorded: boolean;
  download_url: string | null; // signed Storage URL (~1h) or public SAM fallback
  download_source: 'mindy_signed' | 'sam_public' | null;
  /** Where the file actually lives — SAM.gov vs Mindy storage. Always set. */
  location_note: string;
}

export interface ListedAttachment {
  filename: string;
  url: string | null;
  has_extracted_text: boolean;
  location: 'sam_public' | 'piee_external' | 'unknown';
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
  /** Assembled SOW + body + attachment text. Full when textMode='full'. */
  source_text?: string;
  truncated_attachments?: number;
  /**
   * Completeness of THIS response. NOT a paging terminator — `next_page === null`
   * is. The call is stateless, so it cannot know what earlier calls returned;
   * `scoped` says whether this response covered only part of the notice.
   */
  coverage: {
    documents_total: number;
    documents_complete: number;
    documents_with_more_text: number;
    documents_unavailable: number;
    documents_extraction_capped: number;
    documents_not_requested: number;
    scoped: boolean;
    complete: boolean;
  };
  /** Every attachment named on the notice, including unread ones. */
  listed_attachments: ListedAttachment[];
  attachments_listed: number;
  attachments_with_text: number;
  piee: boolean;
  piee_links: string[];
  /** Null when no external-host limitation applies. */
  retrieval_limitation: string | null;
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
  /** Extractor reported a failure (we hold the file, text is absent). */
  extractionError?: string | null;
}

/**
 * Take the requested WINDOW out of a document's stored text.
 *
 * Coverage is reported in CHARS, never pages: no char->page index exists, so
 * "page N of M" derived from a char ratio would be a fabricated number.
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
    /** Internal full-text mode. NOT expressible by a caller-supplied limit. */
    unbounded?: boolean;
  },
): { text: string; window: TextWindow; availability: TextAvailability; truncated: boolean } {
  const total = full.length;
  const start = Math.max(0, Math.min(Math.floor(offset) || 0, total));
  // MAX_WINDOW_CHARS bounds ONE DOCUMENT's window, not the whole response.
  // textMode:'full' is the INTERNAL consumer path and must return the whole
  // stored string, so it is signalled by opts.unbounded — never by a numeric
  // limit. A MAX_SAFE_INTEGER sentinel was caller-reachable:
  // `documents:[{limit: 9007199254740991}]` escaped the clamp and could return
  // ~1MB for a single document. A flag cannot be expressed by any
  // caller-supplied number, so the per-document bound holds by construction.
  const requested = Math.floor(limit) || INLINE_CAP;
  const size = opts.unbounded
    ? Math.max(1, total)
    : Math.max(1, Math.min(requested, MAX_WINDOW_CHARS));
  const text = full.slice(start, start + size);
  const end = start + text.length;
  const hasMore = end < total;

  let availability: TextAvailability;
  if (total === 0) {
    availability = opts.extractionFailed ? 'extraction_failed' : 'file_unavailable';
  } else if (hasMore) {
    // "More text exists" outranks a quality verdict, so next_offset stays visible
    // and one document isn't counted as both unavailable and with-more-text.
    availability = 'partial';
  } else if (opts.quality !== 'ok') {
    availability = opts.quality === 'container_stub' ? 'container_stub' : 'unreadable_encoding';
  } else if (opts.extractionCapped) {
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

/** Roll per-document availability up to ONE notice-level answer. */
function summarize(
  documents: SolicitationDocument[],
  totalOnNotice: number,
): SolicitationDocumentsResult['coverage'] {
  const withMore = documents.filter((d) => d.text_window.has_more).length;
  const unavailable = documents.filter(
    (d) =>
      d.text_availability === 'file_unavailable' ||
      d.text_availability === 'extraction_failed' ||
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
    complete:
      documents.length > 0 && complete === documents.length && totalOnNotice === documents.length,
  };
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
  inlineCap: number,
  req: SolicitationDocumentsInput = {} as SolicitationDocumentsInput,
): Promise<SolicitationDocument[]> {
  // Per-document paging requests, addressed by stable document_id.
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
      const full = m.extractedText || '';
      // main's disclosure, preserved verbatim: recorded length > text on hand
      // means the stored copy is a truncated remnant.
      const cacheTruncated = (m.charCount ?? full.length) > full.length;

      const quality = classifyExtraction(full);
      const extractionCapped = full.length >= MAX_EXTRACTED_TEXT_CHARS || cacheTruncated;

      // textMode:'full' (main's behaviour for internal consumers) = one unbounded
      // window, signalled by a FLAG the caller cannot forge. Otherwise the
      // caller's window, defaulting to inlineCap and always clamped.
      const unbounded = inlineCap === Number.MAX_SAFE_INTEGER;
      const spec = perDoc.get(m.fileId) || wildcard || {};
      const offset = spec.offset ?? req.textOffset ?? 0;
      const limit = Math.min(spec.limit ?? req.textLimit ?? inlineCap, MAX_WINDOW_CHARS);

      const w = windowText(full, offset, limit, {
        extractionCapped,
        hadFile: Boolean(m.storagePath || m.samUrl),
        extractionFailed: Boolean(m.extractionError),
        unbounded,
        quality,
      });

      return {
        filename: m.filename,
        doc_kind: m.docKind,
        mime_type: m.mime,
        page_count: m.pageCount,
        char_count: m.charCount,
        extracted_text: w.text,
        extracted_text_truncated: w.truncated || cacheTruncated,
        text_availability: w.availability,
        text_window: w.window,
        document_id: m.fileId,
        extraction_capped: extractionCapped,
        extraction_quality: quality,
        text_readable_ratio: full.length > 0 ? Number(readableRatio(full).toFixed(2)) : null,
        text_shorter_than_recorded: cacheTruncated,
        download_url: url,
        download_source: source,
        location_note: attachmentLocationNote(source) ?? 'No downloadable copy was located for this file.',
      };
    }),
  );
}

function listedFromAttachmentsColumn(attachments: unknown): ListedAttachment[] {
  if (!Array.isArray(attachments)) return [];
  const out: ListedAttachment[] = [];
  for (const entry of attachments) {
    const parsed = parseSamAttachment(entry);
    if (!parsed) continue;
    out.push({
      filename: parsed.name || 'SAM attachment',
      url: parsed.url,
      has_extracted_text: false,
      location: 'sam_public',
    });
  }
  return out;
}

function mergeListed(...groups: ListedAttachment[][]): ListedAttachment[] {
  const byKey = new Map<string, ListedAttachment>();
  for (const group of groups) {
    for (const item of group) {
      const key = (item.url || item.filename).toLowerCase();
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, item);
        continue;
      }
      byKey.set(key, {
        ...prev,
        ...item,
        has_extracted_text: prev.has_extracted_text || item.has_extracted_text,
      });
    }
  }
  return [...byKey.values()];
}

function applyHonestyMeta(
  base: SolicitationDocumentsResult,
  listedGroups: ListedAttachment[],
  textMode?: 'inline' | 'full',
  noticedescLimitation: string | null = null,
  totalOnNotice?: number,
): SolicitationDocumentsResult {
  // Single exit point for every retrieval layer — compute coverage here so no
  // return path can forget it.
  base.coverage = summarize(base.documents, totalOnNotice ?? base.documents.length);
  const pieeCorpus = `${base.description}\n${base.sow_text}`;
  const pieeLinks = extractPieeLinks(pieeCorpus);
  const pieeListed: ListedAttachment[] = pieeLinks.map((url) => ({
    filename: 'PIEE Combined Synopsis / Solicitation (external)',
    url,
    has_extracted_text: false,
    location: 'piee_external',
  }));

  const listed = mergeListed(listedGroups, pieeListed);
  for (const d of base.documents) {
    if (!(d.extracted_text || '').trim()) continue;
    const hit = listed.find(
      (l) =>
        (l.url && d.download_url && l.url === d.download_url) ||
        l.filename.toLowerCase() === d.filename.toLowerCase(),
    );
    if (hit) hit.has_extracted_text = true;
    else {
      listed.push({
        filename: d.filename,
        url: d.download_url,
        has_extracted_text: true,
        location:
          d.download_source === 'mindy_signed' || d.download_source === 'sam_public'
            ? 'sam_public'
            : 'unknown',
      });
    }
  }

  base.listed_attachments = listed;
  base.attachments_listed = listed.length;
  base.attachments_with_text = listed.filter((l) => l.has_extracted_text).length;
  base.piee = detectPiee(pieeCorpus) || pieeLinks.length > 0;
  base.piee_links = pieeLinks;
  // PIEE unread is the stronger scope-host disclosure when both apply; otherwise
  // surface the noticedesc quota/miss so empty body ≠ "no scope".
  base.retrieval_limitation =
    pieeRetrievalLimitation(pieeLinks) ?? noticedescLimitation;

  const assembled = assembleNoticeSourceText({
    sow_text: base.sow_text,
    description: base.description,
    documents: base.documents,
  });
  base.truncated_attachments = assembled.truncated_attachments;
  if (textMode === 'full') base.source_text = assembled.text;
  return base;
}

export interface SolicitationDocumentsInput {
  noticeId: string;
  /** inline (default) caps extracted_text for MCP payloads. full is required for compliance-matrix. */
  textMode?: 'inline' | 'full';
  /** Chars per document in this response (default INLINE_CAP, max MAX_WINDOW_CHARS). */
  textLimit?: number;
  textOffset?: number;
  /** Per-document windows — pass next_page.documents verbatim to continue. */
  documents?: DocTextRequest[];
  /** Restrict the response to these document_ids. */
  documentIds?: string[];
}

export async function getSolicitationDocuments(
  input: SolicitationDocumentsInput,
): Promise<SolicitationDocumentsResult> {
  const noticeId = normalizeNoticeId((input.noticeId || '').trim());
  const supabase = sb();
  const inlineCap = input.textMode === 'full' ? Number.MAX_SAFE_INTEGER : INLINE_CAP;

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
    listed_attachments: [],
    attachments_listed: 0,
    attachments_with_text: 0,
    piee: false,
    piee_links: [],
    retrieval_limitation: null,
  };

  if (!noticeId) return base;

  // ── Base fields from the opportunity cache (title + inline body/SOW text) ──
  const OPP_COLS =
    'notice_id, title, solicitation_number, department, agency_hierarchy, description, sow_text, attachments, raw_data';
  let { data: opp, error: oppError } = await supabase
    .from('sam_opportunities')
    .select(OPP_COLS)
    .eq('notice_id', noticeId)
    .maybeSingle();
  if (oppError) {
    console.error('[getSolicitationDocuments] notice_id', oppError.message);
    base.degraded = true;
  }

  // Known-ID: solicitation number or description-held identifier → latest stored version.
  // Record UUID stays exact (do not upgrade an older amendment pin).
  if (!opp && !isNoticeUuid(noticeId)) {
    const canonical = await resolveCanonicalSolicitation(input.noticeId, { client: supabase });
    if (canonical) {
      const { data: latest, error: latestError } = await supabase
        .from('sam_opportunities')
        .select(OPP_COLS)
        .eq('notice_id', canonical.notice.notice_id)
        .maybeSingle();
      if (latestError) {
        console.error('[getSolicitationDocuments] canonical', latestError.message);
        base.degraded = true;
      }
      if (latest) {
        opp = latest;
        base.notice_id = latest.notice_id;
      }
    }
  }
  // From here on, use the RESOLVED notice_id (a sol#-input now points at the real UUID).
  const resolvedNoticeId = base.notice_id;

  const listedFromCache = listedFromAttachmentsColumn(opp?.attachments);
  let descriptionText = '';
  let noticedescLimitation: string | null = null;
  if (opp) {
    base.title = opp.title ?? null;
    base.solicitation_number = opp.solicitation_number ?? null;
    base.agency = opp.department ?? opp.agency_hierarchy ?? null;
    // description may still be a noticedesc URL on the ~5% not yet backfilled;
    // only surface it as text if it isn't a bare link. Otherwise resolve on demand
    // so sol# and UUID both return the same body (issue-log #12).
    const storedDesc = typeof opp.description === 'string' ? opp.description : '';
    const rawDesc =
      opp.raw_data && typeof opp.raw_data === 'object'
        ? String((opp.raw_data as { description?: unknown }).description || '')
        : '';
    if (storedDesc && !isDescriptionLink(storedDesc) && !/^https?:\/\//i.test(storedDesc.trim())) {
      descriptionText = storedDesc;
    } else {
      const linkOrId = isDescriptionLink(storedDesc)
        ? storedDesc
        : isDescriptionLink(rawDesc)
          ? rawDesc
          : resolvedNoticeId;
      // Bounded multi-key failover (entity pattern) — single rotated key used to
      // leave the body empty on a 429 day even when another key still had quota.
      const fetched: NoticedescFetchResult = await fetchNoticeDescriptionWithFailover(linkOrId);
      descriptionText = fetched.text;
      if (!fetched.text.trim()) {
        base.degraded = true;
        noticedescLimitation = noticedescRetrievalLimitation(fetched);
      } else {
        // Persist so sol# and UUID both hit cache next time (no re-burn of quota).
        const now = new Date().toISOString();
        const { error: persistErr } = isReadOnly()
          ? { error: null }
          : await supabase
              .from('sam_opportunities')
              .update({ description: fetched.text, description_checked_at: now })
              .eq('notice_id', resolvedNoticeId);
        if (persistErr) {
          console.error('[getSolicitationDocuments] persist description', persistErr.message);
          // Non-fatal — caller still gets the body this request.
        }
      }
    }
    const dCap = cap(descriptionText, inlineCap);
    base.description = dCap.text;
    base.description_truncated = dCap.truncated;
    const sCap = cap(opp.sow_text, inlineCap);
    base.sow_text = sCap.text;
    base.sow_text_truncated = sCap.truncated;
  }

  // ── Layer 1: WARM — notice-level dedup already in pursuit_documents ────────
  // Include rows WITHOUT extracted_text so listed-but-unread files are visible.
  const { data: warmRows, error: warmError } = await supabase
    .from('pursuit_documents')
    .select(
      'sam_file_id, sam_url, filename, mime_type, page_count, char_count, extracted_text, storage_path, doc_kind, extraction_error',
    )
    .eq('notice_id', resolvedNoticeId)
    .eq('doc_source', 'sam_public')
    .order('char_count', { ascending: false });
  if (warmError) {
    console.error('[getSolicitationDocuments] warm cache', warmError.message);
    base.degraded = true;
  }

  const warmListed: ListedAttachment[] = [];
  if (warmRows && warmRows.length > 0) {
    const seen = new Set<string>();
    const metas: CachedDocMeta[] = [];
    for (const r of warmRows) {
      const hasText = !!(r.extracted_text && String(r.extracted_text).trim());
      warmListed.push({
        filename: r.filename || 'SAM attachment',
        url: r.sam_url ?? null,
        has_extracted_text: hasText,
        location: 'sam_public',
      });
      if (!hasText) continue;
      if (seen.has(r.sam_file_id)) continue;
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
    if (metas.length > 0) {
      base.documents = await toOutputDocs(supabase, metas, inlineCap, input);
      base.source = 'cache';
      return applyHonestyMeta(base, mergeListed(listedFromCache, warmListed), input.textMode, noticedescLimitation, metas.length);
    }
  }

  // ── Layer 2: COLD CACHE — a prior MCP on-demand fetch ─────────────────────
  const cached = await getCached<CachedDocMeta[]>('solicitation_docs', { noticeId: resolvedNoticeId });
  if (cached && cached.length > 0) {
    const cachedListed = cached.map((m) => ({
      filename: m.filename,
      url: m.samUrl,
      has_extracted_text: !!(m.extractedText && m.extractedText.trim()),
      location: 'sam_public' as const,
    }));
    base.documents = await toOutputDocs(supabase, cached, inlineCap, input);
    base.source = 'cache';
    return applyHonestyMeta(base, mergeListed(listedFromCache, warmListed, cachedListed), input.textMode, noticedescLimitation, cached.length);
  }

  // ── Layer 3: COLD FETCH — on-demand download + extract (public SAM) ────────
  const fetched = await fetchAndExtractNoticeFiles({
    noticeId: resolvedNoticeId,
    solicitationNumber: base.solicitation_number,
    title: base.title,
    agency: base.agency,
  });
  base.degraded = base.degraded || fetched.degraded;

  if (fetched.documents.length === 0) {
    // No SAM resourceLinks (many notices legitimately have none — PIEE-hosted packages).
    // Inline description (resolved above) still returns; listed_attachments may name PIEE.
    base.source = base.description || base.sow_text ? 'on_demand' : 'none';
    return applyHonestyMeta(base, mergeListed(listedFromCache, warmListed), input.textMode, noticedescLimitation);
  }

  // Upload each raw blob to Storage under a notice-level path, build metadata.
  const metas: CachedDocMeta[] = [];
  const fetchedListed: ListedAttachment[] = [];
  for (const f of fetched.documents) {
    const safe = `${f.fileId}-${(f.filename || 'file').replace(/[^a-zA-Z0-9.-]/g, '_')}`.slice(0, 400);
    const storagePath = `_notices/${resolvedNoticeId}/${safe}`;
    let finalPath: string | null = null;
    try {
      const { error } = isReadOnly()
        ? { error: { message: 'read-only mode: storage upload skipped' } }
        : await supabase.storage.from(BUCKET).upload(storagePath, f.buffer, {
            contentType: f.mime || 'application/octet-stream',
            upsert: true,
          });
      if (!error) finalPath = storagePath;
      else console.warn('[solicitation-docs] storage upload failed:', error.message);
    } catch (err) {
      console.warn('[solicitation-docs] storage upload threw:', err);
    }
    const hasText = !!(f.extractedText && f.extractedText.trim());
    fetchedListed.push({
      filename: f.filename,
      url: f.samUrl,
      has_extracted_text: hasText,
      location: 'sam_public',
    });
    metas.push({
      fileId: f.fileId,
      filename: f.filename,
      mime: f.mime,
      pageCount: f.pageCount ?? null,
      charCount: f.extractedText.length,
      docKind: f.docKind ?? null,
      storagePath: finalPath,
      samUrl: f.samUrl,
      extractedText: input.textMode === 'full' ? f.extractedText : f.extractedText.slice(0, CACHE_TEXT_CAP),
      extractionError: f.extractionError ?? null,
    });
  }

  const cacheMetas = metas.map((m) => ({ ...m, extractedText: m.extractedText.slice(0, CACHE_TEXT_CAP) }));
  await setCached('solicitation_docs', { noticeId: resolvedNoticeId }, cacheMetas, CACHE_TTL);

  base.documents = await toOutputDocs(supabase, metas, inlineCap, input);
  base.source = 'on_demand';
  return applyHonestyMeta(base, mergeListed(listedFromCache, warmListed, fetchedListed), input.textMode, noticedescLimitation, metas.length);
}
