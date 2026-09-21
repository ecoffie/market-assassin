/**
 * Pipeline Saved Views API (Deal Flow Board, Phase 2).
 *
 * Workspace-shared one-click board filters. Built-in views ("Due this week",
 * "Needs owner", etc.) are client-side constants; this route stores the CUSTOM
 * views a teammate creates so the whole workspace can apply them.
 *
 * GET    /api/app/pipeline-views?email=          → views for the caller's workspace
 *                                                   (shared) + the caller's private ones
 * POST   /api/app/pipeline-views  {name, filter, is_shared}  → create
 * DELETE /api/app/pipeline-views?email=&id=      → delete (creator or workspace admin)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import {
  ensureAppWorkspaceSchema,
  getAppSupabase,
  normalizeEmail,
  resolveActiveWorkspace,
} from '@/lib/app/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Missing-table guard: return an empty list (not a 500) so the board still renders
// with built-in views if the migration hasn't been run yet.
function tableMissing(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42P01' || (error.message || '').includes('pipeline_saved_views'));
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  if (!email) return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const schema = await ensureAppWorkspaceSchema();
  if (!schema.ready) return NextResponse.json({ success: false, error: schema.error }, { status: 500 });

  const { workspaceId } = await resolveActiveWorkspace(email, request);
  const supabase = getAppSupabase();

  // Shared views for this workspace OR the caller's own (private) views.
  const { data, error } = await supabase
    .from('pipeline_saved_views')
    .select('*')
    .or(`and(workspace_id.eq.${workspaceId},is_shared.eq.true),created_by.eq.${normalizeEmail(email)}`)
    .order('created_at', { ascending: false });

  if (error) {
    if (tableMissing(error)) return NextResponse.json({ success: true, views: [] });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, views: data || [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').toLowerCase().trim();
  const name = String(body.name || '').trim();
  if (!email || !name) return NextResponse.json({ success: false, error: 'email and name are required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const schema = await ensureAppWorkspaceSchema();
  if (!schema.ready) return NextResponse.json({ success: false, error: schema.error }, { status: 500 });

  const { workspaceId } = await resolveActiveWorkspace(email, request);
  const supabase = getAppSupabase();

  const { data, error } = await supabase
    .from('pipeline_saved_views')
    .insert({
      workspace_id: workspaceId,
      name: name.slice(0, 60),
      filter_json: body.filter && typeof body.filter === 'object' ? body.filter : {},
      created_by: normalizeEmail(email),
      is_shared: body.is_shared !== false, // default shared with the workspace
    })
    .select()
    .single();

  if (error) {
    if (tableMissing(error)) {
      return NextResponse.json({ success: false, error: 'Saved views not available yet — run the pipeline_saved_views migration.' }, { status: 503 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, view: data });
}

export async function DELETE(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  const id = request.nextUrl.searchParams.get('id');
  if (!email || !id) return NextResponse.json({ success: false, error: 'email and id are required' }, { status: 400 });

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const { workspaceId } = await resolveActiveWorkspace(email, request);
  const supabase = getAppSupabase();

  // Delete only if the caller created it, or it belongs to their workspace (admins
  // can prune shared views). Scoped so you can't delete another workspace's view.
  const { error } = await supabase
    .from('pipeline_saved_views')
    .delete()
    .eq('id', id)
    .or(`created_by.eq.${normalizeEmail(email)},workspace_id.eq.${workspaceId}`);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
