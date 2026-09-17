/**
 * The THIRD briefing gate: customer_classifications.briefings_access.
 *
 * Grant paths used to write access_briefings (profile) and sometimes
 * briefings_enabled (settings) and never this table — so the sender, which
 * builds its audience from classifications, could not see a fully paid,
 * fully flagged customer. Insert-only on signup (ensureCustomerClassification)
 * also left existing `none` / missing rows untouched when access was granted
 * later.
 *
 * Rules, each a scar:
 *   • Never overwrite `excluded` — that is a deliberate comp/testimonial cutoff.
 *   • Never downgrade a stronger entitling tier (lifetime must not become
 *     beta_preview because a later grant path passed a weaker default).
 *   • An expired entitling row is not "already entitled" — it may be upgraded.
 *   • INSERT-or-upgrade only. Classification provenance (ultimate_giant, etc.)
 *     is left alone on update.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ENTITLING_TIERS } from './entitlement-semantics';
import { isBriefingEntitled } from './delivery/rollout';

export type EntitlingAccess = 'beta_preview' | 'subscription' | '6_month' | '1_year' | 'lifetime';

export type DriftKind =
  | 'classification_mismatch'
  | 'delivery_disabled'
  | 'intentionally_paused'
  | 'intentionally_excluded';

/**
 * Which watchdog bucket does this entitled account belong in?
 * `null` = healthy (or untargeted — a briefing would be generic).
 */
export function classifyEntitlementDrift(input: {
  isActive: boolean | null;
  briefingsEnabled: boolean | null;
  entitlementOk: boolean;
  briefingsAccess: string | null;
  targeted: boolean;
}): DriftKind | null {
  if (input.isActive === false) return 'intentionally_paused';
  if (input.briefingsAccess === 'excluded' && !input.entitlementOk) return 'intentionally_excluded';
  if (!input.targeted) return null;
  if (!input.entitlementOk) return 'classification_mismatch';
  if (input.briefingsEnabled !== true) return 'delivery_disabled';
  return null;
}

const ACCESS_RANK: Record<string, number> = {
  excluded: -1,
  none: 0,
  beta_preview: 1,
  subscription: 2,
  '6_month': 3,
  '1_year': 4,
  lifetime: 5,
};

export type ClassificationWriteDecision =
  | { action: 'insert'; access: EntitlingAccess }
  | { action: 'update'; access: EntitlingAccess }
  | { action: 'skip'; reason: 'excluded' | 'already_entitled' | 'would_downgrade' | 'no_email' };

export interface ExistingClassification {
  briefings_access: string | null;
  briefings_expiry?: string | null;
}

export function accessTierForGrant(tier?: string | null, bundle?: string | null): EntitlingAccess {
  const b = (bundle || '').toLowerCase().trim();
  const t = (tier || '').toLowerCase().trim();
  if (b === 'ultimate' || b === 'ultimate-govcon-bundle' || b === 'complete') return 'lifetime';
  if (b === 'pro' || b === 'pro-giant-bundle') return '1_year';
  if (t === 'briefings_lifetime') return 'lifetime';
  if (t === 'briefings_annual' || t === 'team_annual') return '1_year';
  if (
    t === 'briefings' ||
    t === 'briefings_monthly' ||
    t === 'team_monthly' ||
    t === 'team' ||
    t === 'fhc_membership'
  ) {
    return 'subscription';
  }
  return 'beta_preview';
}

function rankOf(access: string | null | undefined): number {
  const key = (access || 'none').trim();
  return ACCESS_RANK[key] ?? 0;
}

/**
 * Pure decision: what should happen to this classification row given a requested
 * entitling tier. Shared by the writer and its unit tests so a grant path cannot
 * re-derive "don't clobber excluded" and get it wrong.
 */
export function decideClassificationWrite(
  existing: ExistingClassification | null,
  requested: EntitlingAccess,
  now: number = Date.now(),
): ClassificationWriteDecision {
  if (!ENTITLING_TIERS.has(requested)) {
    // Defensive: callers pass an EntitlingAccess, but a stringly-typed path
    // must not write a non-entitling value and call it a grant.
    return { action: 'skip', reason: 'would_downgrade' };
  }
  if (!existing) return { action: 'insert', access: requested };

  const current = (existing.briefings_access || 'none').trim();
  if (current === 'excluded') return { action: 'skip', reason: 'excluded' };

  const currentlyEntitled = isBriefingEntitled({
    briefings_access: current,
    briefings_expiry: existing.briefings_expiry ?? null,
  }, now);

  if (currentlyEntitled && rankOf(current) >= rankOf(requested)) {
    return { action: 'skip', reason: rankOf(current) > rankOf(requested) ? 'would_downgrade' : 'already_entitled' };
  }

  if (!currentlyEntitled) return { action: 'update', access: requested };
  if (rankOf(requested) > rankOf(current)) return { action: 'update', access: requested };
  return { action: 'skip', reason: 'would_downgrade' };
}

export interface EnsureClassificationResult {
  ok: boolean;
  changed: boolean;
  action: ClassificationWriteDecision['action'] | 'error';
  skipped?: Extract<ClassificationWriteDecision, { action: 'skip' }>['reason'];
  access?: string;
  error?: string;
}

function insertClassification(requested: EntitlingAccess): {
  classification: string;
  briefings_access: EntitlingAccess;
  briefings_expiry: null;
  has_active_subscription: boolean;
  classification_version: number;
} {
  const paid = requested !== 'beta_preview';
  return {
    classification: paid ? 'mi_subscription' : 'free',
    briefings_access: requested,
    briefings_expiry: null,
    has_active_subscription: requested === 'subscription',
    classification_version: 3,
  };
}

/**
 * Make sure this email has an entitling customer_classifications row.
 *
 * Call this anywhere `user_profiles.access_briefings` is set to true — the
 * sender cannot see the profile flag.
 */
export async function ensureEntitlingClassification(
  supabase: SupabaseClient,
  email: string,
  requested: EntitlingAccess = 'beta_preview',
): Promise<EnsureClassificationResult> {
  const userEmail = String(email || '').toLowerCase().trim();
  if (!userEmail) return { ok: false, changed: false, action: 'error', error: 'no email' };

  const { data: existing, error: readErr } = await supabase
    .from('customer_classifications')
    .select('email, briefings_access, briefings_expiry')
    .eq('email', userEmail)
    .maybeSingle();
  if (readErr) {
    return { ok: false, changed: false, action: 'error', error: readErr.message };
  }

  const decision = decideClassificationWrite(
    existing
      ? {
          briefings_access: existing.briefings_access ?? null,
          briefings_expiry: existing.briefings_expiry ?? null,
        }
      : null,
    requested,
  );

  if (decision.action === 'skip') {
    return { ok: true, changed: false, action: 'skip', skipped: decision.reason, access: existing?.briefings_access ?? undefined };
  }

  if (decision.action === 'insert') {
    const row = insertClassification(decision.access);
    const { error } = await supabase.from('customer_classifications').insert({
      email: userEmail,
      ...row,
    });
    if (error && error.code === '23505') {
      // Concurrent insert won. Re-read rather than treating the race as failure.
      return { ok: true, changed: false, action: 'skip', skipped: 'already_entitled' };
    }
    if (error) return { ok: false, changed: false, action: 'error', error: error.message };
    return { ok: true, changed: true, action: 'insert', access: decision.access };
  }

  const patch: Record<string, unknown> = {
    briefings_access: decision.access,
    briefings_expiry: null,
    updated_at: new Date().toISOString(),
  };
  if (decision.access === 'subscription') patch.has_active_subscription = true;

  const { error } = await supabase
    .from('customer_classifications')
    .update(patch)
    .eq('email', userEmail);
  if (error) return { ok: false, changed: false, action: 'error', error: error.message };
  return { ok: true, changed: true, action: 'update', access: decision.access };
}
