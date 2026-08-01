/**
 * /api/cron/saved-search-alerts — the Opportunity Map "Save search" alert dispatcher.
 *
 * For each ENABLED saved search due today, re-run its saved filter set against fresh
 * active opportunities (via the SHARED applyMapFilters — identical to what the user saw
 * on the map), diff against last_seen_notice_ids, and email the NEW matches. Stamps
 * last_alerted_at + the seen ids so nothing double-sends. Batched + resumable.
 *
 * Registered as a cron_jobs row (dispatcher-fired) — NOT vercel.json.
 * ?mode=preview lists what WOULD send without sending. ?limit=N caps the batch.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { applyMapFilters, parseMapFilters } from '@/lib/opportunities/map-filters';
import { sendEmail } from '@/lib/send-email';
import { buildEmail } from '@/lib/alerts/saved-search-email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const PIN_COLS = 'notice_id, title, department, naics_code, set_aside_code, notice_type, posted_date, response_deadline, ui_link, solicitation_number, pop_state, pop_city';

type SavedSearch = {
  id: string; user_email: string; name: string; mode: string;
  filters: Record<string, unknown>; alert_frequency: string;
  last_seen_notice_ids: string[]; total_alerts_sent: number;
  last_alerted_at: string | null;
};

// Weekly searches fire only on Mondays (UTC); daily every run; paused never.
function isDue(freq: string): boolean {
  if (freq === 'paused') return false;
  if (freq === 'weekly') return new Date().getUTCDay() === 1;
  return true; // daily (default)
}

// buildEmail (the Target-card email) lives in a lib so it's testable + offline-previewable.

export async function GET(request: NextRequest) {
  const preview = request.nextUrl.searchParams.get('mode') === 'preview';
  const limit = Math.min(200, Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') || '50', 10) || 50));
  const db = sb();

  // Enabled searches, least-recently-alerted first (fair drain, resumable).
  const { data: searches, error } = await db
    .from('saved_searches')
    .select('id, user_email, name, mode, filters, alert_frequency, last_seen_notice_ids, total_alerts_sent, last_alerted_at')
    .eq('alerts_enabled', true)
    .order('last_alerted_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) {
    if (error.code === '42P01') return NextResponse.json({ success: true, note: 'saved_searches table not present yet', processed: 0 });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const results = { processed: 0, sent: 0, noMatches: 0, skippedNotDue: 0, failed: 0 };
  const previewRows: Array<{ email: string; name: string; newCount: number }> = [];

  for (const s of (searches || []) as SavedSearch[]) {
    results.processed++;
    if (!isDue(s.alert_frequency)) { results.skippedNotDue++; continue; }

    try {
      // Only the OPEN mode is wired here (recompete alerts are a follow-up — different table).
      if (s.mode !== 'open') continue;

      // Run the SAME filters the user saved. Recent active opps only (posted last 30d as a
      // sane ceiling — new matches are what matter for an alert).
      const f = parseMapFilters((k) => (s.filters as Record<string, string>)[k] ?? null);
      f.postedDays = f.postedDays || 30;
      let q = db.from('sam_opportunities').select(PIN_COLS).limit(200);
      q = applyMapFilters(q, f);
      const { data: opps, error: qErr } = await q.order('posted_date', { ascending: false });
      if (qErr) { results.failed++; continue; }

      const seen = new Set(Array.isArray(s.last_seen_notice_ids) ? s.last_seen_notice_ids : []);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allNoticeIds = (opps || []).map((o: any) => o.notice_id).filter(Boolean);

      // FIRST RUN (never alerted): snapshot the current matches as "seen" WITHOUT emailing —
      // else a brand-new saved search blasts every current match (200) as "new". Only opps
      // that appear AFTER this baseline are alerts. (Same pattern as pursuit-changes.)
      if (!s.last_alerted_at && seen.size === 0) {
        if (!preview) {
          await db.from('saved_searches').update({
            last_alerted_at: new Date().toISOString(),
            last_seen_notice_ids: [...new Set(allNoticeIds)].slice(0, 500),
            updated_at: new Date().toISOString(),
          }).eq('id', s.id);
        }
        results.noMatches++; // counted as "baselined this run, nothing to send"
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fresh = (opps || []).filter((o: any) => o.notice_id && !seen.has(o.notice_id));

      if (fresh.length === 0) { results.noMatches++; continue; }

      if (preview) {
        previewRows.push({ email: s.user_email, name: s.name, newCount: fresh.length });
        continue;
      }

      const { subject, html, text } = buildEmail(s, fresh);
      const ok = await sendEmail({
        to: s.user_email, subject, html, text,
        emailType: 'saved_search_alert', eventSource: 'saved_search',
      });

      // Stamp seen ids (cap the stored list so it can't grow unbounded) + timestamps.
      const cappedSeen = [...new Set([...allNoticeIds, ...seen])].slice(0, 500);
      await db.from('saved_searches').update({
        last_alerted_at: new Date().toISOString(),
        last_seen_notice_ids: cappedSeen,
        total_alerts_sent: (s.total_alerts_sent || 0) + (ok ? 1 : 0),
        updated_at: new Date().toISOString(),
      }).eq('id', s.id);

      if (ok) results.sent++; else results.failed++;
    } catch {
      results.failed++;
    }
  }

  return NextResponse.json({ success: true, ...results, ...(preview ? { preview: previewRows } : {}) });
}
