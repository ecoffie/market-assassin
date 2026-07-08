/**
 * Admin: Mindy Insight engagement — does the daily insight card earn its place,
 * or is it noise? (Eric, Jul 7.) The card now emits impressions + interactions via
 * the engagement pipeline (event_source = 'mindy_insight'); this rolls them up so
 * the launch dashboard can show a single verdict tile.
 *
 * The number that matters is the INTERACTION RATE — impressions are free (the card
 * just renders), so a high-impression / near-zero-interaction card is decoration.
 * refresh / copy / dismiss are the real signal that someone engaged.
 *
 * GET ?password=...&days=14
 */

import { NextRequest, NextResponse } from 'next/server';
import { getReadClient } from '@/lib/supabase/server-clients';
import { isExcludedFromMetrics } from '@/lib/mindy/campaign-exclusions';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

type Row = {
  user_email: string | null;
  event_type: string | null;
  metadata: Record<string, unknown> | null;
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('password') !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const days = Math.max(1, Math.min(90, parseInt(searchParams.get('days') || '14', 10) || 14));
  const startDateStr = new Date(Date.now() - days * 86_400_000).toISOString();

  const supabase = getReadClient();

  try {
    const { data, error } = await supabase
      .from('user_engagement')
      .select('user_email, event_type, metadata')
      .eq('event_source', 'mindy_insight')
      .gte('created_at', startDateStr)
      .limit(50_000);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const rows = (data || []) as Row[];
    // Exclude staff/comp/advocate accounts from the metric (same rule as every
    // other engagement number) so the verdict reflects real users.
    const real = rows.filter((r) => !isExcludedFromMetrics(r.user_email || ''));

    const action = (r: Row) => String(r.metadata?.action || '');
    const variantOf = (r: Row) => String(r.metadata?.insight_source || 'unknown');

    const impressions = real.filter((r) => action(r) === 'impression');
    const interactions = real.filter((r) => ['refresh', 'copy', 'dismiss'].includes(action(r)));

    const uniqueViewers = new Set(impressions.map((r) => (r.user_email || '').toLowerCase())).size;
    const uniqueInteractors = new Set(interactions.map((r) => (r.user_email || '').toLowerCase())).size;

    const byAction = { refresh: 0, copy: 0, dismiss: 0 } as Record<string, number>;
    for (const r of interactions) { const a = action(r); if (a in byAction) byAction[a] += 1; }

    // Per-variant: impressions + interactions, so we can see WHICH insight type
    // (guest lesson / market pulse / your-data) actually lands — the fallback is
    // already suppressed client-side, so it shouldn't appear here.
    const variants: Record<string, { impressions: number; interactions: number }> = {};
    for (const r of impressions) { const v = variantOf(r); (variants[v] ||= { impressions: 0, interactions: 0 }).impressions += 1; }
    for (const r of interactions) { const v = variantOf(r); (variants[v] ||= { impressions: 0, interactions: 0 }).interactions += 1; }

    const byVariant = Object.entries(variants)
      .map(([variant, v]) => ({
        variant,
        impressions: v.impressions,
        interactions: v.interactions,
        interaction_rate_pct: v.impressions > 0 ? Math.round((v.interactions / v.impressions) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.impressions - a.impressions);

    const totalImpressions = impressions.length;
    const totalInteractions = interactions.length;
    const interactionRatePct = totalImpressions > 0
      ? Math.round((totalInteractions / totalImpressions) * 1000) / 10
      : 0;

    // Human verdict for the tile: is anyone engaging?
    let verdict: string;
    if (totalImpressions < 30) {
      verdict = 'Not enough data yet — let it run a few more days.';
    } else if (interactionRatePct >= 5 || uniqueInteractors >= 10) {
      verdict = 'Users engage with it — the card earns its place.';
    } else if (byAction.dismiss > (byAction.refresh + byAction.copy)) {
      verdict = 'Mostly dismissed, rarely used — lean toward removing it.';
    } else {
      verdict = 'Seen but rarely acted on — likely decoration; consider removing.';
    }

    return NextResponse.json({
      success: true,
      window_days: days,
      impressions: { total: totalImpressions, unique_viewers: uniqueViewers },
      interactions: {
        total: totalInteractions,
        unique_users: uniqueInteractors,
        by_action: byAction,
        interaction_rate_pct: interactionRatePct,
      },
      by_variant: byVariant,
      verdict,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
