/**
 * The paywall moment — what a user sees when a premium tool is refused, and the record
 * that lets them pick up exactly where they left off after paying.
 *
 * BEFORE THIS: the refusal was a price quote and a link ("This tool costs 100 credits;
 * your balance is 0. Top up at getmindy.ai/mcp."), and the request was thrown away. That
 * is the highest-intent moment in the whole product — someone just got a useful answer and
 * asked for another — answered with a "no" that sells nothing and loses their work.
 *
 * TWO JOBS, one record:
 *   1. The message names what they already got and what upgrading unlocks, in terms of the
 *      specific thing they were trying to do, and links straight into checkout.
 *   2. The attempt is persisted (tool + args) so after payment we can restore the request.
 *      That same row is the conversion funnel: rejected -> checkout -> purchase -> resume.
 *
 * Recording must never break a tool call, so every write here is best-effort.
 */
import { getWriteClient } from '@/lib/supabase/server-clients';

/** Stripe payment links, mirroring src/app/mcp/pricing/page.tsx. */
const CHECKOUT_ENTRY = 'https://buy.stripe.com/bJe5kEff8erw20R0CsfnO0Y';

/** Where a refused user lands: the offer page, carrying the attempt so it can be resumed. */
export const RESUME_BASE = 'https://getmindy.ai/mcp/continue';

export type PaywallReason = 'insufficient_credits' | 'requires_pro';

export interface PaywallAttempt {
  userEmail: string;
  toolName: string;
  args: Record<string, unknown>;
  reason: PaywallReason;
  creditsRequired?: number;
  balanceAtAttempt?: number;
}

/**
 * Per-tool copy. A generic "you are out of credits" wastes the moment — the rejection
 * already knows which premium tool they reached for, so the offer speaks to that intent.
 * Keyed by tool; anything not listed falls back to the generic premium line.
 */
const TOOL_OFFERS: Record<string, { got: string; unlocks: string }> = {
  generate_market_report: {
    got: 'Your free Market Report covered one NAICS code and one geography.',
    unlocks:
      'Upgrade to research additional markets, compare where the best opportunities are, and rerun your analysis as federal spending changes.',
  },
  capability_market_match: {
    got: 'Your free capability match analyzed one set of capabilities against the market.',
    unlocks:
      'Upgrade to test other capabilities and geographies, and see which of your markets is actually worth pursuing.',
  },
  build_pursuit_dossier: {
    got: 'Your free pursuit dossier covered one opportunity end to end.',
    unlocks:
      'Upgrade to build dossiers for every pursuit you are chasing, and keep them current as the solicitation changes.',
  },
};

/** The human-readable name we use in the offer headline. */
const TOOL_LABEL: Record<string, string> = {
  generate_market_report: 'Market Report',
  capability_market_match: 'Capability Match',
  build_pursuit_dossier: 'Pursuit Dossier',
};

/**
 * Record the refused attempt. Returns the row id so the caller can put a resume link in
 * the message. Best-effort: a logging failure must never turn into a tool failure, so a
 * miss returns null and the user still gets the offer copy (minus the deep link).
 */
export async function recordPaywallAttempt(a: PaywallAttempt): Promise<string | null> {
  try {
    const { data, error } = await getWriteClient()
      .from('mcp_paywall_attempts')
      .insert({
        user_email: a.userEmail.trim().toLowerCase(),
        tool_name: a.toolName,
        args: a.args ?? {},
        reason: a.reason,
        credits_required: a.creditsRequired ?? null,
        balance_at_attempt: a.balanceAtAttempt ?? null,
      })
      .select('id')
      .single();
    if (error || !data) return null;
    return data.id as string;
  } catch {
    return null;
  }
}

/**
 * The message the agent relays. Written to be read aloud by Claude or ChatGPT, so it is
 * prose with one clear next step — not a form. The user is mid-conversation; they should
 * be able to act without hunting for what credits are.
 */
export function paywallMessage(opts: {
  toolName: string;
  reason: PaywallReason;
  creditsRequired?: number;
  balance?: number;
  attemptId?: string | null;
}): string {
  const label = TOOL_LABEL[opts.toolName] ?? 'this analysis';
  const offer = TOOL_OFFERS[opts.toolName];
  const link = opts.attemptId ? `${RESUME_BASE}?attempt=${opts.attemptId}` : CHECKOUT_ENTRY;

  if (opts.reason === 'requires_pro') {
    return [
      `Ready to run another ${label}?`,
      offer ? offer.unlocks : `${opts.toolName} is part of Mindy Pro.`,
      `Continue here — your request is saved and will run as soon as you upgrade: ${link}`,
    ].join('\n\n');
  }

  return [
    `Ready to analyze another market?`,
    offer
      ? `${offer.got} ${offer.unlocks}`
      : `You have used your free credits. Upgrade to keep researching your market.`,
    `Continue with this ${label} — we saved exactly what you asked for, so it runs the moment you upgrade: ${link}`,
  ].join('\n\n');
}

/** Mark that the user reached checkout from a saved attempt. */
export async function markCheckoutStarted(attemptId: string): Promise<void> {
  try {
    await getWriteClient()
      .from('mcp_paywall_attempts')
      .update({ checkout_started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', attemptId)
      .is('checkout_started_at', null);
  } catch {
    /* best-effort */
  }
}

/**
 * The most recent unconsumed attempt for a user — what we offer to resume after payment.
 * Returns null when there is nothing pending, which is the common case.
 */
export async function pendingAttempt(userEmail: string): Promise<
  | { id: string; toolName: string; args: Record<string, unknown>; rejectedAt: string }
  | null
> {
  try {
    const { data, error } = await getWriteClient()
      .from('mcp_paywall_attempts')
      .select('id,tool_name,args,rejected_at')
      .eq('user_email', userEmail.trim().toLowerCase())
      .is('consumed_at', null)
      .order('rejected_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id as string,
      toolName: data.tool_name as string,
      args: (data.args ?? {}) as Record<string, unknown>,
      rejectedAt: data.rejected_at as string,
    };
  } catch {
    return null;
  }
}

/**
 * Stamp a funnel transition. `purchased` and `resumed` are separate on purpose: paying is
 * not the same as getting the thing, and the gap between them is where a "you're upgraded,
 * now go find it yourself" experience would show up in the data.
 */
export async function stampAttempt(
  attemptId: string,
  stage: 'purchased' | 'resumed' | 'completed',
): Promise<void> {
  const col =
    stage === 'purchased' ? 'purchased_at' : stage === 'resumed' ? 'resumed_at' : 'completed_at';
  const patch: Record<string, string> = { [col]: new Date().toISOString(), updated_at: new Date().toISOString() };
  // Completing consumes the attempt so one purchase cannot replay it.
  if (stage === 'completed') patch.consumed_at = new Date().toISOString();
  try {
    await getWriteClient().from('mcp_paywall_attempts').update(patch).eq('id', attemptId);
  } catch {
    /* best-effort */
  }
}

export const __testing = { TOOL_OFFERS, TOOL_LABEL, CHECKOUT_ENTRY };
