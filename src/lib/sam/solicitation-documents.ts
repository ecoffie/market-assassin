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
import { fetchAndExtractNoticeFiles, normalizeNoticeId } from '@/lib/sam/fetch-pursuit-docs';
import { isNoticeUuid, resolveCanonicalSolicitation } from '@/lib/sam/resolve-solicitation';
import {
  assembleNoticeSourceText,
  attachmentLocationNote,
  detectPiee,
  extractPieeLinks,
  pieeRetrievalLimitation,
} from '@/lib/sam/notice-identity';
import { parseSamAttachment } from '@/lib/sam/attachment-metadata';
import { fetchNoticeDescription, isDescriptionLink } from '@/lib/sam/notice-description';
import { getRotatedSAMKey } from '@/lib/sam/utils';

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
  extracted_text: string; // inline; capped unless textMode='full'
  extracted_text_truncated: boolean;
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
): Promise<SolicitationDocument[]> {
  return Promise.all(
    metas.map(async (m) => {
      const { url, source } = await signUrl(supabase, m.storagePath, m.samUrl, m.filename);
      const inline = cap(m.extractedText, inlineCap);
      const cacheTruncated = (m.charCount ?? m.extractedText.length) > m.extractedText.length;
      return {
        filename: m.filename,
        doc_kind: m.docKind,
        mime_type: m.mime,
        page_count: m.pageCount,
        char_count: m.charCount,
        extracted_text: inline.text,
        extracted_text_truncated: inline.truncated || cacheTruncated,
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
): SolicitationDocumentsResult {
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
  base.retrieval_limitation = pieeRetrievalLimitation(pieeLinks);

  const assembled = assembleNoticeSourceText({
    sow_text: base.sow_text,
    description: base.description,
    documents: base.documents,
  });
  base.truncated_attachments = assembled.truncated_attachments;
  if (textMode === 'full') base.source_text = assembled.text;
  return base;
}

export async function getSolicitationDocuments(input: {
  noticeId: string;
  /** inline (default) caps extracted_text for MCP payloads. full is required for compliance-matrix. */
  textMode?: 'inline' | 'full';
}): Promise<SolicitationDocumentsResult> {
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
      const apiKey = getRotatedSAMKey();
      if (apiKey) {
        try {
          descriptionText = await fetchNoticeDescription(linkOrId, apiKey);
        } catch (err) {
          console.error('[getSolicitationDocuments] noticedesc', err);
          base.degraded = true;
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
    .select('sam_file_id, sam_url, filename, mime_type, page_count, char_count, extracted_text, storage_path, doc_kind')
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
      });
    }
    if (metas.length > 0) {
      base.documents = await toOutputDocs(supabase, metas, inlineCap);
      base.source = 'cache';
      return applyHonestyMeta(base, mergeListed(listedFromCache, warmListed), input.textMode);
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
    base.documents = await toOutputDocs(supabase, cached, inlineCap);
    base.source = 'cache';
    return applyHonestyMeta(base, mergeListed(listedFromCache, warmListed, cachedListed), input.textMode);
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
    return applyHonestyMeta(base, mergeListed(listedFromCache, warmListed), input.textMode);
  }

  // Upload each raw blob to Storage under a notice-level path, build metadata.
  const metas: CachedDocMeta[] = [];
  const fetchedListed: ListedAttachment[] = [];
  for (const f of fetched.documents) {
    const safe = `${f.fileId}-${(f.filename || 'file').replace(/[^a-zA-Z0-9.-]/g, '_')}`.slice(0, 400);
    const storagePath = `_notices/${resolvedNoticeId}/${safe}`;
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
    });
  }

  const cacheMetas = metas.map((m) => ({ ...m, extractedText: m.extractedText.slice(0, CACHE_TEXT_CAP) }));
  await setCached('solicitation_docs', { noticeId: resolvedNoticeId }, cacheMetas, CACHE_TTL);

  base.documents = await toOutputDocs(supabase, metas, inlineCap);
  base.source = 'on_demand';
  return applyHonestyMeta(base, mergeListed(listedFromCache, warmListed, fetchedListed), input.textMode);
}
