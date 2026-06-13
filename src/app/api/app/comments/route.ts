/**
 * Pipeline Comments API
 *
 * GET /api/app/comments?pipeline_id=xxx&email=xxx - List comments for a pursuit
 * POST /api/app/comments - Add a comment
 * DELETE /api/app/comments - Delete a comment
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import {
  ensureAppWorkspaceSchema,
  ensureWorkspaceMember,
  getAppSupabase,
  normalizeEmail,
  recordAppActivity,
  resolveActiveWorkspace,
} from '@/lib/app/workspace';

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.toLowerCase().trim();
  const pipelineId = request.nextUrl.searchParams.get('pipeline_id');

  if (!email || !pipelineId) {
    return NextResponse.json({ success: false, error: 'email and pipeline_id are required' }, { status: 400 });
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const schema = await ensureAppWorkspaceSchema();
  if (!schema.ready) {
    return NextResponse.json({ success: false, error: schema.error }, { status: 500 });
  }

  const { workspaceId } = await resolveActiveWorkspace(email, request);
  const supabase = getAppSupabase();

  // Verify the user has access to this pipeline item (same workspace)
  const { data: pipelineItem } = await supabase
    .from('user_pipeline')
    .select('id, workspace_id, user_email')
    .eq('id', pipelineId)
    .maybeSingle();

  if (!pipelineItem) {
    return NextResponse.json({ success: false, error: 'Pursuit not found' }, { status: 404 });
  }

  // Check access: same workspace OR same user
  const hasAccess = pipelineItem.workspace_id === workspaceId ||
                    pipelineItem.user_email === normalizeEmail(email);

  if (!hasAccess) {
    return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
  }

  // Get comments
  const { data: comments, error } = await supabase
    .from('mi_beta_comments')
    .select('*')
    .eq('pipeline_id', pipelineId)
    .order('created_at', { ascending: true });

  if (error) {
    // Table might not exist
    if (error.code === '42P01') {
      return NextResponse.json({ success: true, comments: [] });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, comments: comments || [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const email = normalizeEmail(String(body.email || ''));
  const pipelineId = String(body.pipeline_id || '');
  const content = String(body.content || '').trim();

  if (!email || !pipelineId || !content) {
    return NextResponse.json(
      { success: false, error: 'email, pipeline_id, and content are required' },
      { status: 400 }
    );
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const schema = await ensureAppWorkspaceSchema();
  if (!schema.ready) {
    return NextResponse.json({ success: false, error: schema.error }, { status: 500 });
  }

  const { workspaceId } = await resolveActiveWorkspace(email, request);
  const supabase = getAppSupabase();

  // Verify access to pipeline item
  const { data: pipelineItem } = await supabase
    .from('user_pipeline')
    .select('id, title, workspace_id, user_email')
    .eq('id', pipelineId)
    .maybeSingle();

  if (!pipelineItem) {
    return NextResponse.json({ success: false, error: 'Pursuit not found' }, { status: 404 });
  }

  const hasAccess = pipelineItem.workspace_id === workspaceId ||
                    pipelineItem.user_email === email;

  if (!hasAccess) {
    return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
  }

  // Insert comment
  const { data: comment, error } = await supabase
    .from('mi_beta_comments')
    .insert({
      workspace_id: pipelineItem.workspace_id || workspaceId,
      pipeline_id: pipelineId,
      user_email: email,
      content,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Record activity
  await recordAppActivity({
    workspaceId: pipelineItem.workspace_id || workspaceId,
    userEmail: email,
    actorEmail: email,
    entityType: 'comment',
    entityId: comment.id,
    action: 'created',
    summary: `Commented on "${pipelineItem.title}"`,
    metadata: { pipeline_id: pipelineId, preview: content.slice(0, 100) },
  });

  return NextResponse.json({ success: true, comment });
}

export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const email = normalizeEmail(String(body.email || ''));
  const commentId = String(body.comment_id || '');

  if (!email || !commentId) {
    return NextResponse.json(
      { success: false, error: 'email and comment_id are required' },
      { status: 400 }
    );
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  const schema = await ensureAppWorkspaceSchema();
  if (!schema.ready) {
    return NextResponse.json({ success: false, error: schema.error }, { status: 500 });
  }

  const supabase = getAppSupabase();

  // Get comment to verify ownership
  const { data: comment } = await supabase
    .from('mi_beta_comments')
    .select('id, user_email, workspace_id, pipeline_id, content')
    .eq('id', commentId)
    .maybeSingle();

  if (!comment) {
    return NextResponse.json({ success: false, error: 'Comment not found' }, { status: 404 });
  }

  // Only comment author can delete
  if (comment.user_email !== email) {
    return NextResponse.json({ success: false, error: 'You can only delete your own comments' }, { status: 403 });
  }

  const { data: pipelineItem } = await supabase
    .from('user_pipeline')
    .select('id, title')
    .eq('id', comment.pipeline_id)
    .maybeSingle();

  const { error } = await supabase
    .from('mi_beta_comments')
    .delete()
    .eq('id', commentId);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  await recordAppActivity({
    workspaceId: comment.workspace_id,
    userEmail: email,
    actorEmail: email,
    entityType: 'comment',
    entityId: commentId,
    action: 'deleted',
    summary: `Deleted a comment${pipelineItem?.title ? ` on "${pipelineItem.title}"` : ''}`,
    metadata: { pipeline_id: comment.pipeline_id, preview: String(comment.content || '').slice(0, 100) },
  });

  return NextResponse.json({ success: true, deleted: true });
}
