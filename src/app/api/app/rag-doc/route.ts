/**
 * Read a single document from mindy_rag_documents by id.
 *
 * GET /api/app/rag-doc?email=<>&id=<uuid>
 *
 * Used by the chat panel's "Documents referenced" chips — when Mindy
 * cites a course material or other internal doc, this endpoint serves
 * the full text for an inline drawer so the user can read what
 * informed the answer.
 *
 * Auth: requires a logged-in /app user. The DB row itself isn't
 * user-scoped (RAG corpus is global teaching content), but we still
 * gate on a valid session so anonymous traffic can't enumerate it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyUserOwnsEmail } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const email = (url.searchParams.get('email') || '').toLowerCase().trim();
  const id = (url.searchParams.get('id') || '').trim();

  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: 'id must be a uuid' }, { status: 400 });

  const auth = await verifyUserOwnsEmail(request, email);
  if (!auth.authenticated || !auth.email) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('mindy_rag_documents')
    .select('id, title, doc_type, top_level_folder, source_path, full_text, word_count, one_line_summary')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'lookup failed', detail: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Strip the local filesystem path from source_path before returning —
  // those leak our directory layout and aren't useful client-side.
  const safeSource = data.source_path?.startsWith('/') ? null : data.source_path;

  // Derive a PLAYABLE url so YT Live / podcast / webinar docs aren't a dead end
  // (Eric: "YT Live takes you to the KB but nothing to watch"). Sources:
  //   - "libsyn:host/slug"  → https://host/slug  (the episode page)
  //   - any http(s) source  → use as-is
  //   - a YouTube link in the body → use that
  let playUrl: string | null = null;
  let playLabel: string | null = null;
  if (safeSource?.startsWith('libsyn:')) {
    playUrl = `https://${safeSource.slice('libsyn:'.length)}`;
    playLabel = '▶ Listen to this episode';
  } else if (safeSource?.startsWith('http')) {
    playUrl = safeSource;
    playLabel = /youtu/i.test(safeSource) ? '▶ Watch on YouTube' : '▶ Open source';
  } else {
    const yt = (data.full_text || '').match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/i);
    if (yt) { playUrl = yt[0]; playLabel = '▶ Watch on YouTube'; }
  }

  return NextResponse.json({
    id: data.id,
    title: data.title,
    doc_type: data.doc_type,
    folder: data.top_level_folder,
    source_path: safeSource,
    play_url: playUrl,
    play_label: playLabel,
    full_text: data.full_text,
    word_count: data.word_count,
  });
}
