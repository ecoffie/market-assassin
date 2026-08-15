/**
 * Catch entitlements that will lapse BEFORE they cut someone off.
 *
 * The 2026-08-14 alert fired after the damage: accounts had already been silent
 * for weeks. An expiry is knowable in advance, so there is no excuse for
 * learning about it from a customer.
 *
 * Two conditions, both measured on live data 2026-08-15:
 *   • LAPSING — entitled, actively receiving, and a stamped date will end it.
 *     3 rows today (2026-12-31, 2027-01-16, 2027-07-18). No renewal path
 *     exists, so each is a future silent cutoff already scheduled.
 *   • SPURIOUS — an expiry stamped on a tier where the concept does not apply
 *     (a grant, a lifetime, a subscription). Harmless until the date passes,
 *     then it silently revokes access nobody meant to time-box. This is exactly
 *     how the beta_preview cohort died on 2026-06-28.
 *
 * See entitlement-semantics.ts for what the tiers mean.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { rowHealth, ENTITLING_TIERS } from './entitlement-semantics';

export interface ExpiryFinding {
  email: string;
  briefingsAccess: string;
  expiry: string;
  /** Days until it fires. Negative means it already did. */
  daysOut: number;
  /** Received a briefing in the last 30 days — losing it would be felt. */
  active: boolean;
  kind: 'lapsing' | 'spurious';
}

export interface ExpiryWatchResult {
  findings: ExpiryFinding[];
  checked: number;
  error?: string;
}

/** Look this far ahead. Wide enough that a renewal decision is not rushed. */
export const LAPSE_HORIZON_DAYS = 90;

export async function findExpiringEntitlements(
  supabase: SupabaseClient,
  now: number = Date.now(),
): Promise<ExpiryWatchResult> {
  const rows: Array<{ email: string; briefings_access: string | null; briefings_expiry: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('customer_classifications')
      .select('email, briefings_access, briefings_expiry')
      .not('briefings_expiry', 'is', null)
      .range(from, from + 999);
    // Surface { error }, never just { data }: a failed read here would report
    // "no expiries pending" and hide exactly what this exists to catch.
    if (error) return { findings: [], checked: 0, error: error.message };
    if (!data?.length) break;
    rows.push(...(data as typeof rows));
    if (data.length < 1000) break;
  }

  // Who actually receives? A lapse only matters if it takes something away.
  const active = new Set<string>();
  const cutoff = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('briefing_log')
      .select('user_email, briefing_date')
      .gte('briefing_date', cutoff)
      .range(from, from + 999);
    if (error) return { findings: [], checked: rows.length, error: error.message };
    if (!data?.length) break;
    for (const r of data as Array<{ user_email: string }>) {
      const e = String(r.user_email || '').toLowerCase().trim();
      if (e) active.add(e);
    }
    if (data.length < 1000) break;
  }

  const findings: ExpiryFinding[] = [];
  for (const row of rows) {
    const email = String(row.email || '').toLowerCase().trim();
    if (!email) continue;
    const health = rowHealth(row, now);
    const entitling = ENTITLING_TIERS.has((row.briefings_access || '').trim());
    const daysOut = Math.round((new Date(row.briefings_expiry!).getTime() - now) / 86400000);

    if (health.lapsesOn && entitling && daysOut <= LAPSE_HORIZON_DAYS) {
      findings.push({ email, briefingsAccess: row.briefings_access!, expiry: health.lapsesOn, daysOut, active: active.has(email), kind: 'lapsing' });
      continue;
    }
    // Report a spurious expiry only while it can still do harm.
    if (health.spuriousExpiry && !health.expired && entitling) {
      findings.push({ email, briefingsAccess: row.briefings_access!, expiry: String(row.briefings_expiry).slice(0, 10), daysOut, active: active.has(email), kind: 'spurious' });
    }
  }

  // Soonest first, active users ahead of idle ones at the same date.
  findings.sort((a, b) => a.daysOut - b.daysOut || Number(b.active) - Number(a.active));
  return { findings, checked: rows.length };
}

export function formatExpiryFindings(findings: ExpiryFinding[]): string {
  return findings
    .map((f) =>
      `${f.email} — ${f.briefingsAccess} ${f.kind === 'spurious' ? 'has an expiry it should not have' : 'lapses'} ` +
      `${f.expiry} (${f.daysOut}d)${f.active ? ' · ACTIVELY RECEIVING' : ' · idle'}`,
    )
    .join('\n');
}
