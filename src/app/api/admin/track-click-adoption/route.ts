/**
 * /api/admin/track-click-adoption?password=...&days=14
 *
 * Measures the "Track in Mindy" adoption funnel we added to daily alert emails
 * (the fix for the alert→action cliff: 97% get alerts, ~2% act because opp links
 * used to point only at sam.gov). Read-only.
 *
 * A "Track click" is any user_engagement row with event_type='link_click' whose
 * metadata.link_text starts with 'track' — the labels the daily-alert email uses
 * (`track_in_mindy`, `track_btn_<noticeId>`, and the title-link `track_*`).
 *
 * The money metric is CONVERSION: of the users who clicked Track, how many now have
 * a real user_pipeline row (a tracked opportunity). That is the alert→action funnel.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Pure analytics read (no writes) → route to the read replica to keep this
// heavy full-scan off the primary. Falls back to primary if no replica is set.
function sb() {
  return getReadClient();
}

// Page past PostgREST's 1000-row cap so counts are truthful over the window.
async function fetchAll<T>(
  q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const days = Math.min(Math.max(parseInt(searchParams.get('days') || '14', 10) || 14, 1), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const supabase = sb();

  try {
    // 1) All link_click events in the window (metadata filtered in JS — link_text
    //    lives inside a JSONB blob, so a broad pull + local filter is simplest/safe).
    const clicks = await fetchAll<{ user_email: string; metadata: Record<string, unknown> | null; created_at: string }>(
      (from, to) =>
        supabase
          .from('user_engagement')
          .select('user_email, metadata, created_at')
          .eq('event_type', 'link_click')
          .gte('created_at', since)
          .order('created_at', { ascending: true })
          .range(from, to)
    );

    const isTrack = (m: Record<string, unknown> | null) => {
      const label = String((m?.link_text ?? '') as string).toLowerCase();
      return label.startsWith('track');
    };

    const trackClicks = clicks.filter((c) => isTrack(c.metadata));
    const totalLinkClicks = clicks.length;

    // Unique users + per-user click counts.
    const byUser = new Map<string, number>();
    let firstClickAt: string | null = null;
    let lastClickAt: string | null = null;
    for (const c of trackClicks) {
      const e = (c.user_email || '').toLowerCase().trim();
      if (!e) continue;
      byUser.set(e, (byUser.get(e) || 0) + 1);
      if (!firstClickAt) firstClickAt = c.created_at;
      lastClickAt = c.created_at;
    }
    const clickers = [...byUser.keys()];

    // Label breakdown (title link vs the 📌 button) — tells us WHICH affordance works.
    const byLabelType = { titleLink: 0, trackButton: 0, other: 0 };
    for (const c of trackClicks) {
      const label = String((c.metadata?.link_text ?? '') as string).toLowerCase();
      if (label.startsWith('track_btn')) byLabelType.trackButton++;
      else if (label.startsWith('track')) byLabelType.titleLink++;
      else byLabelType.other++;
    }

    // 2) CONVERSION: of the users who clicked Track, how many have a real pipeline row?
    //    (The whole point — did the click actually land an opportunity in their pipeline.)
    let convertedUsers = 0;
    let pipelineRowsFromClickers = 0;
    if (clickers.length) {
      // user_pipeline uses a `stage` enum (no archived_at col); 'archived' is a stage.
      const rows = await fetchAll<{ user_email: string }>((from, to) =>
        supabase
          .from('user_pipeline')
          .select('user_email')
          .in('user_email', clickers)
          .neq('stage', 'archived')
          .range(from, to)
      );
      const have = new Set<string>();
      for (const r of rows) {
        const e = (r.user_email || '').toLowerCase().trim();
        have.add(e);
      }
      pipelineRowsFromClickers = rows.length;
      convertedUsers = clickers.filter((e) => have.has(e)).length;
    }

    // 3) Denominator context: how many distinct users got ANY link_click tracked
    //    (proxy for "engaged with an alert email at all" this window).
    const engagedUsers = new Set(clicks.map((c) => (c.user_email || '').toLowerCase().trim()).filter(Boolean)).size;

    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

    return NextResponse.json({
      success: true,
      window_days: days,
      since,
      track_clicks: {
        total: trackClicks.length,
        unique_users: clickers.length,
        by_affordance: byLabelType,
        first_click_at: firstClickAt,
        last_click_at: lastClickAt,
        share_of_all_link_clicks_pct: pct(trackClicks.length, totalLinkClicks),
      },
      conversion: {
        users_who_clicked_track: clickers.length,
        users_with_real_pipeline_row: convertedUsers,
        conversion_pct: pct(convertedUsers, clickers.length),
        pipeline_rows_held_by_clickers: pipelineRowsFromClickers,
      },
      context: {
        total_link_clicks: totalLinkClicks,
        engaged_users_any_link: engagedUsers,
      },
      note:
        trackClicks.length === 0
          ? 'No Track clicks yet in this window — expected until a few daily-alert sends have gone out with the new Track links. Re-check in 2–3 days.'
          : `Of ${clickers.length} users who clicked "Track in Mindy", ${convertedUsers} (${pct(convertedUsers, clickers.length)}%) have a real pipeline row.`,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
