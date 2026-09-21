import { createClient } from '@supabase/supabase-js';

/**
 * Access-grant audit trail.
 *
 * WHY THIS EXISTS — 2026-07-30: staff reported that "many new people have not been getting
 * access" and were granting it manually. That report was IMPOSSIBLE to verify or refute,
 * because `/api/admin/grant-briefings` and its 10 siblings called `kv.set()` and recorded
 * nothing else. A hand-granted account and an automatically-provisioned one were
 * byte-identical afterwards, so there was no way to count failures, identify which buyers
 * were rescued, or prove a fix worked.
 *
 * Audit every grant at the moment it happens. `source` is the field that matters:
 * `admin_manual` rows ARE the failure count for automatic provisioning.
 *
 * NEVER let auditing break a grant. A customer receiving access outranks the bookkeeping,
 * so every failure here is caught and logged — this function does not throw.
 */

export type GrantSource =
  | 'stripe_webhook'   // automatic, on payment — the path that should work
  | 'admin_manual'     // a human fixed it by hand ← the signal we were blind to
  | 'admin_bulk'       // sweep / backfill endpoint
  | 'trial'
  | 'comp';

export interface GrantAuditEntry {
  email: string;
  capability: string;              // 'briefings' | 'ma' | 'ospro' | 'team' | …
  source: GrantSource;
  action?: 'grant' | 'revoke';
  tier?: string | null;
  actor?: string | null;
  reason?: string | null;
  wroteKv?: boolean;
  wroteProfile?: boolean;
  stripeSessionId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function recordAccessGrant(entry: GrantAuditEntry): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;

    const email = (entry.email || '').toLowerCase().trim();
    if (!email) return;

    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { error } = await sb.from('access_grants').insert({
      email,
      capability: entry.capability,
      action: entry.action || 'grant',
      tier: entry.tier ?? null,
      source: entry.source,
      actor: entry.actor ?? null,
      reason: entry.reason ?? null,
      wrote_kv: entry.wroteKv ?? false,
      wrote_profile: entry.wroteProfile ?? false,
      stripe_session_id: entry.stripeSessionId ?? null,
      metadata: entry.metadata ?? null,
    });

    if (error) {
      // Loud, but non-fatal. A silent console.error is exactly how the purchase-ledger
      // schema drift hid for three months (see PR #642).
      console.error(
        `[grant-audit] 🚨 failed to record ${entry.action || 'grant'} of ${entry.capability} `
        + `for ${email} (source=${entry.source}): ${error.message}. The grant itself still applied.`,
      );
    }
  } catch (err) {
    console.error('[grant-audit] unexpected failure (non-fatal):', err);
  }
}
