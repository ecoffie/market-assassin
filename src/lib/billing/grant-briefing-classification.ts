/**
 * Path A checkout must write the SAME briefing gate Path B / admin bulk writes.
 *
 * `customer_classifications.briefings_access` is what send-briefings-fast and
 * send-weekly-fast actually read (`BRIEFING_ENTITLED_ACCESS` in rollout.ts).
 * Path A (`/api/stripe-webhook`) historically wrote KV + `access_briefings` and
 * left this row at insert-only `free`/`beta_preview` (or skipped it entirely for
 * an existing profile). Measured: Adam Sokolowski paid 2026-09-08 02:42Z;
 * classification `subscription` landed 2026-09-09 22:28Z via admin bulk — ~44h
 * of paid briefings missed.
 *
 * Never overwrites `excluded`. Never downgrades `lifetime`. Never fabricates
 * spend or merges identities. Credits are untouched.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { briefingGrantForPurchase, type BriefingGrant } from '@/lib/briefings/product-entitlement';

export type ClassificationAccess = string | null | undefined;

export function nextBriefingsAccess(args: {
  existingAccess: ClassificationAccess;
  grant: BriefingGrant;
}): { write: false; reason: string } | { write: true; access: 'subscription' | 'lifetime' } {
  const existing = String(args.existingAccess || '').trim();
  if (existing === 'excluded') {
    return { write: false, reason: 'excluded wins' };
  }
  if (!args.grant.earns) {
    return { write: false, reason: args.grant.reason };
  }
  if (existing === 'lifetime') {
    return { write: false, reason: 'already lifetime' };
  }
  return { write: true, access: args.grant.access };
}

export async function grantPaidBriefingClassification(
  sb: SupabaseClient,
  args: {
    email: string;
    productName: string | null | undefined;
    amountCents: number;
    stripeCustomerId?: string | null;
    hasActiveSubscription?: boolean;
  },
): Promise<{ outcome: 'skipped' | 'upserted' | 'failed'; reason?: string; access?: string }> {
  const email = String(args.email || '').toLowerCase().trim();
  if (!email) return { outcome: 'skipped', reason: 'empty email' };

  const grant = briefingGrantForPurchase(args.productName, Number(args.amountCents) || 0);

  const { data: existing, error: readErr } = await sb
    .from('customer_classifications')
    .select('email, briefings_access')
    .eq('email', email)
    .maybeSingle();
  if (readErr) {
    console.error(`[grantPaidBriefingClassification] read failed for ${email}:`, readErr.message);
    return { outcome: 'failed', reason: readErr.message };
  }

  const decision = nextBriefingsAccess({
    existingAccess: existing?.briefings_access ?? null,
    grant,
  });
  if (!decision.write) {
    return { outcome: 'skipped', reason: decision.reason };
  }

  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    email,
    briefings_access: decision.access,
    briefings_expiry: null,
    has_active_subscription: args.hasActiveSubscription ?? decision.access === 'subscription',
    classification: decision.access === 'lifetime' ? 'mindy_lifetime' : 'mi_subscription',
    classification_version: 3,
    classified_at: now,
  };
  if (args.stripeCustomerId) row.customer_id = args.stripeCustomerId;

  const { error: upsertErr } = await sb.from('customer_classifications').upsert(row);
  if (upsertErr) {
    console.error(`[grantPaidBriefingClassification] upsert failed for ${email}:`, upsertErr.message);
    return { outcome: 'failed', reason: upsertErr.message };
  }
  return { outcome: 'upserted', access: decision.access };
}
