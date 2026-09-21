import { kv } from '@vercel/kv';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getPartnerReferralByCode,
  getPartnerByInvitationSource,
  type PartnerReferralProgram,
} from '@/lib/mindy/partner-referrals';

const NS = 'mindy:affiliate';

export type AffiliateCommissionEvent = 'checkout' | 'invoice' | 'refund';

export interface AffiliateCommissionRecord {
  id: string;
  partnerCode: string;
  partnerName: string;
  customerEmail: string;
  grossCents: number;
  commissionPercent: number;
  commissionCents: number;
  currency: string;
  eventType: AffiliateCommissionEvent;
  productLabel?: string;
  createdAt: string;
}

export interface AffiliatePartnerTotals {
  partnerCode: string;
  partnerName: string;
  commissionPercent: number;
  transactionCount: number;
  grossCents: number;
  commissionCents: number;
  payingCustomers: number;
  monthlyCommissionRunRateCents: number;
}

function keys(partnerCode: string) {
  const code = partnerCode.toUpperCase();
  return {
    event: (id: string) => `${NS}:event:${id}`,
    partnerEvents: `${NS}:partner:${code}:events`,
    partnerPaying: `${NS}:partner:${code}:paying`,
    partnerTotals: `${NS}:partner:${code}:totals`,
  };
}

export function calculateAffiliateCommissionCents(
  grossCents: number,
  percent: number,
): number {
  if (grossCents <= 0 || percent <= 0) return 0;
  return Math.round((grossCents * percent) / 100);
}

export async function resolvePartnerForCustomer(
  supabase: SupabaseClient,
  email: string,
): Promise<PartnerReferralProgram | null> {
  const normalized = email.toLowerCase().trim();
  if (!normalized) return null;

  const { data } = await supabase
    .from('user_notification_settings')
    .select('invitation_source, trial_source')
    .eq('user_email', normalized)
    .maybeSingle();

  return (
    getPartnerByInvitationSource(data?.invitation_source)
    || getPartnerByInvitationSource(data?.trial_source)
    || null
  );
}

export function resolvePartnerFromAttribution(
  partnerCode: string | null | undefined,
): PartnerReferralProgram | null {
  return getPartnerReferralByCode(partnerCode);
}

/**
 * Record a 30% (or partner-specific) recurring affiliate commission.
 * Idempotent per Stripe event id.
 */
export async function recordAffiliateCommission(args: {
  partner: PartnerReferralProgram;
  customerEmail: string;
  grossCents: number;
  stripeEventId: string;
  eventType: AffiliateCommissionEvent;
  currency?: string;
  productLabel?: string;
}): Promise<AffiliateCommissionRecord | null> {
  const percent = args.partner.affiliatePercent;
  if (percent <= 0 || args.grossCents <= 0) return null;

  const normalizedEmail = args.customerEmail.toLowerCase().trim();
  const commissionCents = calculateAffiliateCommissionCents(args.grossCents, percent);
  if (commissionCents <= 0) return null;

  const eventKey = keys(args.partner.code).event(args.stripeEventId);
  try {
    const existing = await kv.get<AffiliateCommissionRecord>(eventKey);
    if (existing) return existing;
  } catch (error) {
    console.warn('[affiliate] KV read failed:', error);
    return null;
  }

  const record: AffiliateCommissionRecord = {
    id: args.stripeEventId,
    partnerCode: args.partner.code,
    partnerName: args.partner.name,
    customerEmail: normalizedEmail,
    grossCents: args.grossCents,
    commissionPercent: percent,
    commissionCents,
    currency: (args.currency || 'usd').toLowerCase(),
    eventType: args.eventType,
    productLabel: args.productLabel,
    createdAt: new Date().toISOString(),
  };

  const k = keys(args.partner.code);
  try {
    await kv.set(eventKey, record);
    await kv.sadd(k.partnerEvents, args.stripeEventId);
    await kv.sadd(k.partnerPaying, normalizedEmail);

    const totals = (await kv.get<{
      grossCents: number;
      commissionCents: number;
      transactionCount: number;
    }>(k.partnerTotals)) || {
      grossCents: 0,
      commissionCents: 0,
      transactionCount: 0,
    };

    await kv.set(k.partnerTotals, {
      grossCents: totals.grossCents + args.grossCents,
      commissionCents: totals.commissionCents + commissionCents,
      transactionCount: totals.transactionCount + 1,
    });
  } catch (error) {
    console.warn('[affiliate] KV write failed:', error);
    return null;
  }

  return record;
}

export async function getAffiliatePartnerTotals(
  partner: PartnerReferralProgram,
): Promise<AffiliatePartnerTotals> {
  const k = keys(partner.code);
  const empty: AffiliatePartnerTotals = {
    partnerCode: partner.code,
    partnerName: partner.name,
    commissionPercent: partner.affiliatePercent,
    transactionCount: 0,
    grossCents: 0,
    commissionCents: 0,
    payingCustomers: 0,
    monthlyCommissionRunRateCents: 0,
  };

  try {
    const [totals, payingIds, eventIds] = await Promise.all([
      kv.get<{ grossCents: number; commissionCents: number; transactionCount: number }>(k.partnerTotals),
      kv.smembers<string[]>(k.partnerPaying),
      kv.smembers<string[]>(k.partnerEvents),
    ]);

    const payingCustomers = Array.isArray(payingIds) ? payingIds.length : 0;
    const transactionCount = totals?.transactionCount
      ?? (Array.isArray(eventIds) ? eventIds.length : 0);

    // Rough MRR commission run-rate: assume latest checkout/invoice per paying
    // customer at $149/mo × affiliate %.
    const monthlyCommissionRunRateCents = payingCustomers > 0
      ? calculateAffiliateCommissionCents(14900 * payingCustomers, partner.affiliatePercent)
      : 0;

    return {
      ...empty,
      transactionCount,
      grossCents: totals?.grossCents ?? 0,
      commissionCents: totals?.commissionCents ?? 0,
      payingCustomers,
      monthlyCommissionRunRateCents,
    };
  } catch (error) {
    console.warn('[affiliate] KV totals read failed:', error);
    return empty;
  }
}

export async function recordAffiliateFromStripePayment(args: {
  supabase: SupabaseClient | null;
  customerEmail: string;
  grossCents: number;
  stripeEventId: string;
  eventType: AffiliateCommissionEvent;
  currency?: string;
  productLabel?: string;
  partnerCode?: string | null;
}): Promise<AffiliateCommissionRecord | null> {
  let partner = resolvePartnerFromAttribution(args.partnerCode);
  if (!partner && args.supabase) {
    partner = await resolvePartnerForCustomer(args.supabase, args.customerEmail);
  }
  if (!partner || partner.affiliatePercent <= 0) return null;

  return recordAffiliateCommission({
    partner,
    customerEmail: args.customerEmail,
    grossCents: args.grossCents,
    stripeEventId: args.stripeEventId,
    eventType: args.eventType,
    currency: args.currency,
    productLabel: args.productLabel,
  });
}
