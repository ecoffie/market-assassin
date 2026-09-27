import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { resolveActiveWorkspace, clientNotificationEmail } from '@/lib/app/workspace';
import { normalizeKeywordInput, KEYWORD_MAX_COUNT, keywordAddLimitError, keywordUnusableError } from '@/lib/keywords/sanitize';

/**
 * POST /api/app/keywords/add  { email, keywords: string[] }
 *
 * ADDITIVE merge of keywords into user_notification_settings.keywords — never
 * clobbers the existing (tuned) array. Used when a user researches by keyword in
 * Market Research Sport mode: their own words are the strongest search signal, so
 * we capture them into the profile instead of throwing them away after one report.
 *
 * Lowercases + dedupes. A merge that would exceed KEYWORD_MAX_COUNT is REJECTED
 * (nothing written) instead of silently dropping the newest keywords.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : '';
    const incoming = Array.isArray(body?.keywords) ? body.keywords : [];
    if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

    // MI session auth (x-mi-auth-token) — matches /api/app/* and what the client
    // sends. (Was verifyUserSession/Bearer, which the Sport-mode caller never sent.)
    const authSession = requireMIAuthSession(request, email);
    if (!authSession.ok) return authSession.response;

    // Coach Mode: merge keywords into the CLIENT's row when managing a client.
    const { workspaceId, asClient } = await resolveActiveWorkspace(email, request);
    const rowEmail = asClient ? clientNotificationEmail(workspaceId) : email;

    // The shared normalizer — the SAME rules as Settings and onboarding. An unusable
    // entry (over-long blob, bare NAICS code) rejects the add with nothing written;
    // it used to be dropped with only a server log.
    const { keywords: clean, unusable } = normalizeKeywordInput(incoming);
    if (unusable.length > 0) {
      return NextResponse.json({ error: keywordUnusableError(unusable), code: 'keyword_unusable' }, { status: 400 });
    }
    if (clean.length === 0) {
      return NextResponse.json({ success: true, added: 0, note: 'no keywords supplied' });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: cur, error: curErr } = await supabase
      .from('user_notification_settings')
      .select('keywords')
      .eq('user_email', rowEmail)
      .maybeSingle();
    if (curErr) {
      return NextResponse.json({ error: curErr.message }, { status: 500 });
    }

    // The saved list is kept EXACTLY as stored — never re-normalized, trimmed or
    // re-cased on read (that would silently change or delete keywords the user already
    // saved). New keywords are de-duplicated against it case-insensitively.
    const existing: string[] = Array.isArray(cur?.keywords)
      ? (cur!.keywords as unknown[]).map((k) => String(k)).filter((k) => k.trim().length > 0)
      : [];
    const have = new Set(existing.map((k) => k.trim().toLowerCase()));
    const fresh = clean.filter((k) => !have.has(k.toLowerCase()));
    const merged = [...existing, ...fresh];
    if (fresh.length > 0 && merged.length > KEYWORD_MAX_COUNT) {
      return NextResponse.json(
        {
          error: keywordAddLimitError(existing.length, fresh.length),
          code: 'keyword_limit',
          saved: existing.length,
          adding: fresh.length,
          max: KEYWORD_MAX_COUNT,
        },
        { status: 400 },
      );
    }
    const added = merged.length - existing.length;
    if (added <= 0) {
      return NextResponse.json({ success: true, added: 0, total: merged.length });
    }

    const { error } = await supabase
      .from('user_notification_settings')
      .upsert(
        { user_email: rowEmail, keywords: merged, updated_at: new Date().toISOString() },
        { onConflict: 'user_email' },
      );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, added, total: merged.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
