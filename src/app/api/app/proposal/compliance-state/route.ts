/**
 * Persisted, team-shared compliance matrix per pursuit.
 *
 * Fixes the "it re-runs and resets every time" + "team check-off saves nowhere"
 * gaps (docs/PROPOSAL-UX-MAP.md). The matrix is stored in pursuit_compliance,
 * one row per requirement, scoped to the pursuit (workspace-shared via
 * user_pipeline.workspace_id), with owner/status that PERSIST and are visible to
 * teammates.
 *
 *   GET    ?email=&pipeline_id=           → load the saved matrix
 *   POST   {pipeline_id, requirements[]}  → save/replace the matrix, PRESERVING
 *                                           owner/status on rows whose req_key is
 *                                           unchanged (re-extraction is non-destructive)
 *   PATCH  {pipeline_id, req_key, owner?, status?} → update one row's check-off
 *
 * Auth: the pursuit must belong to the caller OR their active workspace.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { resolveActiveWorkspace } from '@/lib/app/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _supabase;
}

type Status = 'open' | 'in_progress' | 'done' | 'n_a';
const STATUSES: Status[] = ['open', 'in_progress', 'done', 'n_a'];

async function ownsPursuit(
  row: { user_email?: string | null; workspace_id?: string | null },
  email: string,
  request: NextRequest,
): Promise<boolean> {
  if (row.user_email?.toLowerCase() === email.toLowerCase()) return true;
  if (row.workspace_id) {
    try {
      const { workspaceId } = await resolveActiveWorkspace(email.toLowerCase(), request);
      if (workspaceId && row.workspace_id === workspaceId) return true;
    } catch { /* deny */ }
  }
  return false;
}

/** Load the pursuit row and verify the caller may access it. */
async function authorizePursuit(request: NextRequest, email: string, pipelineId: string) {
  const sb = getSupabase();
  const { data: pursuit, error: pursuitErr } = await sb
    .from('user_pipeline')
    .select('id, user_email, workspace_id')
    .eq('id', pipelineId)
    .maybeSingle();
  if (pursuitErr) console.error('[compliance-state] pursuit query error:', pursuitErr.message);
  if (!pursuit) return { ok: false as const, status: 404, error: 'Pursuit not found' };
  if (!(await ownsPursuit(pursuit, email, request))) return { ok: false as const, status: 403, error: 'Not your pursuit' };
  return { ok: true as const, sb };
}

// ---- GET: load the saved matrix ----
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  const pipelineId = request.nextUrl.searchParams.get('pipeline_id');
  if (!email || !pipelineId) return NextResponse.json({ success: false, error: 'email and pipeline_id are required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const az = await authorizePursuit(request, email, pipelineId);
  if (!az.ok) return NextResponse.json({ success: false, error: az.error }, { status: az.status });

  const { data, error } = await az.sb
    .from('pursuit_compliance')
    .select('req_key, requirement, category, section, source_quote, source_doc, revised, owner, status, updated_at')
    .eq('pipeline_id', pipelineId)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, requirements: data || [], saved: (data?.length || 0) > 0 });
}

interface IncomingReq {
  req_key?: string; id?: string;
  requirement?: string; category?: string; section?: string;
  source_quote?: string; source_doc?: string; revised?: boolean;
}

// ---- POST: save/replace the matrix, preserving existing owner/status ----
export async function POST(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  let body: { pipeline_id?: string; requirements?: IncomingReq[] };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }
  const pipelineId = body.pipeline_id;
  if (!pipelineId) return NextResponse.json({ success: false, error: 'pipeline_id is required' }, { status: 400 });
  const incoming = (body.requirements || []).filter((r) => (r.requirement || '').trim());
  if (incoming.length === 0) return NextResponse.json({ success: false, error: 'No requirements to save' }, { status: 400 });

  const az = await authorizePursuit(request, email, pipelineId);
  if (!az.ok) return NextResponse.json({ success: false, error: az.error }, { status: az.status });
  const sb = az.sb;

  // Preserve the team's owner/status: read existing rows, key by req_key.
  const { data: existing, error: existingErr } = await sb.from('pursuit_compliance').select('req_key, owner, status').eq('pipeline_id', pipelineId);
  if (existingErr) console.error('[compliance-state] existing compliance query error:', existingErr.message);
  const prev = new Map((existing || []).map((r) => [r.req_key, { owner: r.owner, status: r.status }]));

  // Build the new row set. req_key = the requirement's stable id (its extraction
  // id) or a fallback from section+text — so a re-extraction matches the same row.
  const seen = new Set<string>();
  const rows = incoming.map((r) => {
    const reqKey = (r.req_key || r.id || `${r.section || ''}::${(r.requirement || '').slice(0, 80)}`).trim();
    seen.add(reqKey);
    const kept = prev.get(reqKey);
    return {
      pipeline_id: pipelineId,
      user_email: email,
      req_key: reqKey,
      requirement: r.requirement,
      category: r.category || null,
      section: r.section || null,
      source_quote: r.source_quote || null,
      source_doc: r.source_doc || null,
      revised: !!r.revised,
      owner: kept?.owner ?? '',
      status: kept?.status ?? 'open',
      updated_at: new Date().toISOString(),
    };
  });

  // Upsert all (preserves owner/status via the carried-over values), then delete
  // rows that are no longer in the matrix (requirements removed by re-extraction).
  const { error: upErr } = await sb.from('pursuit_compliance').upsert(rows, { onConflict: 'pipeline_id,req_key' });
  if (upErr) return NextResponse.json({ success: false, error: upErr.message }, { status: 500 });

  const stale = [...prev.keys()].filter((k) => !seen.has(k));
  if (stale.length) {
    await sb.from('pursuit_compliance').delete().eq('pipeline_id', pipelineId).in('req_key', stale);
  }

  return NextResponse.json({ success: true, saved: rows.length, removed: stale.length });
}

// ---- PATCH: update one row's owner/status (the team check-off) ----
export async function PATCH(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  let body: { pipeline_id?: string; req_key?: string; owner?: string; status?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }
  const { pipeline_id: pipelineId, req_key: reqKey } = body;
  if (!pipelineId || !reqKey) return NextResponse.json({ success: false, error: 'pipeline_id and req_key are required' }, { status: 400 });

  const az = await authorizePursuit(request, email, pipelineId);
  if (!az.ok) return NextResponse.json({ success: false, error: az.error }, { status: az.status });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.owner === 'string') update.owner = body.owner;
  if (typeof body.status === 'string') {
    if (!STATUSES.includes(body.status as Status)) return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
    update.status = body.status;
  }

  const { error } = await az.sb.from('pursuit_compliance').update(update).eq('pipeline_id', pipelineId).eq('req_key', reqKey);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
