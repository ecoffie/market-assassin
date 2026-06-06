/**
 * /api/admin/backfill-keywords?password=...
 *
 * Derives search keywords from each user's NAICS codes and writes them to
 * user_notification_settings.keywords — so search WIDENS beyond NAICS (Eric's
 * "drone problem"). Only 1/1000 users had keywords; the keyword-OR-NAICS fix is
 * useless without keywords to widen with.
 *
 * GET  ?mode=preview  → counts only (default, safe)
 * GET  ?mode=execute  → write derived keywords for users that have none
 * Only fills EMPTY keyword lists (never overwrites a user's tuned keywords).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { deriveKeywordsFromNaics } from '@/lib/utils/derive-keywords';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const pw = url.searchParams.get('password');
  if (pw !== (process.env.ADMIN_PASSWORD || 'galata-assassin-2026')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const execute = url.searchParams.get('mode') === 'execute';
  const supabase = sb();

  const { data: users, error } = await supabase
    .from('user_notification_settings')
    .select('user_email, naics_codes, keywords');
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  let candidates = 0, written = 0, skippedHasKw = 0, skippedNoNaics = 0;
  const samples: Array<{ email: string; keywords: string[] }> = [];

  for (const u of (users || []) as Array<{ user_email: string; naics_codes: string[] | null; keywords: string[] | null }>) {
    if (Array.isArray(u.keywords) && u.keywords.length > 0) { skippedHasKw++; continue; }
    const naics = u.naics_codes || [];
    if (naics.length === 0) { skippedNoNaics++; continue; }
    const derived = deriveKeywordsFromNaics(naics);
    if (derived.length === 0) { skippedNoNaics++; continue; }
    candidates++;
    if (samples.length < 8) samples.push({ email: u.user_email, keywords: derived });
    if (execute) {
      const { error: upErr } = await supabase
        .from('user_notification_settings')
        .update({ keywords: derived })
        .eq('user_email', u.user_email);
      if (!upErr) written++;
    }
  }

  return NextResponse.json({
    success: true,
    mode: execute ? 'execute' : 'preview',
    totalUsers: users?.length || 0,
    candidates,
    written,
    skipped: { hasKeywords: skippedHasKw, noNaics: skippedNoNaics },
    samples,
  });
}
