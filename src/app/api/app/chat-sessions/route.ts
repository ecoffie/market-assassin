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
import { shadowEntitlement } from '@/lib/entitlements/shadow';
import { isViewPreambleTitle, sessionTitleFrom } from '@/lib/chat/view-preamble';
import { ledgerFromTrace } from '@/lib/chat/ledger-persistence';
import { askMindyRecipesEnabledFor } from '@/lib/ask-mindy/flags';

/** Same shape as a stored market report id (src/app/reports/[id]/pdf/route.ts ID_RE). */
const REPORT_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

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
  const chatPro = await hasProAccess(auth.email);
  shadowEntitlement({ route: 'app/chat-sessions GET', capability: 'chat.ask', email: auth.email, identityVerified: true, currentAllow: chatPro });
  if (!chatPro) {
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
    const { data: session, error: sessionErr } = await supabase
      .from('mindy_chat_sessions')
      .select('id, user_email, title')
      .eq('id', sessionId)
      .maybeSingle();
    if (sessionErr) console.error('[chat-sessions] session query error:', sessionErr.message);
    if (!session || session.user_email?.toLowerCase() !== userEmail) {
      return NextResponse.json({ error: 'conversation not found' }, { status: 404 });
    }
    const { data: messages, error } = await supabase
      .from('mindy_chat_messages')
      // truncation-ok: scoped to ONE session_id — a single conversation's messages, not a fleet population.
      .select('id, role, content, cited_sources, created_at, trace')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // Older Map conversations were titled from the Map view preamble; show the customer's first question.
    const firstUser = (messages || []).find((m: { role: string }) => m.role === 'user') as { content?: string } | undefined;
    const title = isViewPreambleTitle(session.title) ? (sessionTitleFrom(firstUser?.content || '') || null) : session.title;
    // Project only deliverable ids (and, under ASK_MINDY_RECIPES, the signed source ledger) from trace — never the
    // rest of the planner/tool trace. Ownership was checked above, so a ledger is only ever returned to its owner.
    const withLedger = askMindyRecipesEnabledFor(auth.email);
    const projected = (messages || []).map((m: {
      id: string; role: string; content: string; cited_sources?: unknown; created_at: string;
      trace?: { deliverables?: { files?: unknown; pdf_note?: string }; market_report?: { report_id?: unknown; title?: unknown } } | null;
    }) => {
      // A packaged market report: its id and title only (the Map re-opens it from the hosted page, so its
      // report card, preview and Export come back with the conversation). Never the url or html.
      const mr = m.trace?.market_report;
      const marketReport = mr && typeof mr.report_id === 'string' && REPORT_ID_RE.test(mr.report_id)
        ? { report_id: mr.report_id, title: typeof mr.title === 'string' ? mr.title.slice(0, 160) : '' }
        : null;
      const raw = m.trace?.deliverables;
      const files = Array.isArray(raw?.files)
        ? raw!.files!.filter((f): f is { format: string; document_id: string; file_name?: string; version?: number } =>
            !!f && typeof f === 'object' && typeof (f as { document_id?: unknown }).document_id === 'string'
            && typeof (f as { format?: unknown }).format === 'string')
        : null;
      const ledger = withLedger && m.role === 'assistant' ? ledgerFromTrace(m.trace) : null;
      const { trace: _omit, ...rest } = m;
      return {
        ...rest,
        ...(ledger ? { sources: ledger } : {}),
        ...(files && files.length
          ? { deliverables: { files, ...(typeof raw?.pdf_note === 'string' ? { pdf_note: raw.pdf_note } : {}) } }
          : {}),
        ...(marketReport ? { market_report: marketReport } : {}),
      };
    });
    return NextResponse.json({
      success: true,
      session: { id: session.id, title },
      messages: projected,
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
  return NextResponse.json({ success: true, sessions: await repairPreambleTitles(supabase, sessions || []) });
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

const TITLE_REPAIR_PAGE = 1000;
const TITLE_REPAIR_MAX_PAGES = 5;

type SessionRow = { id: string; title: string | null; message_count: number; updated_at: string };

/**
 * Conversations started from the Map before 2026-11-17 were titled with the first 60 characters of the
 * stored message, which is the Map view preamble, not the customer's question. Re-title those at read time
 * from the conversation's first user message (stored rows are not rewritten). A failed lookup leaves the
 * title empty ("Untitled") rather than showing the preamble.
 */
async function repairPreambleTitles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sessions: SessionRow[],
): Promise<SessionRow[]> {
  const bad = sessions.filter((s) => isViewPreambleTitle(s.title)).map((s) => s.id);
  if (!bad.length) return sessions;
  const firstQuestion = new Map<string, string>();
  // Paged (PostgREST caps a response at 1,000 rows and long conversations have many user turns); stops as
  // soon as every affected conversation has its first question. Ordered by created_at, id so pages are stable.
  for (let page = 0; page < TITLE_REPAIR_MAX_PAGES && firstQuestion.size < bad.length; page++) {
    const from = page * TITLE_REPAIR_PAGE;
    const { data, error } = await supabase
      .from('mindy_chat_messages')
      .select('session_id, content, created_at')
      .in('session_id', bad) // a fixed set, so offsets stay valid across pages
      .eq('role', 'user')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + TITLE_REPAIR_PAGE - 1);
    if (error) { console.error('[chat-sessions] title repair query error:', error.message); break; }
    const rows = (data || []) as Array<{ session_id: string; content: string }>;
    for (const row of rows) {
      if (firstQuestion.has(row.session_id)) continue;
      const t = sessionTitleFrom(row.content || '');
      if (t) firstQuestion.set(row.session_id, t);
    }
    if (rows.length < TITLE_REPAIR_PAGE) break;
  }
  return sessions.map((s) => (isViewPreambleTitle(s.title) ? { ...s, title: firstQuestion.get(s.id) ?? null } : s));
}
