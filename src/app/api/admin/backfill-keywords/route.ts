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
export const maxDuration = 300;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Known SEED/DEFAULT NAICS sets. A profile whose codes ARE one of these was never
// set up by the user — it was pre-filled. Deriving keywords from a default would
// seed FAKE signal (healthcare/consulting keywords for someone who never chose
// them). We only backfill profiles where the user picked their OWN codes.
const DEFAULT_SETS: string[][] = [
  // briefings FALLBACK_NAICS (professional services)
  ['541512', '541611', '541330', '541990', '561210'],
  // defaults.ts DEFAULT_NAICS_CODES (healthcare — prompts users to configure)
  ['621111', '621210', '621511', '621610', '622110', '622310', '623110', '623312', '624120'],
];
const DEFAULT_SET_KEYS = new Set(DEFAULT_SETS.map((s) => [...s].sort().join(',')));

/** True if the stored codes are EXACTLY a known default set (i.e. user never set up). */
function isDefaultProfile(codes: string[]): boolean {
  if (!codes.length) return false;
  const key = [...new Set(codes.map(String))].sort().join(',');
  return DEFAULT_SET_KEYS.has(key);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const pw = url.searchParams.get('password');
  if (pw !== (process.env.ADMIN_PASSWORD || 'galata-assassin-2026')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const execute = url.searchParams.get('mode') === 'execute';
  // Optional ?activeOnly=1 — restrict to active users (skip dormant bootcamp imports).
  const activeOnly = url.searchParams.get('activeOnly') === '1';
  const supabase = sb();

  let candidates = 0, written = 0, skippedHasKw = 0, skippedNoNaics = 0, skippedDefault = 0, scanned = 0;
  const samples: Array<{ email: string; keywords: string[] }> = [];

  // Page through ALL users — a bare .select() caps at 1000, which silently skipped
  // ~9K profiles. Range-paginate until a short page.
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, keywords, is_active')
      .range(from, from + PAGE - 1);
    if (activeOnly) q = q.eq('is_active', true);
    const { data: users, error } = await q;
    if (error) return NextResponse.json({ success: false, error: error.message, scanned, written }, { status: 500 });
    if (!users || users.length === 0) break;
    scanned += users.length;

    for (const u of users as Array<{ user_email: string; naics_codes: string[] | null; keywords: string[] | null }>) {
      if (Array.isArray(u.keywords) && u.keywords.length > 0) { skippedHasKw++; continue; }
      const naics = (u.naics_codes || []).map(String);
      if (naics.length === 0) { skippedNoNaics++; continue; }
      // Skip pre-filled DEFAULT profiles — the user never chose these codes, so
      // derived keywords would be fake signal (Eric: don't count pre-filled NAICS).
      if (isDefaultProfile(naics)) { skippedDefault++; continue; }
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

    if (users.length < PAGE) break;
  }

  return NextResponse.json({
    success: true,
    mode: execute ? 'execute' : 'preview',
    activeOnly,
    scanned,
    candidates,
    written,
    skipped: { hasKeywords: skippedHasKw, noNaics: skippedNoNaics, defaultProfile: skippedDefault },
    samples,
  });
}
