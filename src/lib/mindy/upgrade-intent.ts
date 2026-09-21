/**
 * Upgrade intent signals from user_engagement (sidebar upgrade modal).
 *
 * Hot  = clicked "Go Pro" CTA (upgrade_modal_cta_click)
 * Warm = opened modal only (upgrade_modal_shown)
 */

import { isExcludedFromMetrics } from '@/lib/mindy/campaign-exclusions';

export const UPGRADE_INTENT_DEFINITION = {
  hot: 'Clicked Go Pro in the upgrade modal — highest in-app purchase intent. Call within 24h.',
  warm: 'Opened upgrade modal but did not click Go Pro — follow up with feature-specific pitch.',
  source: 'user_engagement · event_type=link_click · event_source=sidebar',
};

const DEFAULT_NAICS = new Set(['541512', '541611', '541330', '541990', '561210']);

export function hasCustomNaics(naicsCodes: string[] | null | undefined): boolean {
  if (!naicsCodes || naicsCodes.length === 0) return false;
  return naicsCodes.some((code) => !DEFAULT_NAICS.has(code));
}

export interface UpgradeEngagementRow {
  user_email: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export interface UpgradeIntentAccumulator {
  email: string;
  modalOpens: number;
  ctaClicks: number;
  lastModalAt: string | null;
  lastCtaAt: string | null;
  features: Record<string, number>;
  plans: Record<string, number>;
}

export function accumulateUpgradeIntent(rows: UpgradeEngagementRow[]): UpgradeIntentAccumulator[] {
  const byEmail = new Map<string, UpgradeIntentAccumulator>();

  for (const row of rows) {
    const email = row.user_email?.toLowerCase()?.trim();
    if (!email || isExcludedFromMetrics(email)) continue;

    const action = String(row.metadata?.action || '');
    if (action !== 'upgrade_modal_shown' && action !== 'upgrade_modal_cta_click') continue;

    const entry = byEmail.get(email) || {
      email,
      modalOpens: 0,
      ctaClicks: 0,
      lastModalAt: null,
      lastCtaAt: null,
      features: {},
      plans: {},
    };

    const feature = String(row.metadata?.feature || 'unknown');
    entry.features[feature] = (entry.features[feature] || 0) + 1;

    if (action === 'upgrade_modal_shown') {
      entry.modalOpens++;
      if (!entry.lastModalAt || row.created_at > entry.lastModalAt) {
        entry.lastModalAt = row.created_at;
      }
    } else {
      entry.ctaClicks++;
      const plan = String(row.metadata?.plan || 'monthly');
      entry.plans[plan] = (entry.plans[plan] || 0) + 1;
      if (!entry.lastCtaAt || row.created_at > entry.lastCtaAt) {
        entry.lastCtaAt = row.created_at;
      }
    }

    byEmail.set(email, entry);
  }

  return [...byEmail.values()];
}

export function topFeature(features: Record<string, number>): string {
  const sorted = Object.entries(features).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || 'unknown';
}

export function intentLevel(row: UpgradeIntentAccumulator): 'hot' | 'warm' {
  return row.ctaClicks > 0 ? 'hot' : 'warm';
}

export function recommendedUpgradeAction(
  level: 'hot' | 'warm',
  topFeat: string,
  isProSubscriber: boolean,
): string {
  if (isProSubscriber) return 'Already Pro — thank & ask for referral or case study';
  if (level === 'hot') {
    return `Call now — clicked Go Pro after trying to unlock ${topFeat}`;
  }
  return `Warm follow-up — interested in ${topFeat}, saw modal but didn't checkout`;
}

export async function fetchUpgradeEngagementRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sinceIso: string,
): Promise<UpgradeEngagementRow[]> {
  const rows: UpgradeEngagementRow[] = [];
  for (let from = 0; from < 60000; from += 1000) {
    const { data, error } = await supabase
      .from('user_engagement')
      .select('user_email, metadata, created_at')
      .eq('event_type', 'link_click')
      .eq('event_source', 'sidebar')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data || []) as UpgradeEngagementRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}
