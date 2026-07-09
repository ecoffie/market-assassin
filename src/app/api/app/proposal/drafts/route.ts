/**
 * Reload the most-recent drafted proposal so the panel can restore drafts
 * after a reload / navigate-away — fixes "I can't find the draft to export".
 *
 * GET /api/app/proposal/drafts?email=...
 *
 * Every section drafted via /api/app/proposal/draft-all is already persisted
 * (fire-and-forget) into `user_generated_archive` (content_type
 * 'proposal_section' | 'cap_statement', tags ['draft-all'], content =
 * { draft, wordCount, sectionType, label, meta }). But ProposalsPanel held
 * the drafts ONLY in React state, so a reload lost them and the "Export .docx"
 * button — gated on that state — went disabled with no way back.
 *
 * This route reads those archived rows back and returns the MOST-RECENT
 * draft-all batch, grouped by the shared RFP filename (the part of the title
 * after "— "), so a user who has drafted several RFPs gets their latest one
 * (not a mix). Shape matches what the panel needs to rebuild `drafts` +
 * `draftAllSummary` and re-enable export.
 *
 * Auth + Coach-Mode scoping mirror draft-all exactly (the client's drafts
 * belong to the client, not the coach).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';
import type { SectionType } from '@/lib/proposal/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ArchivedDraftRow {
  content_subtype: string | null;
  title: string | null;
  created_at: string | null;
  content: {
    draft?: string;
    wordCount?: number;
    label?: string;
    sectionType?: string;
    meta?: { profileGrounded?: boolean };
  } | null;
}

// The title is "<Section Label> — <fileName>". Group by the fileName so
// sections from ONE draft-all batch stay together. Falls back to the whole
// title when there's no separator.
function fileNameFromTitle(title: string | null): string {
  if (!title) return '';
  const idx = title.indexOf(' — ');
  return idx >= 0 ? title.slice(idx + 3).trim() : title.trim();
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  if (!email) {
    return NextResponse.json({ success: false, error: 'email query param is required' }, { status: 400 });
  }

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  // Coach Mode: read the CLIENT's drafts, not the coach's.
  const { workspaceId, asClient } = await resolveActiveWorkspace(email, request);
  const scopedEmail = asClient ? clientNotificationEmail(workspaceId) : email;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ success: false, error: 'Storage unavailable' }, { status: 500 });
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  try {
    // Pull the recent draft-all sections for this user. Cap generously — the
    // largest RFP has ~10 sections; 60 rows covers several recent RFPs so we
    // can pick the freshest batch.
    const { data, error } = await supabase
      .from('user_generated_archive')
      .select('content_subtype, title, created_at, content')
      .eq('user_email', scopedEmail.toLowerCase())
      .in('content_type', ['proposal_section', 'cap_statement'])
      .contains('tags', ['draft-all'])
      .order('created_at', { ascending: false })
      .limit(60);

    if (error) {
      console.warn('[proposal/drafts] query failed:', error.message);
      return NextResponse.json({ success: true, sections: [], fileName: null, generatedAt: null });
    }

    const rows = (data || []) as ArchivedDraftRow[];
    if (rows.length === 0) {
      return NextResponse.json({ success: true, sections: [], fileName: null, generatedAt: null });
    }

    // The freshest row defines the batch: take its fileName and keep only the
    // sections that share it (one section per type — the newest wins since rows
    // are already newest-first).
    const latestFile = fileNameFromTitle(rows[0].title);
    const seen = new Set<string>();
    const sections: Array<{
      section: SectionType;
      draft: string;
      wordCount: number;
      targetWords: number;
      profileGrounded?: boolean;
    }> = [];

    for (const row of rows) {
      if (fileNameFromTitle(row.title) !== latestFile) continue;
      const c = row.content;
      const sectionType = (c?.sectionType || row.content_subtype || '') as SectionType;
      const draft = c?.draft || '';
      if (!sectionType || !draft || seen.has(sectionType)) continue;
      seen.add(sectionType);
      const wordCount = typeof c?.wordCount === 'number' ? c.wordCount : draft.split(/\s+/).filter(Boolean).length;
      sections.push({
        section: sectionType,
        draft,
        wordCount,
        // targetWords isn't archived; use the actual word count as the target
        // proxy (only affects the cosmetic length hint, never the export).
        targetWords: wordCount,
        profileGrounded: c?.meta?.profileGrounded,
      });
    }

    return NextResponse.json({
      success: true,
      sections,
      fileName: latestFile || null,
      generatedAt: rows[0].created_at || null,
    });
  } catch (err) {
    console.warn('[proposal/drafts] exception:', err);
    // Never break the panel — an empty reload just leaves the user to redraft.
    return NextResponse.json({ success: true, sections: [], fileName: null, generatedAt: null });
  }
}
