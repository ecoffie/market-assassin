/**
 * /api/app/chat-sessions — Mindy Chat conversation history.
 *
 * GET ?email=                  → list the user's conversations (newest first)
 * GET ?email=&sessionId=<uuid> → load one conversation's full messages
 * DELETE { email, sessionId }  → delete a conversation
 *
 * The chat exchange itself is persisted by /api/app/chat (persistExchange),
 * which auto-creates a mindy_chat_sessions row + appends messages. This
 * endpoint just reads/manages that history for the sidebar.
 *
 * Auth: MI session via verifyUserOwnsEmail (same as the chat + rag-doc).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';
import { hasProAccess } from '@/lib/access/resolve-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

export async function GET(request: NextRequest) {
  const email = (request.nextUrl.searchParams.get('email') || '').trim();
  const sessionId = (request.nextUrl.searchParams.get('sessionId') || '').trim();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  // Pro gate — Mindy Chat is paid; this lists/loads chat sessions.
  if (!(await hasProAccess(auth.email))) {
    return NextResponse.json({ error: 'pro_required', upgrade: true }, { status: 403 });
  }
  const userEmail = auth.email.toLowerCase();
  const supabase = getSupabase();

  // Load one conversation's messages.
  if (sessionId) {
    if (!UUID_RE.test(sessionId)) {
      return NextResponse.json({ error: 'sessionId must be a uuid' }, { status: 400 });
    }
    // Ownership check.
    const { data: session } = await supabase
      .from('mindy_chat_sessions')
      .select('id, user_email, title')
      .eq('id', sessionId)
      .maybeSingle();
    if (!session || session.user_email?.toLowerCase() !== userEmail) {
      return NextResponse.json({ error: 'conversation not found' }, { status: 404 });
    }
    const { data: messages, error } = await supabase
      .from('mindy_chat_messages')
      .select('id, role, content, cited_sources, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      success: true,
      session: { id: session.id, title: session.title },
      messages: messages || [],
    });
  }

  // List the user's conversations.
  const { data: sessions, error } = await supabase
    .from('mindy_chat_sessions')
    .select('id, title, message_count, updated_at')
    .eq('user_email', userEmail)
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, sessions: sessions || [] });
}

export async function DELETE(request: NextRequest) {
  let body: { email?: string; sessionId?: string } = {};
  try { body = await request.json(); } catch { /* empty */ }
  const email = (body.email || '').trim();
  const sessionId = (body.sessionId || '').trim();
  if (!email || !sessionId) {
    return NextResponse.json({ error: 'email and sessionId required' }, { status: 400 });
  }

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const supabase = getSupabase();

  // Delete only if owned. Messages cascade (ON DELETE CASCADE).
  const { error } = await supabase
    .from('mindy_chat_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_email', auth.email.toLowerCase());
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
