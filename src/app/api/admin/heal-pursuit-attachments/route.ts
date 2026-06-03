/**
 * /api/admin/heal-pursuit-attachments
 *
 * One-shot repair for pursuits whose SAM attachments never landed. Two root
 * causes this heals:
 *   1. notice_id stored as a solicitation number (e.g. "70203926CGASHED")
 *      instead of the canonical SAM UUID — the attachment fetcher keys off the
 *      UUID, so these always came back empty.
 *   2. docs_status stuck at 'fetching' (killed background worker) or sitting at
 *      'none'/'failed' from a fetch that ran before the cache-first fix.
 *
 * For each candidate it re-runs fetchPursuitDocs(), which now resolves the
 * solicitation number → UUID via the SAM cache, heals user_pipeline.notice_id,
 * and pulls attachment URLs straight from sam_opportunities.attachments.
 *
 * GET  ?password=...                      → preview: how many pursuits need healing
 * POST ?password=...&mode=execute         → run the heal
 *   optional &limit=N  (default 50 per run — keep under the function budget)
 *   optional &email=user@example.com      → scope to one user
 *   optional &pipeline_id=<uuid>          → heal a single pursuit
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchPursuitDocsAuto } from '@/lib/grants/fetch-grant-docs';
import { extractPdf } from '@/lib/sam/pdf-extract';
import { getRotatedSAMKey } from '@/lib/sam/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

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

const isUuid = (v?: string | null) => !!v && /^[a-f0-9]{32}$/i.test(v.trim());

interface PipelineRow {
  id: string;
  user_email: string | null;
  notice_id: string | null;
  title: string | null;
  docs_status: string | null;
  docs_count: number | null;
  source: string | null;
  agency: string | null;
}

// A pursuit needs healing if it has a notice_id but either the id isn't a UUID
// (so the fetcher couldn't match it) or no docs landed yet.
function needsHeal(row: PipelineRow): boolean {
  if (!row.notice_id) return false;
  if (!isUuid(row.notice_id)) return true;
  const status = row.docs_status;
  if (status === 'fetching' || status === 'pending' || status === 'failed') return true;
  if (status === 'none' && (row.docs_count || 0) === 0) return true; // re-verify with cache-first fetch
  return false;
}

async function loadCandidates(opts: { email?: string | null; pipelineId?: string | null }): Promise<PipelineRow[]> {
  const sb = getSupabase();
  let query = sb
    .from('user_pipeline')
    .select('id, user_email, notice_id, title, docs_status, docs_count, source, agency')
    .not('notice_id', 'is', null)
    .limit(2000);
  if (opts.pipelineId) query = query.eq('id', opts.pipelineId);
  else if (opts.email) query = query.eq('user_email', opts.email.toLowerCase());
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data || []) as PipelineRow[]).filter(needsHeal);
}

// Coverage metric: of all pursuits with a SAM notice_id, what fraction reached
// a terminal attachment state, and how many actually have docs. This is the
// "are we at 100%" gauge — once stuck/non-UUID pursuits drop to ~0, Proposal
// Assist has the documents it needs.
async function attachmentCoverage() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('user_pipeline')
    .select('notice_id, docs_status, docs_count')
    .not('notice_id', 'is', null)
    .limit(5000);
  if (error) throw new Error(error.message);
  const rows = (data || []) as PipelineRow[];
  const total = rows.length;
  const byStatus: Record<string, number> = {};
  let nonUuid = 0;
  let withDocs = 0;
  let terminal = 0;
  for (const r of rows) {
    const s = r.docs_status || 'unset';
    byStatus[s] = (byStatus[s] || 0) + 1;
    if (!isUuid(r.notice_id)) nonUuid++;
    if ((r.docs_count || 0) > 0) withDocs++;
    if (s === 'ready' || s === 'none') terminal++;
  }
  const stuck = total - terminal; // fetching/pending/failed/unset
  return {
    totalPursuits: total,
    terminalResolved: terminal,
    resolvedPct: total ? Math.round((terminal / total) * 1000) / 10 : 100,
    withDocs,
    withDocsPct: total ? Math.round((withDocs / total) * 1000) / 10 : 0,
    stuckOrUnresolved: stuck,
    solicitationNumberAsId: nonUuid,
    byStatus,
  };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  if (url.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ?debug_notice=<uuid|solicitation> → dump exactly what the SAM cache holds
  // for one notice, so we can tell "not synced" from "synced but no attachments".
  const debugNotice = url.searchParams.get('debug_notice');
  if (debugNotice) {
    const sb = getSupabase();
    const id = debugNotice.trim();
    const byId = await sb.from('sam_opportunities')
      .select('notice_id, solicitation_number, title, attachments, raw_data')
      .eq('notice_id', id).maybeSingle();
    const bySol = byId.data ? null : await sb.from('sam_opportunities')
      .select('notice_id, solicitation_number, title, attachments, raw_data')
      .ilike('solicitation_number', id).limit(1).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = byId.data || bySol?.data || null;
    if (!row) {
      return NextResponse.json({ success: true, found: false, id, note: 'Notice not in sam_opportunities cache' });
    }
    const raw = row.raw_data || {};
    return NextResponse.json({
      success: true,
      found: true,
      matchedBy: byId.data ? 'notice_id' : 'solicitation_number',
      notice_id: row.notice_id,
      solicitation_number: row.solicitation_number,
      title: row.title,
      attachmentsColumn: {
        isArray: Array.isArray(row.attachments),
        length: Array.isArray(row.attachments) ? row.attachments.length : null,
        sample: Array.isArray(row.attachments) ? row.attachments[0] : row.attachments,
      },
      rawResourceLinks: {
        present: 'resourceLinks' in raw,
        isArray: Array.isArray(raw.resourceLinks),
        length: Array.isArray(raw.resourceLinks) ? raw.resourceLinks.length : null,
        sample: Array.isArray(raw.resourceLinks) ? raw.resourceLinks[0] : null,
      },
    });
  }

  // ?trace_url=<sam download url> → run download + extract on ONE file and
  // report exactly where it fails (download HTTP, magic bytes, extracted chars).
  const traceUrl = url.searchParams.get('trace_url');
  if (traceUrl) {
    const out: Record<string, unknown> = { url: traceUrl };
    try {
      const res = await fetch(traceUrl, { headers: { Accept: '*/*' }, redirect: 'follow' });
      out.downloadStatus = res.status;
      out.contentType = res.headers.get('content-type');
      out.finalUrl = res.url;
      if (res.ok) {
        const ab = await res.arrayBuffer();
        const buf = Buffer.from(ab);
        out.bytes = buf.length;
        out.magic = buf.slice(0, 5).toString('ascii');
        if (out.magic === '%PDF-') {
          try {
            const r = await extractPdf(buf);
            out.extractedChars = (r.text || '').length;
            out.pageCount = r.pageCount;
            out.extractSample = (r.text || '').slice(0, 200);
          } catch (e) {
            out.extractError = e instanceof Error ? e.message : String(e);
          }
        }
      }
    } catch (e) {
      out.downloadError = e instanceof Error ? e.message : String(e);
    }
    return NextResponse.json({ success: true, trace: out });
  }

  // ?samkey=true → is a SAM API key available in this runtime? (fetchPursuitDocs
  // early-returns 'failed' when getRotatedSAMKey() is empty.)
  if (url.searchParams.get('samkey') === 'true') {
    const k = getRotatedSAMKey();
    return NextResponse.json({ success: true, hasSamKey: !!k, keyLength: k ? k.length : 0 });
  }

  // ?docs_for=<pipeline_id> → dump pursuit_documents rows for a pursuit, so we
  // can tell "no row = download failed" from "row with extraction_error".
  const docsFor = url.searchParams.get('docs_for');
  if (docsFor) {
    const sb = getSupabase();
    const { data } = await sb.from('pursuit_documents')
      .select('sam_file_id, filename, mime_type, size_bytes, char_count, extraction_error, doc_source, downloaded_at')
      .eq('pipeline_id', docsFor);
    return NextResponse.json({ success: true, pipeline_id: docsFor, rows: data || [] });
  }

  // ?sam_trace=<noticeId|solnum> → run the LIVE SAM opportunities search the
  // fetcher uses and dump what it returns (resourceLinks count, title), so we
  // can tell "SAM has no links" from "SAM didn't return the notice".
  const samTrace = url.searchParams.get('sam_trace');
  if (samTrace) {
    const key = getRotatedSAMKey();
    if (!key) return NextResponse.json({ success: false, error: 'No SAM key' }, { status: 500 });
    const id = samTrace.trim();
    // Also allow passing a separate solicitation number via &sol= to test the
    // solnum path even when the primary id is a UUID.
    const sol = url.searchParams.get('sol');
    const today = new Date();
    const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
    const yr = today.getFullYear();
    const windows = [
      { from: `01/01/${yr}`, to: fmt(today) },
      { from: `01/01/${yr - 1}`, to: `12/31/${yr - 1}` },
    ];
    // Try the UUID via noticeid, AND the solicitation number via solnum (both
    // windows). solnum often returns notices that noticeid exact-match misses.
    const titleProbe = url.searchParams.get('title');
    const probes: { param: string; value: string }[] = [{ param: 'noticeid', value: id }];
    if (sol) probes.push({ param: 'solnum', value: sol });
    if (titleProbe) probes.push({ param: 'title', value: titleProbe });
    const attempts: Record<string, unknown>[] = [];
    for (const probe of probes) {
      for (const w of windows) {
        const u = new URL('https://api.sam.gov/opportunities/v2/search');
        u.searchParams.set('api_key', key);
        u.searchParams.set(probe.param, probe.value);
        u.searchParams.set('postedFrom', w.from);
        u.searchParams.set('postedTo', w.to);
        u.searchParams.set('limit', '1');
        const param = probe.param;
        try {
          const res = await fetch(u.toString(), { headers: { Accept: 'application/json' } });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const body: any = await res.json().catch(() => null);
          const opp = body?.opportunitiesData?.[0];
          attempts.push({
            param, window: `${w.from}-${w.to}`, http: res.status,
            totalRecords: body?.totalRecords,
            error: body?.error || body?.errorMessage || null,
            found: !!opp,
            title: opp?.title,
            resolvedNoticeId: opp?.noticeId,
            candSolicitation: opp?.solicitationNumber,
            candAgency: opp?.fullParentPathName || opp?.department,
            resourceLinks: Array.isArray(opp?.resourceLinks) ? opp.resourceLinks.length : null,
            resourceSample: Array.isArray(opp?.resourceLinks) ? opp.resourceLinks[0] : null,
          });
          if (opp) return NextResponse.json({ success: true, id, matched: { param, ...attempts[attempts.length - 1] }, attempts });
        } catch (e) {
          attempts.push({ param, window: `${w.from}-${w.to}`, threw: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    return NextResponse.json({ success: true, id, matched: null, attempts });
  }

  // ?stats=true → attachment coverage gauge (no candidate scan)
  if (url.searchParams.get('stats') === 'true') {
    try {
      return NextResponse.json({ success: true, coverage: await attachmentCoverage() });
    } catch (e) {
      return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  try {
    const candidates = await loadCandidates({
      email: url.searchParams.get('email'),
      pipelineId: url.searchParams.get('pipeline_id'),
    });
    const nonUuid = candidates.filter((c) => !isUuid(c.notice_id)).length;
    return NextResponse.json({
      success: true,
      mode: 'preview',
      candidates: candidates.length,
      breakdown: {
        solicitation_number_as_id: nonUuid,
        stuck_or_empty_uuid: candidates.length - nonUuid,
      },
      sample: candidates.slice(0, 10).map((c) => ({
        id: c.id, notice_id: c.notice_id, title: c.title, docs_status: c.docs_status,
      })),
      hint: 'POST ?password=...&mode=execute&limit=50 to heal',
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  if (url.searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (url.searchParams.get('mode') !== 'execute') {
    return NextResponse.json({ success: false, error: 'Pass mode=execute to run the heal' }, { status: 400 });
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);

  try {
    const candidates = await loadCandidates({
      email: url.searchParams.get('email'),
      pipelineId: url.searchParams.get('pipeline_id'),
    });
    const batch = candidates.slice(0, limit);

    const results: Array<{
      id: string; title: string | null; before: string | null; status: string; docs: number;
      attempted?: number; downloadNulls?: number; lastInsertError?: string | null;
    }> = [];
    let healed = 0;
    let withDocs = 0;

    for (const row of batch) {
      if (!row.notice_id || !row.user_email) continue;
      try {
        const r = await fetchPursuitDocsAuto({
          pipelineId: row.id,
          userEmail: row.user_email,
          noticeId: row.notice_id,
          source: row.source,
          title: row.title,
          agency: row.agency,
        });
        if (r.status === 'ready') { healed++; withDocs++; }
        else if (r.status === 'none') healed++; // confirmed: genuinely no attachments
        results.push({
          id: row.id, title: row.title, before: row.docs_status, status: r.status, docs: r.succeeded,
          // diagnostics (cold/download path)
          attempted: r.attempted, downloadNulls: r.downloadNulls, lastInsertError: r.lastInsertError,
        } as typeof results[number]);
      } catch (err) {
        results.push({ id: row.id, title: row.title, before: row.docs_status, status: 'error', docs: 0 });
        console.warn(`[heal-pursuit-attachments] ${row.id} threw:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      mode: 'execute',
      totalCandidates: candidates.length,
      processed: batch.length,
      remaining: Math.max(0, candidates.length - batch.length),
      healed,
      withDocs,
      results,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
