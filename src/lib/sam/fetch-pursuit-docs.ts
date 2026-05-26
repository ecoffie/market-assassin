/**
 * fetch-pursuit-docs — pull SAM.gov attachments for a saved pursuit
 *
 * Given a notice_id and pipeline_id, this helper:
 *   1. Calls SAM opportunities API to discover resourceLinks (file IDs)
 *   2. Downloads each file blob via SAM's CDN (with our API key)
 *   3. Uploads the blob to Supabase Storage bucket 'pursuit-documents'
 *   4. Extracts text via pdf-parse / mammoth (mirrors /api/app/proposal/upload)
 *   5. Upserts a row in pursuit_documents with metadata + extracted text
 *
 * Idempotent: uses the (pipeline_id, sam_file_id) unique constraint, so
 * re-running on the same pursuit either does nothing (already cached)
 * or fills in only the new files (amendments).
 *
 * Updates user_pipeline.docs_status as it runs:
 *   pending  → fetching → ready (N docs) | none (SAM had nothing) | failed
 *
 * Built 2026-05-25 for the Pursuit → Proposal Assist auto-ingest flow.
 * Eliminates the manual download-from-SAM + upload-to-Proposal-Assist
 * step that was making the Proposal panel feel like dead weight.
 */

import { createClient } from '@supabase/supabase-js';
import { getRotatedSAMKey } from './utils';
import { extractPdf, extractDocx, extractTxt } from './pdf-extract';

const SAM_OPPS_URL = 'https://api.sam.gov/opportunities/v2/search';
const SAM_FILE_URL_PREFIX = 'https://sam.gov/api/prod/opps/v3/opportunities/resources/files/';
const SUPABASE_BUCKET = 'pursuit-documents';
const MAX_FILE_SIZE = 20 * 1024 * 1024;  // 20MB — bigger than the manual upload cap because we're not bottlenecked by Vercel formData
const MAX_EXTRACTED_TEXT_CHARS = 200_000; // Generous cap; AI calls will further truncate

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

interface SamFileRef {
  url: string;
  fileId: string;
  filename: string;
}

// Extractors (extractPdf, extractDocx, extractTxt) imported from
// ./pdf-extract — shared module with DOMMatrix/ImageData/Path2D
// polyfills installed before pdf-parse loads.

function inferKind(filename: string, mime: string | null, buffer?: Buffer): 'pdf' | 'docx' | 'txt' | null {
  const lower = filename.toLowerCase();
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) return 'docx';
  if (mime === 'text/plain' || lower.endsWith('.txt')) return 'txt';

  // SAM downloads frequently come back as 'application/octet-stream'
  // with no useful filename (Content-Disposition not exposed via
  // CORS, or just missing). Fall back to magic-byte sniffing:
  //   PDF:  first 4 bytes = '%PDF'
  //   DOCX: ZIP signature 'PK' at offset 0 + 'word/' string in first 1KB
  //   TXT:  printable ASCII / UTF-8 only (no null bytes)
  if (buffer && buffer.length >= 4) {
    const head = buffer.slice(0, 4).toString('ascii');
    if (head === '%PDF') return 'pdf';
    if (head.startsWith('PK')) {
      // Could be DOCX, XLSX, ZIP, etc. — look for 'word/' marker.
      const probe = buffer.slice(0, 2048).toString('ascii');
      if (probe.includes('word/')) return 'docx';
    }
    // Heuristic for plain text: scan first 1KB for null bytes (binary
    // files almost always have them, text files don't).
    const sample = buffer.slice(0, 1024);
    if (!sample.includes(0)) return 'txt';
  }
  return null;
}

/**
 * Parse RFC 5987 / classic Content-Disposition to get the real filename
 * SAM stores. Without this we fall back to 'Document N (fileId)' which
 * is much less useful for the Proposal Assist UI.
 */
function parseFilenameFromDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''));
    } catch { /* fall through */ }
  }
  const plainMatch = cd.match(/filename="([^"]+)"/i) || cd.match(/filename=([^;]+)/i);
  if (plainMatch?.[1]) return plainMatch[1].trim();
  return null;
}

/**
 * Step 1: ask SAM opportunities API for this notice's resourceLinks.
 * Returns a list of file refs with id + URL + best-effort filename
 * (HEAD'd via the proxy logic to get real Content-Disposition).
 */
async function discoverFiles(noticeId: string, apiKey: string): Promise<SamFileRef[]> {
  const today = new Date();
  const fmt = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

  // SAM API rejects cross-calendar-year date windows with the bogus
  // error 'Date range must be null year(s) apart'. Try current calendar
  // year first, then last year as fallback. This bit us hard — the
  // earlier 2-year window returned 0 results for every notice.
  const currentYear = today.getFullYear();
  const dateWindows = [
    { from: `01/01/${currentYear}`, to: fmt(today) },
    { from: `01/01/${currentYear - 1}`, to: `12/31/${currentYear - 1}` },
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let opp: any = null;
  for (const window of dateWindows) {
    const url = new URL(SAM_OPPS_URL);
    url.searchParams.set('api_key', apiKey);
    // SAM API quirk: the parameter MUST be lowercase 'noticeid' for
    // exact-match lookup. Camel-case 'noticeId' returns broad fuzzy
    // results (often the wrong opportunity entirely). Tested 2026-05-25.
    url.searchParams.set('noticeid', noticeId);
    url.searchParams.set('postedFrom', window.from);
    url.searchParams.set('postedTo', window.to);
    url.searchParams.set('limit', '1');

    let res: Response;
    try {
      res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    } catch (err) {
      console.warn('[fetch-pursuit-docs] discoverFiles fetch failed:', err);
      continue;
    }
    if (!res.ok) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = await res.json().catch(() => null) as any;
    const candidate = payload?.opportunitiesData?.[0];
    if (candidate) {
      opp = candidate;
      break;
    }
  }
  if (!opp) return [];

  const links: string[] = Array.isArray(opp.resourceLinks) ? opp.resourceLinks : [];
  if (links.length === 0) return [];

  return Promise.all(
    links.map(async (rawUrl: string, i: number): Promise<SamFileRef> => {
      let fileId = '';
      try {
        const parts = new URL(rawUrl).pathname.split('/').filter(Boolean);
        const last = parts[parts.length - 1];
        if (last && last.toLowerCase() !== 'download') fileId = last;
        else if (parts.length >= 2) fileId = parts[parts.length - 2];
      } catch { /* leave empty */ }

      // HEAD with api_key for the real filename
      let realName = '';
      try {
        const headUrl = new URL(rawUrl);
        if (!headUrl.searchParams.has('api_key')) headUrl.searchParams.set('api_key', apiKey);
        const headRes = await fetch(headUrl.toString(), { method: 'HEAD' });
        realName = parseFilenameFromDisposition(headRes.headers.get('content-disposition')) || '';
      } catch { /* fall through */ }

      return {
        url: rawUrl,
        fileId: fileId || `unknown-${i}`,
        filename: realName || (fileId ? `Document ${i + 1} (${fileId.slice(0, 8)})` : `Document ${i + 1}`),
      };
    })
  );
}

/**
 * Step 2: download one file blob from SAM with our API key.
 */
async function downloadFile(ref: SamFileRef, apiKey: string): Promise<{ buffer: Buffer; mime: string; size: number } | null> {
  const fetchUrl = new URL(ref.url.startsWith('http') ? ref.url : `${SAM_FILE_URL_PREFIX}${ref.fileId}/download`);
  if (!fetchUrl.searchParams.has('api_key')) fetchUrl.searchParams.set('api_key', apiKey);

  let res: Response;
  try {
    res = await fetch(fetchUrl.toString(), { headers: { Accept: '*/*' } });
  } catch (err) {
    console.warn(`[fetch-pursuit-docs] download ${ref.fileId} failed:`, err);
    return null;
  }
  if (!res.ok) {
    console.warn(`[fetch-pursuit-docs] download ${ref.fileId} HTTP ${res.status}`);
    return null;
  }

  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_FILE_SIZE) {
    console.warn(`[fetch-pursuit-docs] file ${ref.fileId} too large (${ab.byteLength} bytes), skipping`);
    return null;
  }

  return {
    buffer: Buffer.from(ab),
    mime: res.headers.get('content-type') || 'application/octet-stream',
    size: ab.byteLength,
  };
}

/**
 * Main entry: fetch all docs for a pursuit and populate the cache.
 * Returns a summary so callers can log / surface in UI.
 *
 * Errors are caught per-file so a single bad doc doesn't kill the whole
 * batch. user_pipeline.docs_status reflects the aggregate outcome.
 */
export async function fetchPursuitDocs(opts: {
  pipelineId: string;
  userEmail: string;
  noticeId: string;
}): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  status: 'ready' | 'none' | 'failed';
}> {
  const { pipelineId, userEmail, noticeId } = opts;
  const supabase = getSupabase();

  const apiKey = getRotatedSAMKey();
  if (!apiKey) {
    await supabase.from('user_pipeline')
      .update({ docs_status: 'failed', docs_fetched_at: new Date().toISOString() })
      .eq('id', pipelineId);
    return { attempted: 0, succeeded: 0, failed: 0, status: 'failed' };
  }

  // Mark in-flight so UI can show 'Fetching docs…'
  await supabase.from('user_pipeline')
    .update({ docs_status: 'fetching' })
    .eq('id', pipelineId);

  const fileRefs = await discoverFiles(noticeId, apiKey);
  if (fileRefs.length === 0) {
    await supabase.from('user_pipeline')
      .update({
        docs_status: 'none',
        docs_count: 0,
        docs_fetched_at: new Date().toISOString(),
      })
      .eq('id', pipelineId);
    return { attempted: 0, succeeded: 0, failed: 0, status: 'none' };
  }

  let succeeded = 0;
  let failed = 0;

  for (const ref of fileRefs) {
    try {
      const dl = await downloadFile(ref, apiKey);
      if (!dl) { failed++; continue; }

      const kind = inferKind(ref.filename, dl.mime, dl.buffer);
      let extractedText = '';
      let pageCount: number | undefined;
      let extractionError: string | null = null;

      if (kind === 'pdf') {
        try {
          const result = await extractPdf(dl.buffer);
          extractedText = (result.text || '').slice(0, MAX_EXTRACTED_TEXT_CHARS);
          pageCount = result.pageCount;
        } catch (err) {
          extractionError = err instanceof Error ? err.message : 'PDF parse failed';
        }
      } else if (kind === 'docx') {
        try {
          const result = await extractDocx(dl.buffer);
          extractedText = (result.text || '').slice(0, MAX_EXTRACTED_TEXT_CHARS);
        } catch (err) {
          extractionError = err instanceof Error ? err.message : 'DOCX parse failed';
        }
      } else if (kind === 'txt') {
        extractedText = dl.buffer.toString('utf-8').slice(0, MAX_EXTRACTED_TEXT_CHARS);
      } else {
        extractionError = 'Unsupported file type';
      }

      // Upload blob to Supabase Storage (best-effort — extracted text
      // is the primary value, raw blob is bonus for downloads).
      const storagePath = `${userEmail}/${pipelineId}/${ref.fileId}-${ref.filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`.slice(0, 500);
      let finalStoragePath: string | null = null;
      try {
        const { error: uploadErr } = await supabase.storage
          .from(SUPABASE_BUCKET)
          .upload(storagePath, dl.buffer, {
            contentType: dl.mime,
            upsert: true,
          });
        if (uploadErr) {
          console.warn(`[fetch-pursuit-docs] storage upload ${ref.fileId} failed:`, uploadErr);
        } else {
          finalStoragePath = storagePath;
        }
      } catch (err) {
        console.warn(`[fetch-pursuit-docs] storage upload ${ref.fileId} threw:`, err);
      }

      // Upsert metadata row
      const { error: insertErr } = await supabase
        .from('pursuit_documents')
        .upsert({
          pipeline_id: pipelineId,
          user_email: userEmail,
          sam_file_id: ref.fileId,
          sam_url: ref.url,
          notice_id: noticeId,
          filename: ref.filename,
          mime_type: dl.mime,
          size_bytes: dl.size,
          storage_path: finalStoragePath,
          extracted_text: extractedText || null,
          page_count: pageCount,
          char_count: extractedText.length,
          downloaded_at: new Date().toISOString(),
          extracted_at: extractionError ? null : new Date().toISOString(),
          extraction_error: extractionError,
        }, { onConflict: 'pipeline_id,sam_file_id' });

      if (insertErr) {
        console.warn(`[fetch-pursuit-docs] upsert ${ref.fileId} failed:`, insertErr);
        failed++;
      } else {
        succeeded++;
      }
    } catch (err) {
      console.warn(`[fetch-pursuit-docs] ${ref.fileId} threw:`, err);
      failed++;
    }
  }

  const finalStatus: 'ready' | 'failed' = succeeded > 0 ? 'ready' : 'failed';
  await supabase.from('user_pipeline')
    .update({
      docs_status: finalStatus,
      docs_count: succeeded,
      docs_fetched_at: new Date().toISOString(),
    })
    .eq('id', pipelineId);

  return {
    attempted: fileRefs.length,
    succeeded,
    failed,
    status: finalStatus,
  };
}
