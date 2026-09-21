/**
 * fetch-grant-docs — pull grants.gov documents for a saved grant pursuit
 *
 * The SAM attachment fetcher (src/lib/sam/fetch-pursuit-docs.ts) can't serve
 * grant pursuits — their notice_id is a grants.gov opportunity NUMBER (e.g.
 * "26-503", "2026-NIST-RAMPS-01"), not a SAM UUID, so SAM search returns
 * nothing and the pursuit lands 'failed'. This fetcher is the grants.gov
 * equivalent, writing into the SAME pursuit_documents table (doc_source =
 * 'grants_public') so the Proposal Assist drawer renders grant docs unchanged.
 *
 * Flow (all verified live 2026-06-03):
 *   1. Resolve the stored opportunity NUMBER → numeric opportunity id via
 *      grants.gov search2 ({"oppNum": "..."}).
 *   2. fetchOpportunity(id) → synopsisAttachmentFolders[].synopsisAttachments[]
 *      (each {id, fileName, mimeType}) + synopsis.synopsisDesc (full NOFO text).
 *   3. Download each attachment from
 *      https://www.grants.gov/grantsws/rest/opportunity/att/download/{attId}
 *      (public, no auth).
 *   4. Extract text (reuse pdf-extract), upload blob to Supabase Storage,
 *      upsert pursuit_documents.
 *   5. If a grant has NO file attachments, write the synopsis text itself as a
 *      single 'document' so the pursuit is never empty (the synopsis IS the
 *      RFP-equivalent for many grants).
 *
 * Updates user_pipeline.docs_status: fetching → ready | none | failed.
 * No API key required — grants.gov is a public API.
 */

import { createClient } from '@supabase/supabase-js';
import { extractPdf, extractDocx } from '../sam/pdf-extract';
import { fetchPursuitDocs } from '../sam/fetch-pursuit-docs';

const GRANTS_SEARCH_URL = 'https://api.grants.gov/v1/api/search2';
const GRANTS_FETCH_URL = 'https://api.grants.gov/v1/api/fetchOpportunity';
const GRANTS_ATT_DOWNLOAD = 'https://www.grants.gov/grantsws/rest/opportunity/att/download/';
const SUPABASE_BUCKET = 'pursuit-documents';
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 200_000;

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

/**
 * Heuristic: does this pursuit look like a grants.gov opportunity rather than a
 * SAM notice? Prefer the explicit source column; fall back to id shape. A SAM
 * notice_id is a 32-hex UUID — anything else with a grants-y shape is a grant.
 */
export function isGrantPursuit(noticeId?: string | null, source?: string | null): boolean {
  // The source column is the authoritative signal — grants saved via the
  // GrantsPanel / SaveToPipelineButton carry a grants-y source.
  const src = (source || '').toLowerCase();
  if (src.includes('grant')) return true;
  if (src.includes('sam')) return false;

  // Fallback heuristic (used only when source is ambiguous, e.g. 'manual').
  // Be CONSERVATIVE: a SAM solicitation number (e.g. "47QTCB21D0147",
  // "N6247324D5234") must NOT be misrouted to grants.gov. Only treat clear
  // grant-number shapes as grants; everything else defaults to SAM.
  const id = (noticeId || '').trim();
  if (!id) return false;
  if (/^[a-f0-9]{32}$/i.test(id.replace(/-/g, ''))) return false; // SAM UUID
  // Grant opportunity-number shapes:
  //   year-prefixed:        2026-NIST-RAMPS-01
  //   agency-year path:     HHS-2026-ACL-..., S-DR860-26-NOFO-0006
  //   short dash-numeric:   26-503
  if (/^\d{2,4}-[A-Z]/i.test(id)) return true;        // 2026-NIST..., 26-503
  if (/^[A-Z]{2,5}-\d{2,4}-/i.test(id)) return true;  // HHS-2026-...
  if (/^[A-Z]-[A-Z0-9]+-\d{2}-/i.test(id)) return true; // S-DR860-26-...
  // Default: treat as SAM (the SAM fetcher handles sol# → UUID resolution).
  return false;
}

interface GrantAttachment {
  attId: string;
  fileName: string;
  mimeType: string | null;
}

/** search2 by opportunity number → numeric opportunity id. */
async function resolveOpportunityId(oppNumber: string): Promise<string | null> {
  try {
    const res = await fetch(GRANTS_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oppNum: oppNumber }),
    });
    if (!res.ok) return null;
    const payload = await res.json().catch(() => null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hits = payload?.data?.oppHits as any[] | undefined;
    if (!Array.isArray(hits) || hits.length === 0) return null;
    // Prefer an exact number match, else the first hit.
    const exact = hits.find((h) => String(h.number || '').trim() === oppNumber.trim());
    const id = (exact || hits[0])?.id;
    return id != null ? String(id) : null;
  } catch {
    return null;
  }
}

/** fetchOpportunity → { attachments, synopsisText }. */
async function fetchOpportunityDetail(
  opportunityId: string,
): Promise<{ attachments: GrantAttachment[]; synopsisText: string } | null> {
  try {
    const res = await fetch(GRANTS_FETCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opportunityId: Number(opportunityId) }),
    });
    if (!res.ok) return null;
    const payload = await res.json().catch(() => null);
    const data = payload?.data;
    if (!data) return null;

    const attachments: GrantAttachment[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const folders = (data.synopsisAttachmentFolders || []) as any[];
    for (const folder of folders) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const atts = (folder.synopsisAttachments || folder.attachments || []) as any[];
      for (const a of atts) {
        if (a?.id == null) continue;
        attachments.push({
          attId: String(a.id),
          fileName: a.fileName || a.name || `grant-attachment-${a.id}`,
          mimeType: a.mimeType || null,
        });
      }
    }

    const synopsisText = String(data.synopsis?.synopsisDesc || '')
      // Grant synopses are HTML-ish; strip tags to plain text.
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

    return { attachments, synopsisText };
  } catch {
    return null;
  }
}

function inferKind(fileName: string, mime: string | null, buffer?: Buffer): 'pdf' | 'docx' | 'txt' | null {
  const lower = fileName.toLowerCase();
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (mime?.includes('wordprocessingml') || lower.endsWith('.docx')) return 'docx';
  if (mime === 'text/plain' || lower.endsWith('.txt')) return 'txt';
  if (buffer && buffer.length >= 4) {
    const head = buffer.slice(0, 4).toString('ascii');
    if (head === '%PDF') return 'pdf';
    if (head.startsWith('PK') && buffer.slice(0, 2048).toString('ascii').includes('word/')) return 'docx';
    if (!buffer.slice(0, 1024).includes(0)) return 'txt';
  }
  return null;
}

async function downloadAttachment(att: GrantAttachment): Promise<{ buffer: Buffer; mime: string; size: number } | null> {
  const url = `${GRANTS_ATT_DOWNLOAD}${att.attId}`;
  const MAX_TRIES = 3;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: '*/*' }, redirect: 'follow' });
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_TRIES) {
          await new Promise((r) => setTimeout(r, attempt * 1500));
          continue;
        }
        return null;
      }
      const ab = await res.arrayBuffer();
      if (ab.byteLength > MAX_FILE_SIZE) return null;
      return {
        buffer: Buffer.from(ab),
        mime: res.headers.get('content-type') || att.mimeType || 'application/octet-stream',
        size: ab.byteLength,
      };
    } catch {
      if (attempt < MAX_TRIES) { await new Promise((r) => setTimeout(r, attempt * 1500)); continue; }
      return null;
    }
  }
  return null;
}

export async function fetchGrantDocs(opts: {
  pipelineId: string;
  userEmail: string;
  noticeId: string; // grants.gov opportunity NUMBER
}): Promise<{ attempted: number; succeeded: number; failed: number; status: 'ready' | 'none' | 'failed' }> {
  const { pipelineId, userEmail, noticeId } = opts;
  const supabase = getSupabase();

  await supabase.from('user_pipeline').update({ docs_status: 'fetching' }).eq('id', pipelineId);

  const opportunityId = await resolveOpportunityId(noticeId);
  if (!opportunityId) {
    // Not findable on grants.gov — mark failed so the user can retry / upload.
    await supabase.from('user_pipeline')
      .update({ docs_status: 'failed', docs_fetched_at: new Date().toISOString() })
      .eq('id', pipelineId);
    return { attempted: 0, succeeded: 0, failed: 0, status: 'failed' };
  }

  const detail = await fetchOpportunityDetail(opportunityId);
  if (!detail) {
    await supabase.from('user_pipeline')
      .update({ docs_status: 'failed', docs_fetched_at: new Date().toISOString() })
      .eq('id', pipelineId);
    return { attempted: 0, succeeded: 0, failed: 0, status: 'failed' };
  }

  let succeeded = 0;
  let failed = 0;

  // 1) Real file attachments.
  for (const att of detail.attachments) {
    try {
      const dl = await downloadAttachment(att);
      if (!dl) { failed++; continue; }

      const kind = inferKind(att.fileName, dl.mime, dl.buffer);
      let extractedText = '';
      let pageCount: number | undefined;
      let extractionError: string | null = null;
      try {
        if (kind === 'pdf') {
          const r = await extractPdf(dl.buffer);
          extractedText = (r.text || '').slice(0, MAX_EXTRACTED_TEXT_CHARS);
          pageCount = r.pageCount;
        } else if (kind === 'docx') {
          const r = await extractDocx(dl.buffer);
          extractedText = (r.text || '').slice(0, MAX_EXTRACTED_TEXT_CHARS);
        } else if (kind === 'txt') {
          extractedText = dl.buffer.toString('utf-8').slice(0, MAX_EXTRACTED_TEXT_CHARS);
        } else {
          extractionError = 'Unsupported file type';
        }
      } catch (err) {
        extractionError = err instanceof Error ? err.message : 'extract failed';
      }

      const storagePath = `${userEmail}/${pipelineId}/grant-${att.attId}-${att.fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`.slice(0, 500);
      let finalStoragePath: string | null = null;
      try {
        const { error: upErr } = await supabase.storage.from(SUPABASE_BUCKET)
          .upload(storagePath, dl.buffer, { contentType: dl.mime, upsert: true });
        if (!upErr) finalStoragePath = storagePath;
      } catch { /* best-effort */ }

      const { error: insErr } = await supabase.from('pursuit_documents').upsert({
        pipeline_id: pipelineId,
        user_email: userEmail,
        sam_file_id: `grant-${att.attId}`, // reuse the unique key column (id namespaced)
        sam_url: `${GRANTS_ATT_DOWNLOAD}${att.attId}`,
        notice_id: noticeId,
        filename: att.fileName,
        mime_type: dl.mime,
        size_bytes: dl.size,
        storage_path: finalStoragePath,
        extracted_text: extractedText || null,
        page_count: pageCount,
        char_count: extractedText.length,
        doc_source: 'grants_public',
        downloaded_at: new Date().toISOString(),
        extracted_at: extractionError ? null : new Date().toISOString(),
        extraction_error: extractionError,
      }, { onConflict: 'pipeline_id,sam_file_id' });

      if (insErr) { failed++; } else { succeeded++; }
    } catch {
      failed++;
    }
  }

  // 2) Fallback: if no file attachments downloaded but we have synopsis text,
  // store the synopsis itself as a single document (it's the RFP-equivalent).
  if (succeeded === 0 && detail.synopsisText.length > 200) {
    const { error: insErr } = await supabase.from('pursuit_documents').upsert({
      pipeline_id: pipelineId,
      user_email: userEmail,
      sam_file_id: `grant-synopsis-${opportunityId}`,
      sam_url: `https://www.grants.gov/search-results-detail/${opportunityId}`,
      notice_id: noticeId,
      filename: 'Grant synopsis (grants.gov).txt',
      mime_type: 'text/plain',
      size_bytes: detail.synopsisText.length,
      storage_path: null,
      extracted_text: detail.synopsisText.slice(0, MAX_EXTRACTED_TEXT_CHARS),
      page_count: null,
      char_count: detail.synopsisText.length,
      doc_source: 'grants_public',
      downloaded_at: new Date().toISOString(),
      extracted_at: new Date().toISOString(),
      extraction_error: null,
    }, { onConflict: 'pipeline_id,sam_file_id' });
    if (!insErr) succeeded++;
  }

  const status: 'ready' | 'none' | 'failed' =
    succeeded > 0 ? 'ready' : (detail.attachments.length === 0 ? 'none' : 'failed');
  await supabase.from('user_pipeline')
    .update({ docs_status: status, docs_count: succeeded, docs_fetched_at: new Date().toISOString() })
    .eq('id', pipelineId);

  return { attempted: detail.attachments.length, succeeded, failed, status };
}

/**
 * Unified dispatcher: route a pursuit's doc-fetch to grants.gov or SAM based on
 * its source / notice_id shape. The 3 call sites (pipeline POST after(),
 * add-to-pipeline GET+POST after(), pursuit-docs retry) call this so the
 * grants-vs-SAM decision lives in one place.
 */
export async function fetchPursuitDocsAuto(opts: {
  pipelineId: string;
  userEmail: string;
  noticeId: string;
  source?: string | null;
  solicitationNumber?: string | null;
  title?: string | null;
  agency?: string | null;
}): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  status: 'ready' | 'none' | 'failed';
  // SAM-path diagnostics (undefined on the grants path).
  downloadNulls?: number;
  lastInsertError?: string | null;
  discoverTrace?: string[];
}> {
  if (isGrantPursuit(opts.noticeId, opts.source)) {
    return fetchGrantDocs({ pipelineId: opts.pipelineId, userEmail: opts.userEmail, noticeId: opts.noticeId });
  }
  return fetchPursuitDocs({
    pipelineId: opts.pipelineId,
    userEmail: opts.userEmail,
    noticeId: opts.noticeId,
    solicitationNumber: opts.solicitationNumber,
    title: opts.title,
    agency: opts.agency,
  });
}
