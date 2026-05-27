/**
 * Auto-library persistence helper.
 *
 * Fire-and-forget INSERT into user_generated_archive after every AI
 * output Mindy ships. Failures are logged but never thrown — losing
 * a single archive write should not block the user's actual draft.
 *
 * Content Reaper pattern #4 — silent persistence so users build a
 * library of every output without ever clicking "save". They recall
 * via /app/library months later.
 *
 * Usage:
 *   import { archiveContent } from '@/lib/archive/persist';
 *   archiveContent({
 *     userEmail: 'eric@govcongiants.com',
 *     contentType: 'proposal_section',
 *     contentSubtype: 'past_performance',
 *     title: 'Past Performance — Navy Cyber RFP',
 *     content: { draft, meta, sectionType },
 *     contentText: draft,
 *     agency: 'Department of the Navy',
 *     naicsCode: '541512',
 *     pursuitId: opt,
 *     sourceNoticeId: opt,
 *   }).catch(() => {});
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: SupabaseClient<any> | null = null;
function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabase = createClient(url, key, { auth: { persistSession: false } });
  return _supabase;
}

export type ArchiveContentType =
  | 'briefing'
  | 'proposal_section'
  | 'cap_statement'
  | 'vault_ai_coach';

export interface ArchiveInput {
  userEmail: string;
  contentType: ArchiveContentType;
  /** e.g. 'daily' / 'weekly' / 'pursuit' for briefings; the section
   *  type for proposals. Free-form. */
  contentSubtype?: string;
  /** Display title for list view (e.g. "Past Performance — Navy IT RFP") */
  title: string;
  /** Full content payload (typically the AI response object) */
  content: Record<string, unknown>;
  /** Plain-text excerpt for full-text search + previews */
  contentText?: string;
  agency?: string;
  naicsCode?: string;
  pursuitId?: string;
  sourceNoticeId?: string;
  aiProvider?: string;
  aiModel?: string;
  tags?: string[];
}

/**
 * Persist an archive entry. Returns the inserted row's ID on success,
 * null on failure. Never throws.
 */
export async function archiveContent(input: ArchiveInput): Promise<string | null> {
  if (!input.userEmail || !input.title) return null;
  const supabase = getSupabase();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('user_generated_archive')
      .insert({
        user_email: input.userEmail.toLowerCase(),
        content_type: input.contentType,
        content_subtype: input.contentSubtype || null,
        title: input.title.slice(0, 500),
        agency: input.agency || null,
        naics_code: input.naicsCode || null,
        content: input.content,
        content_text: (input.contentText || '').slice(0, 50_000),  // cap to avoid bloat
        pursuit_id: input.pursuitId || null,
        source_notice_id: input.sourceNoticeId || null,
        ai_provider: input.aiProvider || null,
        ai_model: input.aiModel || null,
        tags: input.tags || [],
      })
      .select('id')
      .maybeSingle();

    if (error) {
      console.warn(`[archive] persist failed (non-fatal):`, error.message);
      return null;
    }
    return (data as { id: string } | null)?.id || null;
  } catch (err) {
    console.warn('[archive] persist threw (non-fatal):', err);
    return null;
  }
}
